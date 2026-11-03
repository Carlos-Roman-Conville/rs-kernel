// Test doubles only: in-memory ledgers recording received deltas, arbitrary balances and units.
import { describe, expect, it, vi } from 'vitest'
import { canonical, transfer, TransferJournal, type TransferLedger, type TransferRequest, type Participant } from '../../src/index.ts'

type DeltaRecord = { account: string; quantity: string; delta: number }

class Ledger implements TransferLedger, Participant {
  readonly id: string
  private balances = new Map<string, number>()
  readonly received: DeltaRecord[] = []
  private readonly units = new Map<string, string>()

  constructor(id: string, accounts: Record<string, number>, unit = 'g') {
    this.id = id
    for (const [account, amount] of Object.entries(accounts)) {
      this.balances.set(account, amount)
      this.units.set(account, unit)
    }
  }

  unit(account: string, quantity: string): string {
    if (!this.balances.has(account)) throw new Error('balance not held')
    if (quantity !== 'mass') throw new Error('unknown quantity')
    return this.units.get(account)!
  }

  apply(account: string, quantity: string, delta: number): void {
    if (account === 'missing') throw new Error('unknown account')
    this.received.push({ account, quantity, delta })
    this.balances.set(account, this.balances.get(account)! + delta)
  }

  balance(account: string): number { return this.balances.get(account)! }

  snapshot(): { balances: [string, number][]; received: DeltaRecord[] } {
    return { balances: [...this.balances.entries()], received: this.received.map((d: DeltaRecord) => ({ ...d })) }
  }

  restore(saved: unknown): void {
    const state = saved as ReturnType<Ledger['snapshot']>
    this.balances = new Map(state.balances)
    this.received.length = 0
    this.received.push(...state.received.map((d: DeltaRecord) => ({ ...d })))
  }
}

function request(a: Ledger, b: Ledger, patch: Partial<TransferRequest> = {}): TransferRequest {
  return {
    t: 0, process: 'lane.l1', quantity: 'mass', unit: 'g', amount: 2.5,
    from: { ledger: a, account: 'A' }, to: { ledger: b, account: 'B' },
    ...patch,
  }
}

describe('L1 atomic transfer (PLAN §7a)', () => {
  it('q = 2.5 from A = 10 to B = 0 yields balances 7.5 and 2.5 with one entry carrying cause', () => {
    const a = new Ledger('a', { A: 10 }), b = new Ledger('b', { B: 0 }), journal = new TransferJournal()
    const entries = transfer(journal, {
      t: 0, process: 'lane.l1', quantity: 'mass', unit: 'g', amount: 2.5,
      from: { ledger: a, account: 'A' }, to: { ledger: b, account: 'B' }, cause: 'cause.1',
    })
    expect(a.balance('A')).toBe(7.5)
    expect(b.balance('B')).toBe(2.5)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      amount: 2.5, from: 'a/A', to: 'b/B', unit: 'g', cause: 'cause.1',
    })
    expect(journal.length).toBe(1)
  })

  it('ledger apply receives −q and +q bit for bit, including q = 0.1', () => {
    for (const q of [2.5, 0.1]) {
      const a = new Ledger('a', { A: 10 }), b = new Ledger('b', { B: 0 }), journal = new TransferJournal()
      transfer(journal, {
        t: 0, process: 'lane.l1', quantity: 'mass', unit: 'g', amount: q,
        from: { ledger: a, account: 'A' }, to: { ledger: b, account: 'B' },
      })
      expect(a.received).toHaveLength(1)
      expect(b.received).toHaveLength(1)
      expect(Object.is(a.received[0].delta, -q)).toBe(true)
      expect(Object.is(b.received[0].delta, q)).toBe(true)
    }
  })

  it('a batch of three requests appends three journal entries', () => {
    const a = new Ledger('a', { A: 100 }), b = new Ledger('b', { B: 0 }), journal = new TransferJournal()
    const request = {
      t: 0, process: 'lane.l1', quantity: 'mass', unit: 'g', amount: 1,
      from: { ledger: a, account: 'A' }, to: { ledger: b, account: 'B' },
    }
    transfer(journal, request, { ...request, t: 1 }, { ...request, t: 2, amount: 2 })
    expect(journal.length).toBe(3)
  })

  it.each([
    { label: 'zero amount', patch: { amount: 0 }, message: 'transfer amount must be positive' },
    { label: 'negative amount', patch: { amount: -1 }, message: 'transfer amount must be positive' },
    { label: 'NaN amount', patch: { amount: NaN }, message: 'transfer amount must be a number' },
    { label: 'infinite amount', patch: { amount: Infinity }, message: 'transfer amount must be a number' },
  ])('invalid $label leaves ledgers and journal unchanged', ({ patch, message }) => {
    const a = new Ledger('a', { A: 10 }), b = new Ledger('b', { B: 0 }), journal = new TransferJournal()
    const req = request(a, b, patch)
    const before = canonical([a.snapshot(), b.snapshot(), journal.snapshot()])
    expect(() => transfer(journal, req)).toThrow(message)
    expect(canonical([a.snapshot(), b.snapshot(), journal.snapshot()])).toBe(before)
  })

  it('identical endpoints leave state unchanged', () => {
    const a = new Ledger('a', { A: 10, B: 0 }), journal = new TransferJournal()
    const request = {
      t: 0, process: 'lane.l1', quantity: 'mass', unit: 'g', amount: 1,
      from: { ledger: a, account: 'A' }, to: { ledger: a, account: 'A' },
    }
    const before = canonical([a.snapshot(), journal.snapshot()])
    expect(() => transfer(journal, request)).toThrow('transfer endpoints must differ')
    expect(canonical([a.snapshot(), journal.snapshot()])).toBe(before)
  })

  it('unknown account leaves state unchanged when apply throws', () => {
    const a = new Ledger('a', { A: 10 }), b = new Ledger('b', { missing: 0 }), journal = new TransferJournal()
    const request = {
      t: 0, process: 'lane.l1', quantity: 'mass', unit: 'g', amount: 1,
      from: { ledger: a, account: 'A' }, to: { ledger: b, account: 'missing' },
    }
    const before = canonical([a.snapshot(), b.snapshot(), journal.snapshot()])
    expect(() => transfer(journal, request)).toThrow('unknown account')
    expect(canonical([a.snapshot(), b.snapshot(), journal.snapshot()])).toBe(before)
  })

  it('kg against g leaves state unchanged', () => {
    const a = new Ledger('a', { A: 10 }, 'kg'), b = new Ledger('b', { B: 0 }, 'g'), journal = new TransferJournal()
    const request = {
      t: 0, process: 'lane.l1', quantity: 'mass', unit: 'g', amount: 1,
      from: { ledger: a, account: 'A' }, to: { ledger: b, account: 'B' },
    }
    const before = canonical([a.snapshot(), b.snapshot(), journal.snapshot()])
    const applyA = vi.spyOn(a, 'apply'), applyB = vi.spyOn(b, 'apply')
    expect(() => transfer(journal, request)).toThrow('transfer unit mismatch')
    expect(applyA).not.toHaveBeenCalled()
    expect(applyB).not.toHaveBeenCalled()
    expect(canonical([a.snapshot(), b.snapshot(), journal.snapshot()])).toBe(before)
  })
})
