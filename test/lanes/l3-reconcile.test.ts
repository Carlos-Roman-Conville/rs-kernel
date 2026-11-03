// Test doubles only: in-memory holdings and arbitrary fixture amounts/units.
import { describe, expect, it } from 'vitest'
import {
  Reconciler, transfer, TransferJournal,
  type Participant, type TransferLedger, type TransferRequest,
} from '../../src/index.ts'

class Ledger implements TransferLedger, Participant {
  readonly id: string
  balances: Map<string, number>
  constructor(id: string, accounts: [string, number][] = [['stock', 16], ['other', 0]]) {
    this.id = id
    this.balances = new Map(accounts)
  }
  unit(): string { return 'kg' }
  holdings(): ReadonlyMap<string, number> { return this.balances }
  apply(account: string, _quantity: string, delta: number): void {
    this.balances.set(account, (this.balances.get(account) ?? 0) + delta)
  }
  snapshot(): unknown { return [...this.balances] }
  restore(saved: unknown): void { this.balances = new Map(saved as [string, number][]) }
}

class ViewLedger extends Ledger {
  override unit(_account?: string, quantity?: string): string { return quantity === 'mass' ? 'kg' : 'count' }
  native(account: string, quantity: string, amount: number) {
    return { account: account === 'mass-view' ? 'stock' : account, quantity: 'count',
      amount: quantity === 'mass' ? amount / 2 : amount }
  }
  override apply(account: string, quantity: string, delta: number): void {
    const entry = this.native(account, quantity, delta)
    super.apply(entry.account, entry.quantity, entry.amount)
  }
}

function setup() {
  const a = new Ledger('a'), b = new Ledger('b'), journal = new TransferJournal()
  const reconciler = new Reconciler({ journal,
    ledgers: [a, b].map(ledger => ({ ledger, quantities: ['mass'] })) })
  const request: TransferRequest = { t: 1, process: 'move', quantity: 'mass', unit: 'kg', amount: 2,
    from: { ledger: a, account: 'stock' }, to: { ledger: b, account: 'stock' } }
  reconciler.baseline(0)
  return { a, b, journal, reconciler, request }
}

const q = 2

describe('L3 account reconciliation (PLAN §7a)', () => {
  it('a clean run gives every residual 0', () => {
    const { journal, reconciler, request } = setup()
    transfer(journal, request)
    const report = reconciler.reconcile(1)
    expect(report.failures).toEqual([])
    expect(report.rows.every(row => row.residual === 0 && row.pass)).toBe(true)
  })

  it('an unrecorded +x on one account fails with residual x', () => {
    const { a, reconciler } = setup()
    const x = 3
    a.apply('stock', 'mass', x)
    expect(reconciler.reconcile(1).failures).toMatchObject([{ ledger: 'a', account: 'stock', residual: x }])
  })

  it('an unrecorded equal-and-opposite change within one ledger fails on both accounts', () => {
    const { a, reconciler } = setup()
    a.apply('stock', 'mass', -3)
    a.apply('other', 'mass', 3)
    const report = reconciler.reconcile(1)
    expect(report.failures.map(row => row.residual)).toEqual([-3, 3])
    expect(report.totals[0]).toMatchObject({ deltaH: 0, flows: 0 })
  })

  it('the same equal-and-opposite change across two ledgers fails on both', () => {
    const { a, b, reconciler } = setup()
    a.apply('stock', 'mass', -q)
    b.apply('stock', 'mass', q)
    const report = reconciler.reconcile(1)
    expect(report.failures).toHaveLength(2)
    expect(report.failures.map(row => [row.ledger, row.residual])).toEqual(expect.arrayContaining([
      ['a', -q], ['b', q],
    ]))
  })

  it.each([true, false])('count purchase and kg-view meal reconcile via native() only (native=%s)', native => {
    const owner = new ViewLedger('goods'), vendor = new ViewLedger('vendor'), body = new Ledger('body')
    const journal = new TransferJournal()
    const ledger: TransferLedger = native ? owner : {
      id: owner.id, unit: owner.unit.bind(owner), apply: owner.apply.bind(owner),
      holdings: owner.holdings.bind(owner), snapshot: owner.snapshot.bind(owner), restore: owner.restore.bind(owner),
    }
    const reconciler = new Reconciler({ journal, ledgers: [
      { ledger, quantities: ['count'] }, { ledger: vendor, quantities: ['count'] },
      { ledger: body, quantities: ['mass'] },
    ] })
    reconciler.baseline(0)
    transfer(journal, { t: 1, process: 'purchase', quantity: 'count', unit: 'count', amount: 4,
      from: { ledger: vendor, account: 'stock' }, to: { ledger, account: 'stock' } },
    { t: 1, process: 'eat', quantity: 'mass', unit: 'kg', amount: 2,
      from: { ledger, account: 'mass-view' }, to: { ledger: body, account: 'stock' } })
    const report = reconciler.reconcile(1)
    if (native) {
      expect(report.failures).toEqual([])
      expect(report.rows.every(row => row.residual === 0)).toBe(true)
    } else expect(report.failures.some(row => row.reason === 'view entry without native()')).toBe(true)
  })

  it('a dropped journal entry gives two residuals', () => {
    const { journal, reconciler, request } = setup()
    transfer(journal, request)
    journal.restore(journal.snapshot().slice(0, -1))
    const report = reconciler.reconcile(1)
    expect(report.failures).toHaveLength(2)
    expect(report.failures.every(row => row.residual !== 0)).toBe(true)
  })

  it('a doubled credit gives one residual of q', () => {
    const { b, journal, reconciler, request } = setup()
    transfer(journal, request)
    b.apply('stock', 'mass', q)
    expect(reconciler.reconcile(1).failures).toMatchObject([{ ledger: 'b', account: 'stock', residual: q }])
  })

  it('an entry naming an undeclared account fails', () => {
    const { journal, reconciler } = setup()
    journal.append({ t: 1, process: 'fixture', quantity: 'mass', unit: 'kg', amount: 1,
      from: 'a/stock', to: 'b/missing' })
    const failures = reconciler.reconcile(1).failures
    expect(failures).toContainEqual(expect.objectContaining({
      account: 'missing', reason: 'undeclared account',
    }))
    expect(failures.every(row => !row.pass)).toBe(true)
  })

  it('a residual exactly at tolerance passes and the next float above it fails', () => {
    const ledger = new Ledger('a', [['stock', 0]]), journal = new TransferJournal()
    const reconciler = new Reconciler({ journal, ledgers: [{ ledger, quantities: ['mass'] }], tolerance: () => 0.5 })
    reconciler.baseline(0)
    ledger.balances.set('stock', 0.5)
    expect(reconciler.reconcile(1).rows[0]).toMatchObject({ residual: 0.5, pass: true })
    ledger.balances.set('stock', 1 + Number.EPSILON)
    expect(reconciler.reconcile(2).failures).toHaveLength(1)
  })

  it('a NaN holding fails', () => {
    const { a, reconciler } = setup()
    a.balances.set('stock', NaN)
    expect(reconciler.reconcile(1).failures).toMatchObject([{ reason: 'non-finite holding' }])
  })

  it('a ledger declared unreconciled is named in the report and never passes', () => {
    const { a, b, journal, request } = setup()
    const reconciler = new Reconciler({ journal, unreconciled: ['b'],
      ledgers: [a, b].map(ledger => ({ ledger, quantities: ['mass'] })) })
    reconciler.baseline(0)
    transfer(journal, request)
    for (const t of [1, 2]) {
      const report = reconciler.reconcile(t)
      expect(report.unreconciled).toEqual(['b'])
      expect(report.rows.some(row => row.ledger === 'b')).toBe(false)
      expect(report.rows.every(row => row.pass)).toBe(true)
    }
  })
})
