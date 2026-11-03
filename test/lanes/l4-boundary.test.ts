// Test doubles only: fixture ledgers, registry rows and arbitrary boundary amounts.
import { describe, expect, it, vi } from 'vitest'
import {
  Reconciler, transfer, transaction, TransferJournal,
  type Boundary, type Participant, type TransferLedger, type TransferRequest,
} from '../../src/index.ts'
import { checkRegistry, type Declaration, type RegistryData } from '../../scripts/check-registry.ts'

class Ledger implements TransferLedger, Participant {
  readonly id: string
  balances: Map<string, number>
  readonly failAccount?: string
  constructor(id: string, accounts: [string, number][] = [['stock', 10]], failAccount?: string) {
    this.id = id
    this.balances = new Map(accounts)
    this.failAccount = failAccount
  }
  unit(_account: string, quantity: string): string {
    if (quantity === 'energy') return 'J'
    return 'kg'
  }
  holdings(quantity: string): ReadonlyMap<string, number> {
    if (quantity !== 'mass') return new Map()
    return this.balances
  }
  apply(account: string, _quantity: string, delta: number): void {
    if (account === this.failAccount) throw new Error('second leg fault')
    this.balances.set(account, (this.balances.get(account) ?? 0) + delta)
  }
  snapshot(): unknown { return [...this.balances] }
  restore(saved: unknown): void { this.balances = new Map(saved as [string, number][]) }
}

function registryFixture(): { r: RegistryData; d: Declaration } {
  return {
    r: { mechanisms: [], quantities: [{ id: 'mass', unit: 'kg', writer: null }] },
    d: { file: 'boundary.json', ledgers: [{ id: 'stock', quantities: ['mass'], reconciled: true }],
      boundaries: [{ ledger: 'stock', account: 'source', quantity: 'mass', kind: 'source' }] },
  }
}

function reconcilerSetup(boundaries: Boundary[], ledgers: TransferLedger[]) {
  const journal = new TransferJournal()
  const reconciler = new Reconciler({ journal, boundaries,
    ledgers: ledgers.map(ledger => ({ ledger, quantities: ['mass', 'energy'] })) })
  reconciler.baseline(0)
  return { journal, reconciler }
}

describe('L4 boundary and transformation records (PLAN §7a)', () => {
  it('an undeclared boundary account fails checkRegistry', () => {
    const { r, d } = registryFixture()
    d.boundaries![0].ledger = 'missing'
    expect(checkRegistry(r, [d])).toEqual(['boundary.json: boundary missing/source/mass names undeclared ledger missing'])
  })

  it('a production change with no source entry fails the reconciler', () => {
    const goods = new Ledger('goods')
    const { reconciler } = reconcilerSetup(
      [{ ledger: 'goods', account: 'source', quantity: 'mass', kind: 'source' }], [goods],
    )
    goods.apply('stock', 'mass', 5)
    expect(reconciler.reconcile(1).failures).toMatchObject([{ ledger: 'goods', account: 'stock', residual: 5 }])
  })

  it('a two-leg transformation through a transform account rolls back both legs when the second leg throws', () => {
    const life = new Ledger('life', [['stock', 10], ['metabolism', 0], ['absorbed', 0]], 'absorbed')
    const journal = new TransferJournal()
    const parts = [journal, life]
    const leg = (fromAccount: string, toAccount: string, amount: number): TransferRequest => ({
      t: 0, process: 'fixture.transform', quantity: 'mass', unit: 'kg', amount,
      from: { ledger: life, account: fromAccount }, to: { ledger: life, account: toAccount },
    })
    const before = [...life.balances.entries()]
    expect(() => transaction(parts, () => {
      transfer(journal, leg('stock', 'metabolism', 4))
      transfer(journal, leg('metabolism', 'absorbed', 1))
    })).toThrow('second leg fault')
    expect([...life.balances.entries()]).toEqual(before)
    expect(journal.length).toBe(0)
  })

  it('crediting a source fails and debiting a sink fails', () => {
    const ledger = new Ledger('owner', [['stock', 10], ['outside', 0], ['loss', 0]])
    const { journal, reconciler } = reconcilerSetup([
      { ledger: 'owner', account: 'outside', quantity: 'mass', kind: 'source' },
      { ledger: 'owner', account: 'loss', quantity: 'mass', kind: 'sink' },
    ], [ledger])
    const move: TransferRequest = { t: 1, process: 'fixture', quantity: 'mass', unit: 'kg', amount: 2,
      from: { ledger, account: 'stock' }, to: { ledger, account: 'stock' } }
    transfer(journal, { ...move, to: { ledger, account: 'outside' } })
    expect(reconciler.reconcile(1).failures).toMatchObject([{ account: 'outside', reason: 'credit to source' }])
    transfer(journal, { ...move, from: { ledger, account: 'loss' }, to: { ledger, account: 'stock' } })
    expect(reconciler.reconcile(2).failures).toMatchObject([{ account: 'loss', reason: 'debit from sink' }])
  })

  it('a transformation leg with a mismatched unit throws', () => {
    const a = new Ledger('a'), b = new Ledger('b'), journal = new TransferJournal()
    vi.spyOn(b, 'unit').mockReturnValue('g')
    expect(() => transfer(journal, {
      t: 0, process: 'fixture', quantity: 'mass', unit: 'kg', amount: 1,
      from: { ledger: a, account: 'stock' }, to: { ledger: b, account: 'stock' },
    })).toThrow('transfer unit mismatch')
  })

  it('does not require a transformation input to equal its output; unequal declared legs pass', () => {
    const life = new Ledger('life', [['stock', 10], ['metabolism', 0], ['absorbed', 0]])
    const { journal, reconciler } = reconcilerSetup(
      [{ ledger: 'life', account: 'metabolism', quantity: 'mass', kind: 'transform' }],
      [life],
    )
    transfer(journal,
      { t: 1, process: 'metabolize', quantity: 'mass', unit: 'kg', amount: 10,
        from: { ledger: life, account: 'stock' }, to: { ledger: life, account: 'metabolism' } },
      { t: 1, process: 'metabolize', quantity: 'mass', unit: 'kg', amount: 3,
        from: { ledger: life, account: 'metabolism' }, to: { ledger: life, account: 'absorbed' } },
    )
    const report = reconciler.reconcile(1)
    expect(report.failures).toEqual([])
    expect(life.balances.get('stock')).toBe(0)
    expect(life.balances.get('absorbed')).toBe(3)
  })
})
