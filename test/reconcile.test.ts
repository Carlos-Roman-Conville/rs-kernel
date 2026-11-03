import { describe, expect, it, vi } from 'vitest'
import {
  canonical, Reconciler, transfer, TransferJournal, withinTolerance,
  type Boundary, type ProcessContext, type TransferLedger, type TransferRequest, type ToleranceSpec,
} from '../src/index.ts'

// Test doubles only: in-memory holdings and arbitrary fixture amounts/units.
class Ledger implements TransferLedger {
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

// Owner-defined fixture view: two arbitrary kg per count, not a production conversion.
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

function setup(boundaries: Boundary[] = []) {
  const a = new Ledger('a'), b = new Ledger('b'), journal = new TransferJournal()
  const reconciler = new Reconciler({ journal, boundaries,
    ledgers: [a, b].map(ledger => ({ ledger, quantities: ['mass'] })) })
  const request: TransferRequest = { t: 1, process: 'move', quantity: 'mass', unit: 'kg', amount: 2,
    from: { ledger: a, account: 'stock' }, to: { ledger: b, account: 'stock' } }
  reconciler.baseline(0)
  return { a, b, journal, reconciler, request }
}

const context = (t: number): ProcessContext => ({ t, dt: 1,
  rng: () => { throw new Error('unexpected RNG') }, emit: () => { throw new Error('unexpected emission') } })

describe('withinTolerance', () => {
  // Adjacent representable floats, so boundary checks cannot hide a rounding gap.
  const adjacent = (value: number, step: bigint) => {
    const buffer = new ArrayBuffer(8), view = new DataView(buffer)
    view.setFloat64(0, value)
    view.setBigUint64(0, view.getBigUint64(0) + step)
    return view.getFloat64(0)
  }

  it.each([0.5, -0.5, 8, -8])('preserves numeric tolerance at current holdings %s', current => {
    const limit = 0.1 * Math.max(1, Math.abs(current))
    for (const sign of [-1, 1]) {
      expect(withinTolerance(sign * adjacent(limit, -1n), 0.1, 100, current, 100)).toBe(true)
      expect(withinTolerance(sign * limit, 0.1, 100, current, 100)).toBe(true)
      expect(withinTolerance(sign * adjacent(limit, 1n), 0.1, 100, current, 100)).toBe(false)
    }
  })

  it('uses current holdings without a floor', () => {
    const tolerance: ToleranceSpec = { abs: 0, rel: 0.1, scale: 'current' }
    expect(withinTolerance(0.05, tolerance, 100, 0.5, 100)).toBe(true)
    expect(withinTolerance(adjacent(0.05, 1n), tolerance, 100, 0.5, 100)).toBe(false)
  })

  it.each([[-8, 2, 3], [2, -8, 3], [2, 3, 8]])('uses span max for %s, %s, %s', (x0, x1, volume) => {
    const tolerance: ToleranceSpec = { abs: 0.5, rel: 0.25, scale: 'span' }
    expect(withinTolerance(2.5, tolerance, x0, x1, volume)).toBe(true)
    expect(withinTolerance(adjacent(2.5, 1n), tolerance, x0, x1, volume)).toBe(false)
  })

  it.each([undefined, { abs: 0, rel: 0, scale: 'current' } as const])('keeps exact tolerance %s', tolerance => {
    for (const residual of [0, -0]) expect(withinTolerance(residual, tolerance, 10, 10, 20)).toBe(true)
    for (const residual of [Number.MIN_VALUE, -Number.MIN_VALUE, NaN, Infinity, -Infinity]) {
      expect(withinTolerance(residual, tolerance, 10, 10, 20)).toBe(false)
    }
  })

  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid tolerance components and volume: %s', value => {
    expect(() => withinTolerance(0, value, 0, 0, 0)).toThrow()
    for (const field of ['abs', 'rel'] as const) {
      expect(() => withinTolerance(0, { abs: 0, rel: 0, scale: 'current', [field]: value }, 0, 0, 0)).toThrow()
    }
    for (const scale of ['current', 'span'] as const) {
      expect(() => withinTolerance(0, { abs: 0, rel: 0, scale }, 0, 0, value)).toThrow()
    }
  })

  it('rejects unknown scales and non-finite residuals', () => {
    expect(() => withinTolerance(0, { abs: 0, rel: 0, scale: 'unknown' } as unknown as ToleranceSpec, 0, 0, 0)).toThrow()
    for (const residual of [NaN, Infinity, -Infinity]) {
      expect(withinTolerance(residual, 1, 0, 1, 0)).toBe(false)
      expect(withinTolerance(residual, { abs: 1, rel: 1, scale: 'span' }, 0, 1, 0)).toBe(false)
    }
  })
})

describe('per-account reconciliation', () => {
  it('counts cancelling legs in native units and resets window volume', () => {
    const ledger = new ViewLedger('a'), journal = new TransferJournal()
    const reconciler = new Reconciler({ journal, ledgers: [{ ledger, quantities: ['count'] }],
      boundaries: [{ ledger: 'a', account: 'outside', quantity: 'count', kind: 'transform' }],
      tolerance: () => ({ abs: 0, rel: 0.1, scale: 'span' }) })
    reconciler.baseline(0)
    const request: TransferRequest = { t: 1, process: 'move', quantity: 'mass', unit: 'kg', amount: 2,
      from: { ledger, account: 'mass-view' }, to: { ledger, account: 'outside' } }
    transfer(journal, request, { ...request, from: request.to, to: request.from })
    const report = reconciler.reconcile(1)
    expect(report.failures).toEqual([])
    for (const account of ['stock', 'outside']) {
      expect(report.rows.find(row => row.account === account)).toMatchObject({ quantity: 'count', volume: 2, flows: 0 })
    }
    expect(reconciler.reconcile(2).rows.every(row => row.volume === 0)).toBe(true)
  })

  it('reconciles clean transfers, reads without mutations, and advances its window', () => {
    const { a, b, journal, reconciler, request } = setup()
    transfer(journal, request, { ...request, amount: 0.5, from: request.to, to: request.from })
    const before = canonical([a.snapshot(), b.snapshot(), journal.snapshot()])
    const report = reconciler.reconcile(1)
    expect(report.failures).toEqual([])
    expect(report.rows.every(row => row.residual === 0 && row.pass)).toBe(true)
    expect(report.totals).toEqual([
      { ledger: 'a', quantity: 'mass', deltaH: -1.5, flows: -1.5 },
      { ledger: 'b', quantity: 'mass', deltaH: 1.5, flows: 1.5 },
    ])
    expect(canonical([a.snapshot(), b.snapshot(), journal.snapshot()])).toBe(before)
    expect(reconciler.reconcile(2).rows.every(row => row.deltaH === 0 && row.flows === 0)).toBe(true)
  })

  it('detects an unrecorded addition', () => {
    const { a, reconciler } = setup()
    a.apply('stock', 'mass', 3)
    expect(reconciler.reconcile(1).failures).toMatchObject([{ ledger: 'a', account: 'stock', residual: 3 }])
  })

  it('fails both equal-and-opposite changes even when ledger totals balance', () => {
    const { a, reconciler } = setup()
    a.apply('stock', 'mass', -3)
    a.apply('other', 'mass', 3)
    const report = reconciler.reconcile(1)
    expect(report.failures.map(row => row.residual)).toEqual([-3, 3])
    expect(report.totals[0]).toMatchObject({ deltaH: 0, flows: 0 })
  })

  it.each([true, false])('maps count purchases and kg views using only the owner (native: %s)', native => {
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
      expect(report.rows.find(row => row.ledger === 'goods' && row.account === 'stock')).toMatchObject({ flows: 3 })
    } else expect(report.failures.some(row => row.reason === 'view entry without native()')).toBe(true)
  })

  it('rejects mappings to undeclared native quantities', () => {
    const { a, journal, request } = setup()
    const ledger = Object.assign(a, { native: (account: string, quantity: string, amount: number) => ({ account, quantity, amount }) })
    const reconciler = new Reconciler({ journal, ledgers: [{ ledger, quantities: ['count'] }], unreconciled: ['b'] })
    reconciler.baseline(0)
    transfer(journal, request)
    expect(reconciler.reconcile(1).failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'undeclared native quantity' }),
      expect.objectContaining({ quantity: 'count', residual: -2 }),
    ]))
  })

  it.each(['source', 'sink', 'transform'] as const)('checks each direction of a %s boundary before netting', kind => {
    const { a, journal, reconciler, request } = setup([{ ledger: 'a', account: 'outside', quantity: 'mass', kind }])
    const endpoint = { ledger: a, account: 'outside' }
    transfer(journal, { ...request, from: endpoint }, { ...request, from: request.to, to: endpoint })
    const report = reconciler.reconcile(1)
    if (kind === 'transform') expect(report.failures).toEqual([])
    else expect(report.failures).toMatchObject([{ account: 'outside', reason: kind === 'source' ? 'credit to source' : 'debit from sink' }])
  })

  it('lists unreconciled owners in every report without reading or checking their state', () => {
    const { a, b, journal, request } = setup()
    const read = vi.spyOn(b, 'holdings').mockImplementation(() => { throw new Error('must not read') })
    const reconciler = new Reconciler({ journal, unreconciled: ['b'],
      ledgers: [a, b].map(ledger => ({ ledger, quantities: ['mass'] })) })
    reconciler.baseline(0)
    transfer(journal, request)
    for (const t of [1, 2]) {
      const report = reconciler.reconcile(t)
      expect(report.unreconciled).toEqual(['b'])
      expect(report.rows.every(row => row.ledger !== 'b')).toBe(true)
      expect(report.failures).toEqual([])
    }
    expect(read).not.toHaveBeenCalled()
  })

  it.each([0.5, 0.5 * (1 + Number.EPSILON)])('checks the exact tolerance boundary for residual %s', residual => {
    const ledger = new Ledger('a', [['stock', 0]]), journal = new TransferJournal()
    const reconciler = new Reconciler({ journal, ledgers: [{ ledger, quantities: ['mass'] }], tolerance: () => 0.5 })
    reconciler.baseline(0)
    ledger.balances.set('stock', residual)
    expect(reconciler.reconcile(1).rows[0]).toMatchObject({ residual, pass: residual === 0.5 })
  })

  it.each([NaN, Infinity, -Infinity])('fails non-finite holdings: %s', amount => {
    const { a, reconciler } = setup()
    a.balances.set('stock', amount)
    expect(reconciler.reconcile(1).failures).toMatchObject([{ reason: 'non-finite holding' }])
    a.balances.set('stock', 0)
    expect(reconciler.reconcile(2).failures).toMatchObject([{ reason: 'non-finite holding' }])
  })

  it('scales owner tolerance by current holdings and defaults unspecified quantities to exact', () => {
    const ledger = new Ledger('a', [['stock', 6]]), journal = new TransferJournal()
    const reconciler = new Reconciler({ journal, ledgers: [{ ledger, quantities: ['mass'] }], tolerance: () => 0.25 })
    reconciler.baseline(0)
    ledger.balances.set('stock', 8)
    expect(reconciler.reconcile(1).rows[0]).toMatchObject({ residual: 2, pass: true })
    const exact = new Reconciler({ journal, ledgers: [{ ledger, quantities: ['mass'] }], tolerance: () => undefined })
    exact.baseline(1)
    ledger.balances.set('stock', 8 + 8 * Number.EPSILON)
    expect(exact.reconcile(2).failures).toHaveLength(1)
  })

  it('limits thrown diagnostics to ten failures while storing the full report', () => {
    const ledger = new Ledger('a', Array.from({ length: 12 }, (_, i) => [`account${i}`, 0]))
    const reconciler = new Reconciler({ id: 'custom.check', journal: new TransferJournal(), ledgers: [{ ledger, quantities: ['mass'] }] })
    reconciler.baseline(0)
    for (const account of ledger.balances.keys()) ledger.balances.set(account, 1)
    const process = reconciler.process({ period: 1, throwOnFailure: true })
    expect(process.id).toBe('custom.check')
    let message = ''
    try { process.run(context(1)) } catch (error) { message = (error as Error).message }
    expect(message).toContain('a/account9 (mass)')
    expect(message).not.toContain('a/account10 (mass)')
    expect(reconciler.reports()[0].failures).toHaveLength(12)
  })

  it('requires holdings and an explicit baseline, excluding records before that baseline', () => {
    const { a, journal, request } = setup()
    expect(() => new Reconciler({ journal, ledgers: [{ ledger: { ...a, holdings: undefined } as unknown as TransferLedger, quantities: [] }] })).toThrow('holdings')
    const reconciler = new Reconciler({ journal, ledgers: [{ ledger: a, quantities: ['mass'] }], unreconciled: ['b'] })
    expect(() => reconciler.reconcile(0)).toThrow('baseline')
    transfer(journal, request)
    reconciler.baseline(1)
    expect(reconciler.reconcile(2).rows.every(row => row.flows === 0 && row.residual === 0)).toBe(true)
  })

  it('uses the longest registered id, preserving slashes in account names', () => {
    const a = new Ledger('owner'), b = new Ledger('owner/sub', [['stock/food', 8]])
    const journal = new TransferJournal()
    const reconciler = new Reconciler({ journal, ledgers: [a, b].map(ledger => ({ ledger, quantities: ['mass'] })) })
    reconciler.baseline(0)
    transfer(journal, { t: 1, process: 'move', quantity: 'mass', unit: 'kg', amount: 2,
      from: { ledger: a, account: 'stock' }, to: { ledger: b, account: 'stock/food' } })
    expect(reconciler.reconcile(1).failures).toEqual([])
  })

  it('fails undeclared endpoints and accepts accounts removed from the complete map', () => {
    const { a, journal, reconciler } = setup()
    journal.append({ t: 1, process: 'fixture', quantity: 'mass', unit: 'kg', amount: 16, from: 'a/stock', to: 'b/missing' })
    a.balances.delete('stock')
    expect(reconciler.reconcile(1).failures).toMatchObject([{ account: 'missing', reason: 'undeclared account' }])
    journal.append({ t: 2, process: 'fixture', quantity: 'mass', unit: 'kg', amount: 1, from: 'unknown/stock', to: 'b/other' })
    expect(reconciler.reconcile(2).failures.some(row => row.reason === 'undeclared ledger')).toBe(true)
  })

  it('compensates large cancelling flows', () => {
    const { a, b, journal, reconciler } = setup()
    for (const amount of [1e16, 1, 1, -1e16]) journal.append({ t: 1, process: 'fixture', quantity: 'mass', unit: 'kg',
      amount: Math.abs(amount), from: amount > 0 ? 'a/stock' : 'b/stock', to: amount > 0 ? 'b/stock' : 'a/stock' })
    a.apply('stock', 'mass', -2)
    b.apply('stock', 'mass', 2)
    const report = reconciler.reconcile(1)
    expect(report.failures).toEqual([])
    expect(report.rows.find(row => row.ledger === 'b' && row.account === 'stock')?.flows).toBe(2)
  })

  it('stores detached process reports and restores baseline, cursor and reports for replay', () => {
    const { a, b, journal, reconciler, request } = setup()
    const process = reconciler.process({ period: 1, offset: 0, throwOnFailure: true })
    expect(process).toMatchObject({ id: 'kernel.reconcile', mechanisms: ['kernel.reconcile'], period: 1, offset: 0, phase: 'check', readonly: true })
    transfer(journal, request)
    process.run(context(1))
    const saved = reconciler.snapshot(), states = [a.snapshot(), b.snapshot(), journal.snapshot()]
    transfer(journal, request)
    process.run(context(2))
    const expected = reconciler.reports()
    a.restore(states[0]); b.restore(states[1]); journal.restore(states[2]); reconciler.restore(saved)
    saved.reports.length = 0
    saved.baseline!.holdings.clear()
    transfer(journal, request)
    process.run(context(2))
    expect(reconciler.reports()).toEqual(expected)
    const reports = reconciler.reports()
    reports[0].rows[0].flows = 999
    reports.length = 0
    expect(reconciler.reports()).toEqual(expected)
    a.apply('stock', 'mass', 1)
    expect(() => process.run(context(3))).toThrow('a/stock (mass): residual 1')
    expect(reconciler.reports().at(-1)?.failures).toHaveLength(1)
    a.apply('other', 'mass', 1)
    expect(() => reconciler.process({ period: 1, throwOnFailure: false }).run(context(4))).not.toThrow()
    expect(reconciler.reports().at(-1)?.failures).toHaveLength(1)
  })
})
