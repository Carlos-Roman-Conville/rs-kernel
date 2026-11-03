import { type SimTime } from './time.ts';
import { type Participant } from './transaction.ts';
/** The owner declares balances and decides whether a delta is acceptable. */
export interface TransferLedger extends Participant {
    unit(account: string, quantity: string): string;
    apply(account: string, quantity: string, delta: number): void;
    /** Complete current holdings by unqualified account, in the owner's unit. */
    holdings?(quantity: string): ReadonlyMap<string, number>;
    /** Only the owner maps a view entry to the stock's native account and unit. */
    native?(account: string, quantity: string, amount: number): {
        account: string;
        quantity: string;
        amount: number;
    };
}
export interface TransferEndpoint {
    readonly ledger: TransferLedger;
    readonly account: string;
}
export interface TransferRequest {
    readonly t: SimTime;
    readonly process: string;
    readonly quantity: string;
    readonly unit: string;
    readonly amount: number;
    readonly from: TransferEndpoint;
    readonly to: TransferEndpoint;
    readonly note?: string;
    readonly cause?: string;
}
export interface TransferEntry {
    t: SimTime;
    process: string;
    quantity: string;
    unit: string;
    amount: number;
    from: string;
    to: string;
    note?: string;
    cause?: string;
}
/** Append-only bookkeeping; snapshots and reads never share entry objects. */
export declare class TransferJournal implements Participant {
    readonly id: string;
    private records;
    constructor(id?: string);
    append(entry: TransferEntry): void;
    entries(): TransferEntry[];
    get length(): number;
    private checkCursor;
    since(cursor?: number): TransferEntry[];
    /** Credits minus debits in [from, to), using Neumaier compensation. */
    net(account: string, quantity: string, from?: number, to?: number): number;
    snapshot(): TransferEntry[];
    restore(snapshot: unknown): void;
}
/**
 * Apply a batch atomically, without conversions or balance policy. Losses are
 * ordinary requests to a loss account in the same call, with their own entries.
 * Ledger snapshots must be detached and restore methods must not throw.
 */
export declare function transfer(journal: TransferJournal, ...requests: TransferRequest[]): TransferEntry[];
