// Test doubles only: no-op processes at arbitrary periods; exercises scheduler and journal interfaces.
import { describe, expect, it } from 'vitest'
import {
  canonical, EventBus, Scheduler, SECOND, HOUR, DAY,
  TransferJournal, type ProcessOrder,
} from '../../src/index.ts'

const laneOrder: ProcessOrder = {
  phases: ['lane'],
  order: { lane: ['lane.1s', 'lane.7s', 'lane.60s', 'lane.1h', 'lane.1d'] },
}
const horizon = 2 * DAY

type RunRecord = { id: string; t: number; dt: number }

function firstDue(period: number, offset = 0, at = 0): number {
  return offset > at ? offset : at + period - ((at - offset) % period)
}

function runCount(period: number, offset = 0, end = horizon, at = 0): number {
  const first = firstDue(period, offset, at)
  if (first > end) return 0
  return Math.floor((end - first) / period) + 1
}

function registerProcesses(
  clock: Scheduler, ids: readonly string[], periods: Record<string, number>, trace: RunRecord[],
): void {
  for (const id of ids) {
    clock.register({
      id, mechanisms: [], period: periods[id], phase: 'lane',
      run: ({ t, dt }) => { trace.push({ id, t, dt }) },
    })
  }
}

describe('L5 scheduling (PLAN §7a)', () => {
  const periods = {
    'lane.1s': SECOND,
    'lane.7s': 7 * SECOND,
    'lane.60s': 60 * SECOND,
    'lane.1h': HOUR,
    'lane.1d': DAY,
  } as const
  const ids = Object.keys(periods)

  it('run counts over a two-day horizon match the registration closed form', () => {
    const clock = new Scheduler({ order: laneOrder })
    const trace: RunRecord[] = []
    registerProcesses(clock, ids, periods, trace)
    clock.runUntil(horizon)
    const counts = Object.fromEntries(ids.map(id => [id, trace.filter(r => r.id === id).length]))
    for (const id of ids) {
      expect(counts[id], id).toBe(runCount(periods[id as keyof typeof periods]))
    }
  })

  it('each process dt sums to elapsed time since registration through its last run', () => {
    const clock = new Scheduler({ order: laneOrder })
    const trace: RunRecord[] = []
    registerProcesses(clock, ids, periods, trace)
    clock.runUntil(horizon)
    for (const id of ids) {
      const runs = trace.filter(r => r.id === id)
      const sum = runs.reduce((total, run) => total + run.dt, 0)
      const elapsed = runs.length ? runs[runs.length - 1].t : 0
      expect(sum, id).toBe(elapsed)
    }
  })

  it('three shuffled registration orders produce identical run sequences', () => {
    const orders = [
      ids,
      [...ids].reverse(),
      ['lane.7s', 'lane.1d', 'lane.1s', 'lane.1h', 'lane.60s'],
    ]
    const sequences = orders.map(order => {
      const clock = new Scheduler({ order: laneOrder })
      const trace: RunRecord[] = []
      registerProcesses(clock, order, periods, trace)
      clock.runUntil(horizon)
      return canonical(trace)
    })
    expect(sequences[1]).toBe(sequences[0])
    expect(sequences[2]).toBe(sequences[0])
  })

  it('a daily reader consumes each one-second journal entry exactly once via since(cursor)', () => {
    const journal = new TransferJournal()
    const order: ProcessOrder = {
      phases: ['fast', 'day'],
      order: { fast: ['lane.producer'], day: ['lane.reader'] },
    }
    let cursor = 0
    const seen: unknown[] = []
    const clock = new Scheduler({ order })
    clock.register({
      id: 'lane.producer', mechanisms: [], period: SECOND, phase: 'fast',
      run: ({ t }) => {
        journal.append({
          t, process: 'lane.producer', quantity: 'mass', unit: 'kg', amount: 1,
          from: 'fixture/src', to: 'fixture/dst',
        })
      },
    })
    clock.register({
      id: 'lane.reader', mechanisms: [], period: DAY, phase: 'day',
      run: () => {
        const batch = journal.since(cursor)
        seen.push(...batch)
        cursor += batch.length
      },
    })
    clock.runUntil(horizon)
    expect(seen).toHaveLength(journal.length)
    expect(new Set(seen.map(entry => canonical(entry))).size).toBe(journal.length)
    expect(canonical(seen)).toBe(canonical(journal.entries()))
    expect(cursor).toBe(journal.length)
  })

  it('an event at T is hidden from an earlier process in order at the same T', () => {
    const bus = new EventBus()
    const order: ProcessOrder = {
      phases: ['early', 'late'],
      order: { early: ['lane.early'], late: ['lane.late'] },
    }
    const clock = new Scheduler({
      order,
      emit: input => { bus.emit(input) },
    })
    clock.register({
      id: 'lane.early', mechanisms: [], period: SECOND, phase: 'early',
      run: () => {
        expect(bus.since(0, { t: clock.t, phase: 0, position: 0 })).toEqual([])
      },
    })
    clock.register({
      id: 'lane.late', mechanisms: [], period: SECOND, phase: 'late',
      run: () => { bus.emit({ t: clock.t, source: 'lane.late', phase: 1, position: 0, type: 'lane.tick', payload: {} }) },
    })
    clock.runUntil(SECOND)
    expect(bus.since(0)).toHaveLength(1)
    expect(bus.since(0, { t: SECOND, phase: 0, position: 0 })).toEqual([])
    expect(bus.since(0, { t: SECOND, phase: 1, position: 0 })).toHaveLength(1)
  })
})
