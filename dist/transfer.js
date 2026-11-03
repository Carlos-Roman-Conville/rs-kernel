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
    get length() { return this.records.length; }
    checkCursor(cursor) {
        if (!Number.isInteger(cursor) || cursor < 0 || cursor > this.length) {
            throw new Error('journal cursor out of range');
        }
    }
    since(cursor = 0) {
        this.checkCursor(cursor);
        return this.records.slice(cursor).map(entry => ({ ...entry }));
    }
    /** Credits minus debits in [from, to), using Neumaier compensation. */
    net(account, quantity, from = 0, to = this.length) {
        this.checkCursor(from);
        this.checkCursor(to);
        let sum = 0, compensation = 0;
        const add = (amount) => {
            const next = sum + amount;
            compensation += Math.abs(sum) >= Math.abs(amount)
                ? (sum - next) + amount : (amount - next) + sum;
            sum = next;
        };
        for (let i = from; i < to; i++) {
            const entry = this.records[i];
            if (entry.quantity !== quantity)
                continue;
            if (entry.to === account)
                add(entry.amount);
            if (entry.from === account)
                add(-entry.amount);
        }
        return sum + compensation;
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
        const { t, process, quantity, unit, amount, from, to, note, cause } = request;
        simTime(t);
        nonempty(process, 'transfer process');
        nonempty(quantity, 'transfer quantity');
        if (cause !== undefined)
            nonempty(cause, 'transfer cause');
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
            ...(cause === undefined ? {} : { cause }),
        };
        journal.append(entry);
        return entry;
    }));
}
