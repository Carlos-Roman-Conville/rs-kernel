import { finite, nonempty } from './guards.ts'
import type { Process } from './scheduler.ts'
import { simTime, type SimTime } from './time.ts'
import type { Participant } from './transaction.ts'
import type { TransferJournal, TransferLedger } from './transfer.ts'

export interface ToleranceSpec { abs: number; rel: number; scale: 'span' | 'current' }
export type Tolerance = number | ToleranceSpec

/**
 * Checks a residual in the quantity's own unit; undefined means exact.
 * Numbers retain the legacy current-holdings scale with a floor of one.
 * Exact integer counts use { abs: 0, rel: 0, scale: 'current' }.
 */
export function withinTolerance(residual: number, tolerance: Tolerance | undefined,
  x0: number, x1: number, volume: number): boolean {
  if (!Number.isFinite(residual)) return false
  if (tolerance === undefined) return Math.abs(residual) <= 0
  if (typeof tolerance === 'number') {
    finite(tolerance, 'reconcile tolerance', 0)
    return Math.abs(residual) <= tolerance * Math.max(1, Math.abs(x1))
  }
  finite(tolerance.abs, 'reconcile absolute tolerance', 0)
  finite(tolerance.rel, 'reconcile relative tolerance', 0)
  if (tolerance.scale !== 'span' && tolerance.scale !== 'current') throw new Error('invalid reconcile tolerance scale')
  finite(volume, 'reconcile volume', 0)
  const scale = tolerance.scale === 'span' ? Math.max(Math.abs(x0), Math.abs(x1), volume) : Math.abs(x1)
  return Math.abs(residual) <= tolerance.abs + tolerance.rel * scale
}

export interface Boundary {
  ledger: string
  account: string
  quantity: string
  kind: 'source' | 'sink' | 'transform'
}

export interface ReconcileRow {
  t: SimTime
  ledger: string
  account: string
  quantity: string
  deltaH: number
  flows: number
  volume: number
  residual: number
  pass: boolean
  reason?: string
}

export interface ReconcileReport {
  t: SimTime
  rows: ReconcileRow[]
  failures: ReconcileRow[]
  unreconciled: string[]
  totals: { ledger: string; quantity: string; deltaH: number; flows: number }[]
}

export interface ReconcilerOptions {
  id?: string
  journal: TransferJournal
  ledgers: { ledger: TransferLedger; quantities: string[] }[]
  unreconciled?: string[]
  boundaries?: Boundary[]
  tolerance?: (quantity: string) => Tolerance | undefined
}

type Holdings = Map<string, Map<string, Map<string, number>>>
interface ReconcileState {
  baseline?: { t: SimTime; holdings: Holdings }
  cursor: number
  reports: ReconcileReport[]
}

/** Neumaier compensation preserves small flows across large cancelling entries. */
class Sum {
  private sum = 0
  private compensation = 0
  add(amount: number): void {
    const next = this.sum + amount
    this.compensation += Math.abs(this.sum) >= Math.abs(amount)
      ? (this.sum - next) + amount : (amount - next) + this.sum
    this.sum = next
  }
  value(): number { return this.sum + this.compensation }
}

const key = (ledger: string, account: string, quantity: string) => JSON.stringify([ledger, account, quantity])

/** Reads owner state and journal records; retains only the previous sync and reports. */
export class Reconciler implements Participant {
  readonly id: string
  private readonly journal: TransferJournal
  private readonly ledgers = new Map<string, { ledger: TransferLedger; quantities: Set<string> }>()
  private readonly unreconciled: Set<string>
  private readonly registered: string[]
  private readonly boundaries = new Map<string, Boundary['kind']>()
  private readonly tolerance: ReconcilerOptions['tolerance']
  private state: ReconcileState = { cursor: 0, reports: [] }

  constructor(options: ReconcilerOptions) {
    this.id = nonempty(options.id ?? 'kernel.reconcile', 'reconciler id')
    this.journal = options.journal
    this.tolerance = options.tolerance
    this.unreconciled = new Set(options.unreconciled ?? [])
    for (const { ledger, quantities } of options.ledgers) {
      if (!ledger.holdings) throw new Error(`ledger ${ledger.id} must implement holdings()`)
      if (this.ledgers.has(ledger.id)) throw new Error(`duplicate ledger: ${ledger.id}`)
      this.ledgers.set(ledger.id, { ledger, quantities: new Set(quantities) })
    }
    this.registered = [...new Set([...this.ledgers.keys(), ...this.unreconciled])]
      .sort((a, b) => b.length - a.length)
    for (const boundary of options.boundaries ?? []) {
      this.boundaries.set(key(boundary.ledger, boundary.account, boundary.quantity), boundary.kind)
    }
  }

  private holdings(): Holdings {
    const result: Holdings = new Map()
    for (const [id, { ledger, quantities }] of this.ledgers) {
      if (this.unreconciled.has(id)) continue
      result.set(id, new Map([...quantities].map(quantity => [quantity, new Map(ledger.holdings!(quantity))])))
    }
    return result
  }

  baseline(t: SimTime): void {
    simTime(t)
    this.state.baseline = { t, holdings: this.holdings() }
    this.state.cursor = this.journal.length
  }

  reconcile(t: SimTime): ReconcileReport {
    simTime(t)
    if (!this.state.baseline) throw new Error('reconcile requires a baseline')
    const window = this.journal.since(this.state.cursor)
    const now = this.holdings()
    const cells = new Map<string, { ledger: string; account: string; quantity: string; sum: Sum; volume: Sum; reason?: string }>()
    const cell = (ledger: string, account: string, quantity: string) => {
      const id = key(ledger, account, quantity)
      let value = cells.get(id)
      if (!value) {
        value = { ledger, account, quantity, sum: new Sum(), volume: new Sum() }
        cells.set(id, value)
      }
      return value
    }
    for (const entry of window) {
      for (const [endpoint, sign] of [[entry.from, -1], [entry.to, 1]] as const) {
        // Unknown ids cannot be disambiguated; retain the suffix for diagnostics.
        const id = this.registered.find(id => endpoint.startsWith(`${id}/`)) ?? endpoint.split('/')[0]
        if (this.unreconciled.has(id)) continue
        let account = endpoint.slice(id.length + 1), quantity = entry.quantity, amount = entry.amount
        const owner = this.ledgers.get(id)
        let reason: string | undefined
        if (!owner) reason = 'undeclared ledger'
        else if (!owner.quantities.has(quantity)) {
          if (!owner.ledger.native) reason = 'view entry without native()'
          else {
            ({ account, quantity, amount } = owner.ledger.native(account, quantity, amount))
            if (!owner.quantities.has(quantity)) reason = 'undeclared native quantity'
          }
        }
        const value = cell(id, account, quantity)
        const boundary = this.boundaries.get(key(id, account, quantity))
        if (!reason && boundary === 'source' && sign > 0) reason = 'credit to source'
        if (!reason && boundary === 'sink' && sign < 0) reason = 'debit from sink'
        if (!reason && !Number.isFinite(amount)) reason = 'non-finite flow'
        value.reason ??= reason
        value.sum.add(sign * amount)
        value.volume.add(Math.abs(amount))
      }
    }
    for (const holdings of [this.state.baseline.holdings, now]) {
      for (const [id, quantities] of holdings) {
        for (const [quantity, accounts] of quantities) {
          for (const account of accounts.keys()) cell(id, account, quantity)
        }
      }
    }
    const rows: ReconcileRow[] = []
    const totals: ReconcileReport['totals'] = []
    const sums = new Map<string, { deltaH: Sum; flows: Sum }>()
    for (const [id, quantities] of now) {
      for (const quantity of quantities.keys()) {
        totals.push({ ledger: id, quantity, deltaH: 0, flows: 0 })
        sums.set(key(id, '', quantity), { deltaH: new Sum(), flows: new Sum() })
      }
    }
    for (const value of cells.values()) {
      const { ledger, account, quantity } = value
      const before = this.state.baseline.holdings.get(ledger)?.get(quantity)
      const after = now.get(ledger)?.get(quantity)
      const previous = before?.get(account) ?? 0, current = after?.get(account) ?? 0
      const boundary = this.boundaries.has(key(ledger, account, quantity))
      const flows = value.sum.value()
      const volume = value.volume.value()
      // Boundaries carry flows but have no stock identity to check.
      const deltaH = boundary ? 0 : current - previous
      const residual = boundary ? 0 : deltaH - flows
      let reason = value.reason
      if (!reason) {
        if (!Number.isFinite(previous) || !Number.isFinite(current)) reason = 'non-finite holding'
        else if (!boundary && !before?.has(account) && !after?.has(account)) reason = 'undeclared account'
      }
      const pass = reason === undefined && withinTolerance(residual, this.tolerance?.(quantity), previous, current, volume)
      rows.push({ t, ledger, account, quantity, deltaH, flows, volume, residual, pass,
        ...(reason === undefined ? {} : { reason }) })
      const total = sums.get(key(ledger, '', quantity))
      total?.deltaH.add(deltaH)
      total?.flows.add(flows)
    }
    for (const total of totals) {
      const sum = sums.get(key(total.ledger, '', total.quantity))!
      total.deltaH = sum.deltaH.value()
      total.flows = sum.flows.value()
    }
    const report = { t, rows, failures: rows.filter(row => !row.pass), unreconciled: [...this.unreconciled], totals }
    this.state.baseline = { t, holdings: now }
    this.state.cursor = this.journal.length
    return report
  }

  process(options: { period: SimTime; offset?: SimTime; throwOnFailure: boolean }): Process {
    return {
      id: this.id, mechanisms: [this.id], period: options.period, offset: options.offset,
      phase: 'check', readonly: true,
      run: ctx => {
        const report = this.reconcile(ctx.t)
        this.state.reports.push(structuredClone(report))
        if (options.throwOnFailure && report.failures.length) {
          throw new Error(`reconciliation failed: ${report.failures.slice(0, 10).map(row =>
            `${row.ledger}/${row.account} (${row.quantity}): ${row.reason ?? `residual ${row.residual}`}`).join('; ')}`)
        }
      },
    }
  }

  reports(): ReconcileReport[] { return structuredClone(this.state.reports) }
  snapshot(): ReconcileState { return structuredClone(this.state) }
  restore(snapshot: unknown): void { this.state = structuredClone(snapshot as ReconcileState) }
}
