import { finite, nonempty } from './guards.ts'
import { simTime, type SimTime } from './time.ts'
import type { Participant } from './transaction.ts'

export type Bound =
  | { kind: 'unbounded'; evidence: 'fixture' }
  | { kind: 'series'; steps: { from: SimTime; value: number }[] }

export interface Reservation {
  id: string
  actor: string
  cause: string
  start: SimTime
  end: SimTime
  share: number
  status: 'reserved' | 'fulfilled' | 'released'
  fulfilledMs: number
  releasedAt?: SimTime
}

export type ReservationRequest = Pick<Reservation, 'id' | 'actor' | 'cause' | 'start' | 'end' | 'share'>

/** State after each successful operation, suitable for a cause-linked trace. */
export interface ReservationRecord extends Reservation {
  operation: 'reserve' | 'release' | 'fulfil'
  t: SimTime
}

export interface ReservationLedgerOptions {
  id?: string
  bound: (actor: string) => Bound | undefined
}

export interface ReservationSnapshot {
  reservations: Reservation[]
  records: ReservationRecord[]
}

/** Integer-ms accounting only; actors' owners supply all capacity bounds. */
export class ReservationLedger implements Participant {
  readonly id: string
  private readonly bound: ReservationLedgerOptions['bound']
  private reservations = new Map<string, Reservation>()
  private log: ReservationRecord[] = []

  constructor(options: ReservationLedgerOptions) {
    this.id = nonempty(options.id ?? 'kernel.reservations', 'reservation ledger id')
    this.bound = options.bound
  }

  reserve(now: SimTime, request: ReservationRequest): Reservation {
    simTime(now)
    const { id, actor, cause, start, end, share } = request
    nonempty(id, 'reservation id')
    nonempty(actor, 'reservation actor')
    nonempty(cause, 'reservation cause')
    simTime(start, 'reservation start')
    simTime(end, 'reservation end')
    finite(share, 'reservation share')
    if (share <= 0) throw new Error('reservation share must be positive')
    if (start >= end) throw new Error('reservation start must precede end')
    if (start < now) throw new Error('reservation start is in the past')
    if (this.reservations.has(id)) throw new Error(`duplicate reservation: ${id}`)
    const bound = this.bound(actor)
    if (bound === undefined) throw new Error(`missing bound for ${actor}`)
    if (bound.kind === 'series') {
      let previous = -1
      for (const step of bound.steps) {
        simTime(step.from, 'bound step')
        finite(step.value, 'bound value', 0)
        if (step.from <= previous) throw new Error(`bound steps must ascend for ${actor}`)
        previous = step.from
      }
      if (!bound.steps.length || bound.steps[0].from > start) {
        throw new Error(`missing bound for ${actor} at ${start}`)
      }
      const overlapping = [...this.reservations.values()].filter(reservation =>
        reservation.actor === actor && reservation.status === 'reserved' &&
        reservation.start < end && reservation.end > start)
      const points = new Set([start])
      for (const point of [
        ...bound.steps.map(step => step.from),
        ...overlapping.flatMap(reservation => [reservation.start, reservation.end]),
      ]) {
        if (point > start && point < end) points.add(point)
      }
      let stepIndex = 0
      for (const t of [...points].sort((a, b) => a - b)) {
        while (stepIndex + 1 < bound.steps.length && bound.steps[stepIndex + 1].from <= t) stepIndex++
        const total = overlapping.reduce((sum, reservation) =>
          sum + (reservation.start <= t && t < reservation.end ? reservation.share : 0), share)
        if (total > bound.steps[stepIndex].value) throw new Error(`bound exceeded for ${actor} at ${t}`)
      }
    } else if (bound.kind !== 'unbounded' || bound.evidence !== 'fixture') {
      throw new Error(`invalid bound for ${actor}`)
    }
    const reservation: Reservation = { id, actor, cause, start, end, share, status: 'reserved', fulfilledMs: 0 }
    return this.append(now, 'reserve', reservation)
  }

  release(now: SimTime, id: string): Reservation {
    simTime(now)
    const reservation = this.pending(id)
    if (now >= reservation.end) throw new Error(`reservation already elapsed: ${id}`)
    return this.append(now, 'release', {
      ...reservation, status: 'released', fulfilledMs: Math.max(0, now - reservation.start), releasedAt: now,
    })
  }

  fulfil(now: SimTime, id: string): Reservation {
    simTime(now)
    const reservation = this.pending(id)
    if (now < reservation.end) throw new Error(`reservation has not ended: ${id}`)
    return this.append(now, 'fulfil', {
      ...reservation, status: 'fulfilled', fulfilledMs: reservation.end - reservation.start,
    })
  }

  active(actor: string, t: SimTime): Reservation[] {
    simTime(t)
    return [...this.reservations.values()].filter(reservation =>
      reservation.actor === actor && reservation.status === 'reserved' &&
      reservation.start <= t && t < reservation.end).map(reservation => ({ ...reservation }))
  }

  records(): ReservationRecord[] { return this.log.map(record => ({ ...record })) }

  snapshot(): ReservationSnapshot {
    return {
      reservations: [...this.reservations.values()].map(reservation => ({ ...reservation })),
      records: this.records(),
    }
  }

  restore(snapshot: unknown): void {
    const saved = snapshot as ReservationSnapshot
    this.reservations = new Map(saved.reservations.map(reservation => [reservation.id, { ...reservation }]))
    this.log = saved.records.map(record => ({ ...record }))
  }

  private pending(id: string): Reservation {
    const reservation = this.reservations.get(id)
    if (!reservation) throw new Error(`unknown reservation: ${id}`)
    if (reservation.status !== 'reserved') throw new Error(`reservation is already ${reservation.status}: ${id}`)
    return reservation
  }

  private append(t: SimTime, operation: ReservationRecord['operation'], reservation: Reservation): Reservation {
    this.reservations.set(reservation.id, reservation)
    this.log.push({ ...reservation, operation, t })
    return { ...reservation }
  }
}
