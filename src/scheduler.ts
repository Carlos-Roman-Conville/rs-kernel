import { nonempty } from './guards.ts'
import { Order, type OrderPosition, type ProcessOrder } from './order.ts'
import { streams, type RandomStream, type RandomStreams } from './rng.ts'
import { simTime, type SimTime } from './time.ts'

export interface ProcessContext {
  readonly t: SimTime
  readonly dt: SimTime
  rng(mechanismId: string): RandomStream
  emit(type: string, payload: unknown, cause?: string): void
}

export interface Process {
  readonly id: string
  readonly mechanisms: readonly string[]
  readonly period: SimTime
  readonly offset?: SimTime
  readonly phase: string
  run(ctx: ProcessContext): void
}

/** The event service/host supplies the sink and owns event ids and delivery. */
export interface ScheduledEmission {
  readonly t: SimTime
  readonly source: string
  readonly phase: number
  readonly position: number
  readonly type: string
  readonly payload: unknown
  readonly cause?: string
}

export interface SchedulerOptions {
  readonly order?: ProcessOrder
  readonly start?: SimTime
  /** Supply streams(runSeed); omitted streams use seed 0. */
  readonly rng?: RandomStreams
  /** Synchronous publication hook, not subscriber delivery. Missing sinks reject emit. */
  readonly emit?: (event: ScheduledEmission) => void
}

interface Entry extends OrderPosition {
  last: SimTime
  run: Process['run']
  rng: ProcessContext['rng']
  emit: ProcessContext['emit']
}

interface Group { next: number; entries: Entry[] }
interface Bucket { period: SimTime; heap: Group[]; groups: Map<number, Group> }

const compare = (a: OrderPosition, b: OrderPosition) => a.phase - b.phase || a.position - b.position

// Groups are already ordered: combining due buckets takes linear work, not a fresh sort.
function merge(a: Entry[], b: Entry[]): Entry[] {
  const result: Entry[] = []
  let i = 0, j = 0
  while (i < a.length && j < b.length) result.push(compare(a[i], b[j]) <= 0 ? a[i++] : b[j++])
  while (i < a.length) result.push(a[i++])
  while (j < b.length) result.push(b[j++])
  return result
}

// A heap of offset groups inside each period bucket avoids scanning sleeping processes,
// including runs with many offsets of the same period. Equal due times share one group.
function push(heap: Group[], group: Group): void {
  let i = heap.length
  heap.push(group)
  while (i > 0) {
    const parent = (i - 1) >>> 1
    if (heap[parent].next <= group.next) break
    heap[i] = heap[parent]
    i = parent
  }
  heap[i] = group
}

function pop(heap: Group[]): Group {
  const first = heap[0]
  const last = heap.pop()!
  if (heap.length) {
    let i = 0
    while (i * 2 + 1 < heap.length) {
      let child = i * 2 + 1
      if (child + 1 < heap.length && heap[child + 1].next < heap[child].next) child++
      if (heap[child].next >= last.next) break
      heap[i] = heap[child]
      i = child
    }
    heap[i] = last
  }
  return first
}

// Infinity is an internal sentinel only; no callback ever receives unsafe time.
function after(t: SimTime, delta: SimTime): number {
  return delta > Number.MAX_SAFE_INTEGER - t ? Infinity : t + delta
}

export class Scheduler {
  private time: SimTime
  private readonly order: Order
  private readonly random: RandomStreams
  private readonly sink: SchedulerOptions['emit']
  private readonly ids = new Set<string>()
  private readonly buckets = new Map<SimTime, Bucket>()
  private running = false
  private failed = false

  constructor(options: SchedulerOptions = {}) {
    this.time = simTime(options.start ?? 0, 'start')
    this.order = new Order(options.order)
    this.random = options.rng ?? streams(0)
    this.sink = options.emit
  }

  get t(): SimTime { return this.time }

  /**
   * First run is strictly after registration and at/after offset (default epoch 0).
   * It closes the interval since registration; later dt values equal the period.
   * Registration between runUntil calls is supported, never during callbacks.
   */
  register(process: Process): this {
    if (this.running || this.failed) throw new Error('scheduler cannot register while running or after failure')
    const id = nonempty(process.id, 'process id')
    if (this.ids.has(id)) throw new Error(`duplicate process id: ${id}`)
    const period = simTime(process.period, 'period')
    if (period === 0) throw new Error('period must be positive')
    const offset = simTime(process.offset ?? 0, 'offset')
    const mechanisms = new Set(process.mechanisms.map(id => nonempty(id, 'mechanism id')))
    if (typeof process.run !== 'function') throw new Error('process run must be a function')
    const rank = this.order.register(process.phase, id)
    const next = offset > this.time ? offset : after(this.time, period - (this.time - offset) % period)
    const entry: Entry = {
      ...rank, last: this.time, run: process.run.bind(process),
      rng: mechanismId => {
        if (!mechanisms.has(mechanismId)) throw new Error(`undeclared mechanism: ${mechanismId}`)
        return this.random.get(mechanismId)
      },
      emit: (type, payload, cause) => {
        if (!this.sink) throw new Error('scheduler emit requires an event sink')
        this.sink({ t: this.time, source: id, ...rank, type, payload, cause })
      },
    }
    let bucket = this.buckets.get(period)
    if (!bucket) {
      bucket = { period, heap: [], groups: new Map() }
      this.buckets.set(period, bucket)
    }
    let group = bucket.groups.get(next)
    if (!group) {
      group = { next, entries: [] }
      bucket.groups.set(next, group)
      push(bucket.heap, group)
    }
    group.entries.push(entry)
    group.entries.sort(compare)
    this.ids.add(id)
    return this
  }

  /** Inclusive endpoint, even when no process is due there. No wall-clock reads. */
  runUntil(target: SimTime): void {
    simTime(target, 'target')
    if (target < this.time) throw new Error('target cannot precede scheduler time')
    if (this.running || this.failed) throw new Error('scheduler cannot run recursively or after failure')
    this.running = true
    try {
      while (true) {
        let next = Infinity
        for (const bucket of this.buckets.values()) next = Math.min(next, bucket.heap[0].next)
        if (next > target) break
        this.time = next
        let due: Entry[] | undefined
        for (const bucket of this.buckets.values()) {
          if (bucket.heap[0].next !== next) continue
          const group = pop(bucket.heap)
          bucket.groups.delete(next)
          due = due ? merge(due, group.entries) : group.entries
          group.next = after(next, bucket.period)
          const existing = bucket.groups.get(group.next)
          if (existing) {
            // A future-offset group can meet an already-running group.
            existing.entries = merge(existing.entries, group.entries)
          } else {
            bucket.groups.set(group.next, group)
            push(bucket.heap, group)
          }
        }
        for (const entry of due!) {
          entry.run({ t: next, dt: next - entry.last, rng: entry.rng, emit: entry.emit })
          entry.last = next
        }
      }
      this.time = target
    } catch (error) {
      // Callbacks may already have changed host state: retrying would double-run them.
      this.failed = true
      throw error
    } finally {
      this.running = false
    }
  }
}
