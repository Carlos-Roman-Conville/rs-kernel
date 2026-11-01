import { finite, nonempty } from "./guards.js";
import { simTime } from "./time.js";
import { transaction } from "./transaction.js";
import { parse, sameDimension } from "./units.js";
/** Append-only bookkeeping; snapshots and reads never share entry objects. */
export class TransferJournal {
    id;
    records = [];
    constructor(id = 'transfers') { this.id = nonempty(id, 'journal id'); }
    append(entry) { this.records.push({ ...entry }); }
    entries() { return this.records.map(entry => ({ ...entry })); }
    /** Positive debit and credit totals, in first-seen quantity order. */
    balance(t) {
        if (t !== undefined)
            simTime(t);
        const totals = new Map();
        for (const entry of this.records) {
            if (t !== undefined && entry.t !== t)
                continue;
            const total = totals.get(entry.quantity) ?? { debits: 0, credits: 0 };
            total.debits += entry.amount;
            total.credits += entry.amount;
            totals.set(entry.quantity, total);
        }
        return totals;
    }
    snapshot() { return this.entries(); }
    restore(snapshot) {
        this.records = snapshot.map(entry => ({ ...entry }));
    }
}
/**
 * Apply a batch atomically, without conversions or balance policy. Losses are
 * ordinary requests to a loss account in the same call, with their own entries.
 * Ledger snapshots must be detached and restore methods must not throw.
 */
export function transfer(journal, ...requests) {
    const ledgers = new Set(requests.flatMap(request => [request.from.ledger, request.to.ledger]));
    return transaction([journal, ...ledgers], () => requests.map(request => {
        const { t, process, quantity, unit, amount, from, to, note } = request;
        simTime(t);
        nonempty(process, 'transfer process');
        nonempty(quantity, 'transfer quantity');
        nonempty(from.account, 'source account');
        nonempty(to.account, 'destination account');
        finite(amount, 'transfer amount');
        if (amount <= 0)
            throw new Error('transfer amount must be positive');
        const source = `${from.ledger.id}/${from.account}`;
        const destination = `${to.ledger.id}/${to.account}`;
        if (source === destination)
            throw new Error('transfer endpoints must differ');
        const declared = parse(unit);
        for (const endpoint of [from, to]) {
            const symbol = endpoint.ledger.unit(endpoint.account, quantity);
            const held = parse(symbol);
            if (symbol !== unit || !sameDimension(declared, held) || declared.scale !== held.scale ||
                (declared.offset ?? 0) !== (held.offset ?? 0)) {
                throw new Error('transfer unit mismatch');
            }
        }
        from.ledger.apply(from.account, quantity, -amount);
        to.ledger.apply(to.account, quantity, amount);
        const entry = {
            t, process, quantity, unit, amount, from: source, to: destination,
            ...(note === undefined ? {} : { note }),
        };
        journal.append(entry);
        return entry;
    }));
}
