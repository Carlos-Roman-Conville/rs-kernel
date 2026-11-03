import { describe, expect, it, vi } from 'vitest'
import { canonical, EventBus, transfer, TransferJournal, type TransferLedger } from '../src/index.ts'
import { OUTCOME, RESOLVER_SOURCE, Refusal, Resolver, type Intention } from './resolver.ts'

// Test doubles only: arbitrary holdings and units, no engine policy or world data.
class FixtureLedger implements TransferLedger {
  readonly id: string
  amount: number
  constructor(id: string, amount = 10) { this.id = id; this.amount = amount }
  unit(): string { return 'kg' }
  apply(_account: string, _quantity: string, delta: number): void { this.amount += delta }
  snapshot(): number { return this.amount }
  restore(snapshot: unknown): void { this.amount = snapshot as number }
}

const at = { t: 0, phase: 2, position: 1 }
const intention: Intention = { id: 'intention.1', kind: 'fixture.move', terms: {} }
function setup() {
  const bus = new EventBus(), journal = new TransferJournal()
  const source = new FixtureLedger('fixture.source'), destination = new FixtureLedger('fixture.destination', 0)
  const resolver = new Resolver({ bus, journal })
  const participants = [source, destination]
  const move = (cause: string | undefined = intention.id) => transfer(journal, {
    t: at.t, process: 'fixture.move', quantity: 'fixture.mass', unit: 'kg', amount: 2,
    from: { ledger: source, account: 'stock' }, to: { ledger: destination, account: 'stock' },
    ...(cause === '' ? {} : { cause }),
  })
  const run = () => { move(); return { done: true } }
  const ownerEvent = () => bus.emit({ ...at, source: 'fixture.owner', type: 'fixture.changed', payload: {} })
  const outcomes = () => {
    const events = bus.since().filter(event => event.source === RESOLVER_SOURCE)
    expect(events.every(event => event.type === OUTCOME)).toBe(true)
    return events.map(event => event.payload)
  }
  return { bus, journal, source, destination, resolver, participants, move, run, ownerEvent, outcomes }
}

describe('harness outcome resolver', () => {
  it('completes one step with one cause-linked entry and a correctly positioned outcome', () => {
    const f = setup()
    f.resolver.step(intention, { participants: f.participants, run: f.run }, at)
    expect(f.outcomes()).toEqual([{
      intention: intention.id, kind: intention.kind, status: 'completed', reason: null,
      steps: 1, entries: [0], detail: {},
    }])
    expect(f.journal.entries()).toHaveLength(1)
    expect(f.journal.entries()[0].cause).toBe(intention.id)
    expect([f.source.amount, f.destination.amount]).toEqual([8, 2])
    expect(f.bus.recordsSince()[0]).toMatchObject({ phase: at.phase, position: at.position,
      event: { t: at.t, cause: intention.id, source: RESOLVER_SOURCE, type: OUTCOME } })
    expect(f.resolver.open()).toEqual([])
    expect(() => f.resolver.assertSettled()).not.toThrow()
  })

  it('rolls back an owner refusal after transfer and emits outside the transaction', () => {
    const f = setup(), before = canonical(f.participants.map(p => p.snapshot()))
    f.resolver.step(intention, { participants: f.participants, run: () => {
      f.move(); f.ownerEvent(); throw new Refusal('owner capacity')
    } }, at)
    expect(canonical(f.participants.map(p => p.snapshot()))).toBe(before)
    expect(f.journal.length).toBe(0)
    expect(f.outcomes()).toEqual([{
      intention: intention.id, kind: intention.kind, status: 'failed', reason: 'owner capacity',
      steps: 0, entries: [], detail: {},
    }])
    expect(f.bus.since()).toHaveLength(1)
    expect(f.bus.since()[0].id).toBe('evt.000001')
  })

  it('IT-M1a-3 shape: destination apply throws between debit and credit; neither leg survives', () => {
    const f = setup(), before = canonical(f.participants.map(p => p.snapshot()))
    vi.spyOn(f.destination, 'apply').mockImplementation(() => {
      expect(f.source.amount).toBe(8)
      expect(f.destination.amount).toBe(0)
      throw new Error('injected credit fault')
    })
    f.resolver.step(intention, { participants: f.participants, run: () => {
      f.ownerEvent(); return f.run()
    } }, at)
    expect(canonical(f.participants.map(p => p.snapshot()))).toBe(before)
    expect(f.journal.length).toBe(0)
    expect(f.outcomes()).toEqual([{
      intention: intention.id, kind: intention.kind, status: 'failed', reason: 'technical',
      diagnostic: { name: 'Error', message: 'injected credit fault' }, steps: 0, entries: [], detail: {},
    }])
    expect(f.bus.since()).toHaveLength(1)
    expect(() => f.resolver.assertSettled()).not.toThrow()
  })

  it('keeps committed effort when a later step refuses, with exactly one outcome', () => {
    const f = setup(), effort = new FixtureLedger('fixture.effort'), spent = new FixtureLedger('fixture.spent', 0)
    f.resolver.step(intention, { participants: [effort, spent], run: () => {
      transfer(f.journal, { t: 0, process: 'fixture.effort', quantity: 'fixture.effort', unit: 'kg', amount: 3,
        from: { ledger: effort, account: 'stock' }, to: { ledger: spent, account: 'stock' }, cause: intention.id })
      return { done: false, detail: { effort: 3 } }
    } }, at)
    expect(f.outcomes()).toEqual([])
    f.resolver.step(intention, { participants: f.participants, run: () => {
      f.move(); throw new Refusal('interrupted')
    } }, at)
    expect([effort.amount, spent.amount, f.source.amount, f.destination.amount]).toEqual([7, 3, 10, 0])
    expect(f.journal.entries()).toHaveLength(1)
    expect(f.journal.entries()[0].process).toBe('fixture.effort')
    expect(f.outcomes()).toEqual([expect.objectContaining({
      status: 'failed', reason: 'interrupted', steps: 1, entries: [0], detail: { effort: 3 },
    })])
  })

  it('retries only by explicit allowance, then completes exactly once', () => {
    const f = setup(), retrying = { ...intention, retries: 1 }, precondition = vi.fn(() => null)
    f.resolver.step(retrying, { participants: f.participants, precondition, run: () => {
      f.move(); f.ownerEvent(); throw new Error('temporary')
    } }, at)
    expect(f.outcomes()).toEqual([])
    expect(f.journal.length).toBe(0)
    expect([f.source.amount, f.destination.amount]).toEqual([10, 0])
    expect(f.resolver.open()).toEqual([intention.id])
    f.resolver.step(retrying, { participants: f.participants, precondition, run: f.run }, at)
    expect(precondition).toHaveBeenCalledTimes(1)
    expect(f.outcomes()).toEqual([expect.objectContaining({ status: 'completed', steps: 1, entries: [0] })])
  })

  it('settles when its retry allowance is exhausted, including non-Error throws', () => {
    const f = setup(), retrying = { ...intention, retries: 1 }
    const step = { participants: [], run: () => { throw 'broken' } }
    f.resolver.step(retrying, step, at)
    f.resolver.step(retrying, step, at)
    expect(f.outcomes()).toEqual([expect.objectContaining({ status: 'failed', reason: 'technical',
      diagnostic: { name: 'Error', message: 'broken' }, steps: 0 })])
    expect(f.resolver.open()).toEqual([])
  })

  it('lists every open intention at run end', () => {
    const f = setup()
    for (const id of ['open.1', 'open.2']) {
      f.resolver.step({ ...intention, id }, { participants: [], run: () => ({ done: false }) }, at)
    }
    expect(f.resolver.open()).toEqual(['open.1', 'open.2'])
    expect(() => f.resolver.assertSettled()).toThrow('unsettled intentions: open.1, open.2')
  })

  it('an impossible precondition runs no transaction, including an empty reason', () => {
    for (const reason of ['unavailable', '']) {
      const f = setup(), snapshot = vi.spyOn(f.source, 'snapshot'), run = vi.fn(f.run)
      f.resolver.step(intention, { participants: f.participants, precondition: () => reason, run }, at)
      expect(run).not.toHaveBeenCalled()
      expect(snapshot).not.toHaveBeenCalled()
      expect(f.journal.length).toBe(0)
      expect(f.outcomes()).toEqual([expect.objectContaining({ status: 'impossible', reason, steps: 0, entries: [] })])
      expect(() => f.resolver.assertSettled()).not.toThrow()
    }
  })

  it('rejects a second step after close without another transaction or outcome', () => {
    const f = setup(), step = { participants: f.participants, run: vi.fn(f.run) }
    f.resolver.step(intention, step, at)
    expect(() => f.resolver.step(intention, step, at)).toThrow(`intention already closed: ${intention.id}`)
    expect(step.run).toHaveBeenCalledTimes(1)
    expect(f.outcomes()).toHaveLength(1)
  })

  it.each(['', 'wrong.intention'])('rolls back all entries when one has an absent or wrong cause (%s)', cause => {
    const f = setup()
    f.resolver.step(intention, { participants: f.participants, run: () => {
      f.move(); f.move(cause); f.ownerEvent(); return { done: true }
    } }, at)
    expect(f.journal.length).toBe(0)
    expect([f.source.amount, f.destination.amount]).toEqual([10, 0])
    expect(f.bus.since()).toHaveLength(1)
    expect(f.outcomes()).toEqual([expect.objectContaining({ status: 'failed', reason: 'technical',
      steps: 0, entries: [], diagnostic: { name: 'Error', message: `journal entry 1 must carry cause ${intention.id}` } })])
  })

  it('merges committed details and records absolute journal indices across interleaved intentions', () => {
    const f = setup()
    f.resolver.step(intention, { participants: f.participants, run: () => {
      f.move(); return { done: false, detail: { first: true, updated: 1 } }
    } }, at)
    f.resolver.step({ ...intention, id: 'other' }, { participants: f.participants, run: () => {
      f.move('other'); return { done: true }
    } }, at)
    f.resolver.step(intention, { participants: f.participants, precondition: () => 'must not run', run: () => {
      f.move(); return { done: true, detail: { updated: 2 } }
    } }, at)
    expect(f.outcomes()).toEqual([
      expect.objectContaining({ intention: 'other', steps: 1, entries: [1] }),
      expect.objectContaining({ intention: intention.id, steps: 2, entries: [0, 2], detail: { first: true, updated: 2 } }),
    ])
  })

  it('restores detached progress, retry counts and closed ids for deterministic replay', () => {
    const f = setup(), retrying = { ...intention, retries: 1 }
    f.resolver.step({ ...intention, id: 'closed' }, { participants: [], run: () => ({ done: true }) }, at)
    f.resolver.step(retrying, { participants: f.participants, run: () => {
      f.move(); return { done: false, detail: { nested: { value: 1 } } }
    } }, at)
    const failure = { participants: f.participants, run: () => { f.move(); throw new Error('retry fault') } }
    f.resolver.step(retrying, failure, at)
    const state = f.resolver.state(), bus = f.bus.state(), journal = f.journal.snapshot()
    const ledgers = f.participants.map(p => p.snapshot())
    f.resolver.step(retrying, failure, at)
    const expected = canonical({ resolver: f.resolver.state(), bus: f.bus.state(), journal: f.journal.snapshot() })
    f.resolver.restore(state); f.bus.restore(bus); f.journal.restore(journal)
    f.participants.forEach((p, i) => p.restore(ledgers[i]))
    state.intentions.length = 0
    const detached = f.resolver.state()
    detached.intentions[1].entries.push(999)
    ;(detached.intentions[1].detail.nested as { value: number }).value = 999
    expect(() => f.resolver.step({ ...intention, id: 'closed' }, failure, at)).toThrow('already closed')
    f.resolver.step(retrying, failure, at)
    expect(canonical({ resolver: f.resolver.state(), bus: f.bus.state(), journal: f.journal.snapshot() })).toBe(expected)
    expect(f.outcomes()).toHaveLength(2)
  })
})
