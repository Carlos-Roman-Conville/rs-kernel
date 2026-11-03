import {
  eventsParticipant, transaction,
  type EventBus, type Participant, type SimTime, type TransferJournal,
} from '../src/index.ts'

export const RESOLVER_SOURCE = 'kernel.harness.resolver'
export const OUTCOME = 'shared.action.outcome'

export class Refusal extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(reason)
    this.name = 'Refusal'
    this.reason = reason
  }
}

export interface Intention { id: string; kind: string; terms: unknown; retries?: number }
export interface Step {
  participants: Participant[]
  precondition?: () => string | null
  run: () => { done: boolean; detail?: Record<string, unknown> }
}

interface Progress {
  intention: Intention
  retriesUsed: number
  closed: boolean
  steps: number
  entries: number[]
  detail: Record<string, unknown>
}
export interface ResolverState { intentions: Progress[] }
type At = { t: SimTime; phase: number; position: number }
type Diagnostic = { name: string; message: string }

/** Generic host envelope: owners supply all legs, policies and detail fields.
 * Each step commits separately; a terminal event is emitted after its transaction.
 */
export class Resolver {
  private readonly bus: EventBus
  private readonly journal: TransferJournal
  private intentions = new Map<string, Progress>()

  constructor(options: { bus: EventBus; journal: TransferJournal }) {
    this.bus = options.bus
    this.journal = options.journal
  }

  step(intention: Intention, step: Step, at: At): void {
    let progress = this.intentions.get(intention.id)
    if (progress?.closed) throw new Error(`intention already closed: ${intention.id}`)
    const first = progress === undefined
    if (!progress) {
      const retries = intention.retries ?? 0
      if (!Number.isSafeInteger(retries) || retries < 0) throw new Error('retries must be a non-negative safe integer')
      progress = { intention: structuredClone(intention), retriesUsed: 0, closed: false, steps: 0, entries: [], detail: {} }
      this.intentions.set(intention.id, progress)
    }

    let result: ReturnType<Step['run']>
    let entries: number[] = []
    let impossible: string | null = null
    try {
      if (first) impossible = step.precondition?.() ?? null
      if (impossible === null) {
        result = transaction([eventsParticipant(this.bus), this.journal, ...step.participants], () => {
          const start = this.journal.length
          const committed = step.run()
          entries = this.journal.since(start).map((entry, offset) => {
            if (entry.cause !== intention.id) throw new Error(`journal entry ${start + offset} must carry cause ${intention.id}`)
            return start + offset
          })
          // Detach owner detail while rollback is still possible.
          return structuredClone(committed)
        })
      }
    } catch (error) {
      if (error instanceof Refusal) {
        this.close(progress, 'failed', error.reason, at)
      } else if (progress.retriesUsed < (progress.intention.retries ?? 0)) {
        progress.retriesUsed++
      } else {
        this.close(progress, 'failed', 'technical', at, {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
        })
      }
      return
    }

    if (impossible !== null) {
      this.close(progress, 'impossible', impossible, at)
      return
    }
    progress.steps++
    progress.entries.push(...entries)
    progress.detail = { ...progress.detail, ...result!.detail }
    if (result!.done) this.close(progress, 'completed', null, at)
  }

  private close(progress: Progress, status: 'impossible' | 'failed' | 'completed', reason: string | null,
    at: At, diagnostic?: Diagnostic): void {
    this.bus.emit({ ...at, source: RESOLVER_SOURCE, type: OUTCOME, cause: progress.intention.id,
      payload: {
        intention: progress.intention.id, kind: progress.intention.kind, status, reason,
        steps: progress.steps, entries: progress.entries, detail: progress.detail,
        ...(diagnostic === undefined ? {} : { diagnostic }),
      },
    })
    progress.closed = true
  }

  open(): string[] {
    return [...this.intentions.values()].filter(progress => !progress.closed).map(progress => progress.intention.id)
  }

  assertSettled(): void {
    const open = this.open()
    if (open.length) throw new Error(`unsettled intentions: ${open.join(', ')}`)
  }

  /** The host must snapshot/restore the bus, journal and owners alongside this state. */
  state(): ResolverState { return structuredClone({ intentions: [...this.intentions.values()] }) }
  restore(state: ResolverState): void {
    this.intentions = new Map(structuredClone(state.intentions).map(progress => [progress.intention.id, progress]))
  }
}
