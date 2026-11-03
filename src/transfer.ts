import { finite, nonempty } from './guards.ts'
import { simTime, type SimTime } from './time.ts'
import { transaction, type Participant } from './transaction.ts'
import { parse, sameDimension } from './units.ts'

/** The owner declares balances and decides whether a delta is acceptable. */
export interface TransferLedger extends Participant {
  unit(account: string, quantity: string): string
  apply(account: string, quantity: string, delta: number): void
}

export interface TransferEndpoint {
  readonly ledger: TransferLedger
  readonly account: string
}

export interface TransferRequest {
  readonly t: SimTime
  readonly process: string
  readonly quantity: string
  readonly unit: string
  readonly amount: number
  readonly from: TransferEndpoint
  readonly to: TransferEndpoint
  readonly note?: string
  readonly cause?: string
}

export interface TransferEntry {
  t: SimTime
  process: string
  quantity: string
  unit: string
  amount: number
  from: string
  to: string
  note?: string
  cause?: string
}

/** Append-only bookkeeping; snapshots and reads never share entry objects. */
export class TransferJournal implements Participant {
  readonly id: string
  private records: TransferEntry[] = []

  constructor(id = 'transfers') { this.id = nonempty(id, 'journal id') }

  append(entry: TransferEntry): void { this.records.push({ ...entry }) }

  entries(): TransferEntry[] { return this.records.map(entry => ({ ...entry })) }

  get length(): number { return this.records.length }

  private checkCursor(cursor: number): void {
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > this.length) {
      throw new Error('journal cursor out of range')
    }
  }

  since(cursor = 0): TransferEntry[] {
    this.checkCursor(cursor)
    return this.records.slice(cursor).map(entry => ({ ...entry }))
  }

  /** Credits minus debits in [from, to), using Neumaier compensation. */
  net(account: string, quantity: string, from = 0, to = this.length): number {
    this.checkCursor(from)
    this.checkCursor(to)
    let sum = 0, compensation = 0
    const add = (amount: number) => {
      const next = sum + amount
      compensation += Math.abs(sum) >= Math.abs(amount)
        ? (sum - next) + amount : (amount - next) + sum
      sum = next
    }
    for (let i = from; i < to; i++) {
      const entry = this.records[i]
      if (entry.quantity !== quantity) continue
      if (entry.to === account) add(entry.amount)
      if (entry.from === account) add(-entry.amount)
    }
    return sum + compensation
  }

  snapshot(): TransferEntry[] { return this.entries() }

  restore(snapshot: unknown): void {
    this.records = (snapshot as TransferEntry[]).map(entry => ({ ...entry }))
  }
}

/**
 * Apply a batch atomically, without conversions or balance policy. Losses are
 * ordinary requests to a loss account in the same call, with their own entries.
 * Ledger snapshots must be detached and restore methods must not throw.
 */
export function transfer(journal: TransferJournal, ...requests: TransferRequest[]): TransferEntry[] {
  const ledgers = new Set(requests.flatMap(request => [request.from.ledger, request.to.ledger]))
  return transaction([journal, ...ledgers], () => requests.map(request => {
    const { t, process, quantity, unit, amount, from, to, note, cause } = request
    simTime(t)
    nonempty(process, 'transfer process')
    nonempty(quantity, 'transfer quantity')
    if (cause !== undefined) nonempty(cause, 'transfer cause')
    nonempty(from.account, 'source account')
    nonempty(to.account, 'destination account')
    finite(amount, 'transfer amount')
    if (amount <= 0) throw new Error('transfer amount must be positive')
    const source = `${from.ledger.id}/${from.account}`
    const destination = `${to.ledger.id}/${to.account}`
    if (source === destination) throw new Error('transfer endpoints must differ')
    const declared = parse(unit)
    for (const endpoint of [from, to]) {
      const symbol = endpoint.ledger.unit(endpoint.account, quantity)
      const held = parse(symbol)
      if (symbol !== unit || !sameDimension(declared, held) || declared.scale !== held.scale ||
        (declared.offset ?? 0) !== (held.offset ?? 0)) {
        throw new Error('transfer unit mismatch')
      }
    }
    from.ledger.apply(from.account, quantity, -amount)
    to.ledger.apply(to.account, quantity, amount)
    const entry: TransferEntry = {
      t, process, quantity, unit, amount, from: source, to: destination,
      ...(note === undefined ? {} : { note }),
      ...(cause === undefined ? {} : { cause }),
    }
    journal.append(entry)
    return entry
  }))
}
