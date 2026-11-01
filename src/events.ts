import { nonempty } from './guards.ts'
import type { OrderPosition } from './order.ts'
import type { ScheduledEmission } from './scheduler.ts'
import { simTime, type SimTime } from './time.ts'

export interface KernelEvent {
  readonly id: string
  readonly t: SimTime
  readonly source: string
  readonly type: string
  readonly payload: unknown
  readonly cause?: string
}

export interface PayloadField {
  kind: 'number' | 'integer' | 'string' | 'boolean' | 'id' | 'list' | 'record'
  of?: PayloadField['kind']
  nullable?: boolean
  quantity?: string
  unit?: string
  required: boolean
}

export interface EventContract {
  type: string
  producer: string
  consumers: string[]
  cause: 'required' | 'optional'
  payload: Record<string, PayloadField>
  notes?: string
}

function matchesKind(value: unknown, kind: PayloadField['kind'], of?: PayloadField['kind']): boolean {
  switch (kind) {
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'id': return typeof value === 'string' && value.trim().length > 0
    case 'record': return typeof value === 'object' && value !== null && !Array.isArray(value)
    case 'list': return Array.isArray(value) && (of === undefined || value.every(item => matchesKind(item, of)))
    default: return typeof value === kind
  }
}

/** Reader's position in the scheduler; later emissions at this instant are hidden. */
export interface EventReader extends OrderPosition { readonly t: SimTime }

/** Number of events already consumed, starting at zero. Advance by the returned length. */
export type EventCursor = number

export interface EventRecord extends OrderPosition {
  readonly event: KernelEvent
  readonly sequence: number
}

export interface EventBusState {
  readonly counter: number
  readonly records: readonly EventRecord[]
}

function natural(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${what} must be a non-negative safe integer`)
}

function validatePosition(at: EventReader): void {
  simTime(at.t)
  natural(at.phase, 'phase')
  natural(at.position, 'position')
}

function compare(a: EventReader, b: EventReader): number {
  return a.t - b.t || a.phase - b.phase || a.position - b.position
}

const at = (record: EventRecord): EventReader => ({ t: record.event.t, phase: record.phase, position: record.position })
const eventId = (sequence: number) => `evt.${String(sequence).padStart(6, '0')}`

/**
 * Append-only, pull-based delivery. Wire Scheduler's emit option to bus.emit.
 * Publications must follow scheduler order: backdated writes are rejected so cursors
 * cannot skip events. Equal positions retain emission order. No subscribers are called.
 */
export class EventBus {
  private counter = 0
  private records: EventRecord[] = []
  private readonly options: {
    contracts?: ReadonlyMap<string, EventContract>
    onViolation?: (message: string, event: KernelEvent) => void
  }

  constructor(options: {
    contracts?: ReadonlyMap<string, EventContract>
    onViolation?: (message: string, event: KernelEvent) => void
  } = {}) { this.options = options }

  private checkContract(event: KernelEvent): void {
    if (!this.options.contracts) return
    const warn = (message: string) => {
      // Diagnostics are advisory, even if a host hook throws or mutates its copy.
      try { this.options.onViolation?.(`warning: ${event.type}: ${message}`, structuredClone(event)) } catch {}
    }
    const contract = this.options.contracts.get(event.type)
    if (!contract) { warn('unknown event type'); return }
    if (contract.cause === 'required' && event.cause === undefined) warn('missing required cause')
    const payload = event.payload !== null && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : {}
    for (const [name, field] of Object.entries(contract.payload)) {
      if (!Object.hasOwn(payload, name) || payload[name] === undefined) {
        if (field.required) warn(`missing required field ${name}`)
      } else if (!(field.nullable === true && payload[name] === null) && !matchesKind(payload[name], field.kind, field.of)) {
        warn(`field ${name} has wrong kind (expected ${field.kind})`)
      }
    }
  }

  readonly emit = (input: ScheduledEmission): KernelEvent => {
    validatePosition(input)
    nonempty(input.source, 'event source')
    nonempty(input.type, 'event type')
    if (input.cause !== undefined) nonempty(input.cause, 'event cause')
    const last = this.records[this.records.length - 1]
    if (last && compare(at(last), input) > 0) throw new Error('events must be emitted in scheduler order')
    const sequence = this.counter + 1
    natural(sequence, 'event counter')
    const event: KernelEvent = structuredClone({
      id: eventId(sequence), t: input.t, source: input.source, type: input.type,
      payload: input.payload, ...(input.cause === undefined ? {} : { cause: input.cause }),
    })
    // Clone before committing: an unsupported payload cannot consume an id.
    const result = structuredClone(event)
    this.records.push({ event, phase: input.phase, position: input.position, sequence })
    this.counter = sequence
    this.checkContract(event)
    return result
  }

  /** Omit reader only for host/audit reads; processes supply their current t and rank. */
  since(cursor: EventCursor = 0, reader?: EventReader): KernelEvent[] {
    natural(cursor, 'event cursor')
    if (cursor > this.records.length) throw new Error('event cursor is beyond the queue')
    if (reader) validatePosition(reader)
    const events: KernelEvent[] = []
    for (let i = cursor; i < this.records.length; i++) {
      const record = this.records[i]
      if (reader && compare(at(record), reader) > 0) break
      events.push(record.event)
    }
    return structuredClone(events)
  }

  /** Read detached records with scheduler metadata; reader visibility follows since(). */
  recordsSince(cursor: EventCursor = 0, reader?: EventReader): EventRecord[] {
    natural(cursor, 'event cursor')
    if (cursor > this.records.length) throw new Error('event cursor is beyond the queue')
    if (reader) validatePosition(reader)
    const records: EventRecord[] = []
    for (let i = cursor; i < this.records.length; i++) {
      const record = this.records[i]
      if (reader && compare(at(record), reader) > 0) break
      records.push(record)
    }
    return structuredClone(records)
  }

  state(): EventBusState {
    return structuredClone({ counter: this.counter, records: this.records })
  }

  /** Restore the entire queue and counter atomically; consumer cursors belong to the host. */
  restore(state: EventBusState): void {
    natural(state.counter, 'event counter')
    if (state.counter !== state.records.length) throw new Error('event counter must match the queue length')
    const restored = new EventBus()
    for (const record of state.records) {
      if (record.sequence !== restored.counter + 1 || record.event.id !== eventId(record.sequence)) {
        throw new Error('invalid event sequence or id')
      }
      restored.emit({ ...record.event, phase: record.phase, position: record.position })
    }
    this.records = restored.records
    this.counter = restored.counter
  }
}
