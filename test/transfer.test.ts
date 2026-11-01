import { describe, expect, it, vi } from 'vitest'
import { transfer, TransferJournal, type TransferLedger, type TransferRequest } from '../src/index.ts'

class Ledger implements TransferLedger {
  readonly id: string
  balances = new Map<string, number>()
  units = new Map([['mass', 'kg'], ['substance', 'mol']])
  readonly refusal = new Error('owner refuses negative balance')

  constructor(id: string) {
    this.id = id
    for (const account of ['stock', 'loss']) {
      for (const quantity of this.units.keys()) this.balances.set(`${account}/${quantity}`, 32)
    }
  }

  unit(account: string, quantity: string): string {
    if (!this.balances.has(`${account}/${quantity}`) || !this.units.has(quantity)) {
      throw new Error('balance not held')
    }
    return this.units.get(quantity)!
  }

  apply(account: string, quantity: string, delta: number): void {
    const key = `${account}/${quantity}`
    const next = this.balances.get(key)! + delta
    if (next < 0) throw this.refusal
    this.balances.set(key, next)
  }

  snapshot(): Map<string, number> { return new Map(this.balances) }
  restore(saved: unknown): void { this.balances = new Map(saved as Map<string, number>) }
}

function setup() {
  const a = new Ledger('a'), b = new Ledger('b'), journal = new TransferJournal()
  const request: TransferRequest = {
    t: 0, process: 'move', quantity: 'mass', unit: 'kg', amount: 0.5,
    from: { ledger: a, account: 'stock' }, to: { ledger: b, account: 'stock' },
  }
  return { a, b, journal, request }
}

describe('transfer bookkeeping', () => {
  it('conserves each quantity at each tick and reconciles every ledger balance to entries', () => {
    const { a, b, journal, request } = setup()
    const before = [a.snapshot(), b.snapshot()]
    transfer(journal,
      request,
      { ...request, amount: 2, quantity: 'substance', unit: 'mol' },
      { ...request, t: 1, amount: 1.25, from: request.to, to: request.from },
      { ...request, t: 1, amount: 4, quantity: 'substance', unit: 'mol' },
      { ...request, t: 2, amount: 0.25 },
    )
    for (const t of [0, 1, 2]) {
      for (const [quantity, totals] of journal.balance(t)) {
        const expected = journal.entries().filter(e => e.t === t && e.quantity === quantity)
          .reduce((sum, e) => sum + e.amount, 0)
        expect(totals).toEqual({ debits: expected, credits: expected })
      }
    }
    expect(journal.balance().get('mass')).toEqual({ debits: 2, credits: 2 })
    expect(journal.balance().get('substance')).toEqual({ debits: 6, credits: 6 })
    expect(journal.balance(3).size).toBe(0)
    for (const [i, ledger] of [a, b].entries()) {
      for (const [key, value] of ledger.balances) {
        const [account, quantity] = key.split('/')
        const endpoint = `${ledger.id}/${account}`
        const delta = journal.entries().filter(e => e.quantity === quantity).reduce((sum, e) =>
          sum + (e.to === endpoint ? e.amount : 0) - (e.from === endpoint ? e.amount : 0), 0)
        expect(value - before[i].get(key)!).toBe(delta)
      }
    }
  })

  it('applies exactly minus q and plus q, recording a loss as a separate request', () => {
    const { a, b, journal, request } = setup()
    const result = transfer(journal, request, {
      ...request, amount: 0.25, to: { ledger: b, account: 'loss' }, note: 'loss',
    })
    expect(a.balances.get('stock/mass')).toBe(31.25)
    expect(b.balances.get('stock/mass')).toBe(32.5)
    expect(b.balances.get('loss/mass')).toBe(32.25)
    expect(result).toEqual([
      { t: 0, process: 'move', quantity: 'mass', unit: 'kg', amount: 0.5, from: 'a/stock', to: 'b/stock' },
      { t: 0, process: 'move', quantity: 'mass', unit: 'kg', amount: 0.25, from: 'a/stock', to: 'b/loss', note: 'loss' },
    ])
    result[0].amount = 999
    expect(journal.entries()[0].amount).toBe(0.5)
  })

  it('restores both ledgers and prior journal on a third-request owner refusal, rethrowing the same error', () => {
    const { a, b, journal, request } = setup()
    transfer(journal, request)
    const before = [a.snapshot(), b.snapshot(), journal.snapshot()]
    const snapshotA = vi.spyOn(a, 'snapshot'), snapshotB = vi.spyOn(b, 'snapshot')
    const apply = b.apply.bind(b)
    vi.spyOn(b, 'apply').mockImplementation((account, quantity, delta) => {
      apply(account, quantity, delta)
      if (account === 'loss') throw b.refusal
    })
    let caught: unknown
    try {
      transfer(journal, request, request, { ...request, to: { ledger: b, account: 'loss' } })
    } catch (error) { caught = error }
    expect(caught).toBe(b.refusal)
    expect(snapshotA).toHaveBeenCalledTimes(1)
    expect(snapshotB).toHaveBeenCalledTimes(1)
    expect([a.snapshot(), b.snapshot(), journal.snapshot()]).toEqual(before)
  })

  it.each(['mol', 'g', 'unknown', ' kg '])('rejects destination unit %s before applying anything', unit => {
    const { a, b, journal, request } = setup()
    b.units.set('mass', unit)
    const applyA = vi.spyOn(a, 'apply'), applyB = vi.spyOn(b, 'apply')
    expect(() => transfer(journal, request)).toThrow()
    expect(applyA).not.toHaveBeenCalled()
    expect(applyB).not.toHaveBeenCalled()
    expect(journal.entries()).toEqual([])
  })

  it('checks source and request units and missing balances', () => {
    const { a, b, journal, request } = setup()
    const before = [a.snapshot(), b.snapshot()]
    expect(() => transfer(journal, { ...request, unit: 'unknown' })).toThrow()
    a.units.set('mass', 'g')
    expect(() => transfer(journal, request)).toThrow('unit mismatch')
    a.units.set('mass', 'kg')
    expect(() => transfer(journal, { ...request, to: { ledger: b, account: 'absent' } })).toThrow('balance not held')
    expect([a.snapshot(), b.snapshot()]).toEqual(before)
    expect(journal.entries()).toEqual([])
  })

  it.each<Partial<TransferRequest>>([
    { amount: 0 }, { amount: -1 }, { amount: NaN }, { amount: Infinity },
    { process: '' }, { process: ' ' }, { quantity: '' }, { t: -1 }, { t: 0.5 }, { t: NaN },
  ])('rejects invalid request %j and rolls back earlier requests', invalid => {
    const { a, b, journal, request } = setup()
    const before = [a.snapshot(), b.snapshot(), journal.snapshot()]
    expect(() => transfer(journal, request, { ...request, ...invalid })).toThrow()
    expect([a.snapshot(), b.snapshot(), journal.snapshot()]).toEqual(before)
  })

  it('rejects empty accounts and identical endpoints; permits two accounts on one ledger', () => {
    const { a, journal, request } = setup()
    expect(() => transfer(journal, { ...request, to: request.from })).toThrow('endpoints must differ')
    for (const side of ['from', 'to'] as const) {
      expect(() => transfer(journal, { ...request, [side]: { ledger: a, account: '' } })).toThrow()
    }
    transfer(journal, { ...request, to: { ledger: a, account: 'loss' } })
    expect(a.balances.get('stock/mass')).toBe(31.5)
    expect(a.balances.get('loss/mass')).toBe(32.5)
  })

  it('round-trips snapshots and detaches entries, snapshots and restored state', () => {
    const { journal, request } = setup()
    transfer(journal, request)
    const saved = journal.snapshot(), expected = journal.entries()
    const entries = journal.entries()
    entries[0].amount = 99
    entries.length = 0
    transfer(journal, request)
    expect(saved).toEqual(expected)
    journal.restore(saved)
    saved[0].amount = 42
    expect(journal.entries()).toEqual(expected)
    expect(transfer(journal)).toEqual([])
    expect(journal.entries()).toEqual(expected)
  })
})
