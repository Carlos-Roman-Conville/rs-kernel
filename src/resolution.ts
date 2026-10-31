import { finite, nonempty } from './guards.ts'
import type { RandomStream, RandomStreams, StreamsState } from './rng.ts'
import type { Process, Scheduler } from './scheduler.ts'
import { simTime, type SimTime } from './time.ts'
import { transaction, type Participant } from './transaction.ts'

export interface ConservedQuantity {
  readonly quantity: string
  readonly unit: string
  /** Absolute tolerance in the declared unit; supplied by the owner. */
  readonly tolerance: number
}

export interface Resolution<A, I> {
  readonly id: string
  readonly conserved: readonly ConservedQuantity[]
  coarsen(individuals: I): A
  refine(aggregate: A, rng: RandomStream): I
}

export type ResolutionMode = 'fine' | 'coarse'
export type ResolutionState<A, I> =
  | { readonly mode: 'coarse'; aggregate: A }
  | { readonly mode: 'fine'; individuals: I }

export interface ResolutionOptions<A, I> {
  readonly resolution: Resolution<A, I>
  readonly scheduler: Scheduler
  readonly initial: ResolutionState<A, I>
  readonly rng: RandomStreams
  readonly mechanismId: string
  /** Read an owner-defined quantity from A, expressed in its declared unit. */
  readonly quantity: (aggregate: A, quantity: string) => number
  /** Include external state, logs and event queues touched by owner callbacks. */
  readonly participants?: readonly Participant[]
}

interface ResolutionSnapshot<A, I> {
  state: ResolutionState<A, I>
  last: [string, SimTime][]
  rng: StreamsState
}

/**
 * Owns the active representation (structured-cloneable data) and is a transaction
 * participant. Register each process through this service, in the host's chosen
 * order. Both sets retain scheduler slots; inactive wrappers skip owner callbacks.
 * Owner callbacks should only transform their arguments and enlisted participants.
 */
export class ResolutionService<A, I> implements Participant {
  readonly id: string
  private readonly resolution: Resolution<A, I>
  private readonly scheduler: Scheduler
  private readonly random: RandomStreams
  private readonly draw: RandomStream
  private readonly quantity: ResolutionOptions<A, I>['quantity']
  private readonly participants: readonly Participant[]
  private current: ResolutionState<A, I>
  private last = new Map<string, SimTime>()
  private readonly modes = new Map<string, ResolutionMode>()
  private switching = false

  constructor(options: ResolutionOptions<A, I>) {
    this.id = nonempty(options.resolution.id, 'resolution id')
    const seen = new Set<string>()
    const conserved = options.resolution.conserved.map(row => {
      nonempty(row.quantity, 'conserved quantity')
      nonempty(row.unit, 'conserved unit')
      finite(row.tolerance, 'conserved tolerance', 0)
      if (seen.has(row.quantity)) throw new Error(`duplicate conserved quantity: ${row.quantity}`)
      seen.add(row.quantity)
      return { ...row }
    })
    this.resolution = {
      id: this.id, conserved,
      coarsen: options.resolution.coarsen.bind(options.resolution),
      refine: options.resolution.refine.bind(options.resolution),
    }
    this.scheduler = options.scheduler
    this.random = options.rng
    this.draw = this.random.get(nonempty(options.mechanismId, 'resolution mechanism id'))
    this.quantity = options.quantity
    this.participants = [...options.participants ?? []]
    this.current = structuredClone(options.initial)
    this.validateMode(this.current.mode)
  }

  /** Processes read/mutate the active data here; a switch replaces its object. */
  get state(): ResolutionState<A, I> { return this.current }
  get mode(): ResolutionMode { return this.current.mode }

  private validateMode(mode: ResolutionMode): void {
    if (mode !== 'fine' && mode !== 'coarse') throw new Error(`unknown resolution mode: ${mode}`)
  }

  private boundary(t: SimTime): void {
    simTime(t, 'resolution switch time')
    if (t !== this.scheduler.t) throw new Error('resolution requires the current scheduler boundary')
    if (this.switching) throw new Error('resolution switch is already in progress')
    // At the current T this performs no work, but the scheduler rejects calls from
    // any process callback (including unrelated processes) or after a failed run.
    this.scheduler.runUntil(t)
  }

  register(mode: ResolutionMode, process: Process): this {
    this.validateMode(mode)
    this.boundary(this.scheduler.t)
    const id = process.id
    this.scheduler.register({
      ...process,
      run: ctx => {
        if (this.mode !== mode) return
        process.run({ ...ctx, dt: ctx.t - this.last.get(id)! })
        this.last.set(id, ctx.t)
      },
    })
    this.modes.set(id, mode)
    this.last.set(id, this.scheduler.t)
    return this
  }

  /**
   * Call after runUntil(T): the old set closes T, and the new set first runs after
   * T on its normal period/offset grid. This never advances the clock itself.
   * An enclosing transaction can enlist this service to roll back a later failure.
   */
  switchTo(mode: ResolutionMode, t: SimTime): ResolutionState<A, I> {
    this.validateMode(mode)
    this.boundary(t)
    if (mode === this.mode) return this.current
    this.switching = true
    try {
      return transaction([this, ...this.participants], () => {
        if (this.current.mode === 'coarse') {
          const aggregate = structuredClone(this.current.aggregate)
          const individuals = this.resolution.refine(structuredClone(aggregate), this.draw)
          // Check on a copy: even a mutating coarsener cannot alter the fine state.
          const roundTrip = this.resolution.coarsen(structuredClone(individuals))
          for (const row of this.resolution.conserved) {
            const before = finite(this.quantity(aggregate, row.quantity), `quantity ${row.quantity}`)
            const after = finite(this.quantity(roundTrip, row.quantity), `quantity ${row.quantity}`)
            if (Math.abs(after - before) > row.tolerance) {
              throw new Error(`resolution ${this.id} does not conserve ${row.quantity} (${row.unit}, tolerance ${row.tolerance})`)
            }
          }
          this.current = { mode: 'fine', individuals }
        } else {
          // Install the complete coarsener result, without rounding or adjustment.
          const aggregate = this.resolution.coarsen(structuredClone(this.current.individuals))
          this.current = { mode: 'coarse', aggregate }
        }
        for (const [id, activeMode] of this.modes) {
          if (activeMode === mode) this.last.set(id, t)
        }
        return this.current
      })
    } finally { this.switching = false }
  }

  snapshot(): ResolutionSnapshot<A, I> {
    return structuredClone({ state: this.current, last: [...this.last], rng: this.random.state() })
  }

  /** Restore at the same scheduler boundary; scheduler time itself is not rewound. */
  restore(snapshot: unknown): void {
    const saved = structuredClone(snapshot) as ResolutionSnapshot<A, I>
    this.current = saved.state
    this.last = new Map(saved.last)
    this.random.restore(saved.rng)
  }
}

export function switchTo<A, I>(service: ResolutionService<A, I>, mode: ResolutionMode, t: SimTime): ResolutionState<A, I> {
  return service.switchTo(mode, t)
}
