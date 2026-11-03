// Test doubles only: fixture processes, ledgers and declared input lists; no world semantics.
import { describe, expect, it } from 'vitest'
import {
  canonical, EventBus, Reconciler, Scheduler, SECOND, streams, transfer, TransferJournal,
  type TransferLedger, type TransferRequest,
} from '../../src/index.ts'

class Ledger implements TransferLedger, Participant {
  readonly id: string
  private balances = new Map<string, number>([['stock', 20]])
  constructor(id: string) { this.id = id }
  unit(): string { return 'kg' }
  holdings(): ReadonlyMap<string, number> { return this.balances }
  apply(account: string, _quantity: string, delta: number): void {
    this.balances.set(account, (this.balances.get(account) ?? 0) + delta)
  }
  snapshot(): unknown { return [...this.balances] }
  restore(saved: unknown): void { this.balances = new Map(saved as [string, number][]) }
}

const laneOrder = {
  phases: ['fast', 'check'],
  order: { fast: ['lane.producer'], check: ['kernel.reconcile'] },
} as const

type RunOutcome = { journal: string; bus: string; reports: string; rng: string }

function declaredInputs(source: Ledger, sink: Ledger): TransferRequest[] {
  return [{
    t: SECOND, process: 'lane.producer', quantity: 'mass', unit: 'kg', amount: 2,
    from: { ledger: source, account: 'stock' }, to: { ledger: sink, account: 'stock' },
  }]
}

function runOnce(
  seed: number,
  options?: { extra?: TransferRequest; stochastic?: boolean },
): RunOutcome {
  const source = new Ledger('fixture.source'), sink = new Ledger('fixture.sink')
  const inputs = declaredInputs(source, sink)
  const journal = new TransferJournal(), bus = new EventBus()
  const reconciler = new Reconciler({ journal, ledgers: [
    { ledger: source, quantities: ['mass'] }, { ledger: sink, quantities: ['mass'] },
  ] })
  const random = streams(seed)

  const clock = new Scheduler({ order: laneOrder, rng: random, emit: event => { bus.emit(event) } })
  reconciler.baseline(0)
  clock.register(reconciler.process({ period: SECOND, throwOnFailure: false }))
  clock.register({
    id: 'lane.producer', mechanisms: options?.stochastic ? ['lane.noise'] : [], period: SECOND, phase: 'fast',
    run: ctx => {
      for (const request of inputs) {
        if (request.t === ctx.t) transfer(journal, request)
      }
      if (options?.extra?.t === ctx.t) transfer(journal, options.extra)
      if (options?.stochastic) {
        ctx.emit('lane.draw', ctx.rng('lane.noise')(), 'cause.lane')
      }
    },
  })
  clock.runUntil(SECOND)

  return {
    journal: canonical(journal.entries()),
    bus: canonical(bus.state()),
    reports: canonical(reconciler.reports()),
    rng: canonical(random.state()),
  }
}

describe('L6 replay (PLAN §7a)', () => {
  it('two runs from the same initial state and seed match journal, bus and reconciler reports', () => {
    const first = runOnce(7)
    const second = runOnce(7)
    expect(second.journal).toBe(first.journal)
    expect(second.bus).toBe(first.bus)
    expect(second.reports).toBe(first.reports)
  })

  it('mutation: an extra transfer outside the declared input list changes the canonical bundle', () => {
    const baseline = runOnce(11)
    const source = new Ledger('fixture.source'), sink = new Ledger('fixture.sink')
    const extra: TransferRequest = {
      t: SECOND, process: 'lane.external', quantity: 'mass', unit: 'kg', amount: 1,
      from: { ledger: source, account: 'stock' }, to: { ledger: sink, account: 'stock' },
    }
    const mutated = runOnce(11, { extra })
    expect(mutated.journal).not.toBe(baseline.journal)
    expect(canonical([mutated.journal, mutated.bus, mutated.reports]))
      .not.toBe(canonical([baseline.journal, baseline.bus, baseline.reports]))
  })

  it('a second seed changes stochastic outputs but not a deterministic journal', () => {
    const seedA = runOnce(1, { stochastic: true })
    const seedB = runOnce(2, { stochastic: true })
    expect(seedB.rng).not.toBe(seedA.rng)
    expect(seedB.bus).not.toBe(seedA.bus)
    const noStochasticA = runOnce(1)
    const noStochasticB = runOnce(2)
    expect(noStochasticB.journal).toBe(noStochasticA.journal)
  })
})
