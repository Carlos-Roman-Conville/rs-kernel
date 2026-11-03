import type { Process } from './scheduler.ts';
import { type SimTime } from './time.ts';
import type { Participant } from './transaction.ts';
import type { TransferJournal, TransferLedger } from './transfer.ts';
export interface Boundary {
    ledger: string;
    account: string;
    quantity: string;
    kind: 'source' | 'sink' | 'transform';
}
export interface ReconcileRow {
    t: SimTime;
    ledger: string;
    account: string;
    quantity: string;
    deltaH: number;
    flows: number;
    residual: number;
    pass: boolean;
    reason?: string;
}
export interface ReconcileReport {
    t: SimTime;
    rows: ReconcileRow[];
    failures: ReconcileRow[];
    unreconciled: string[];
    totals: {
        ledger: string;
        quantity: string;
        deltaH: number;
        flows: number;
    }[];
}
export interface ReconcilerOptions {
    id?: string;
    journal: TransferJournal;
    ledgers: {
        ledger: TransferLedger;
        quantities: string[];
    }[];
    unreconciled?: string[];
    boundaries?: Boundary[];
    tolerance?: (quantity: string) => number | undefined;
}
type Holdings = Map<string, Map<string, Map<string, number>>>;
interface ReconcileState {
    baseline?: {
        t: SimTime;
        holdings: Holdings;
    };
    cursor: number;
    reports: ReconcileReport[];
}
/** Reads owner state and journal records; retains only the previous sync and reports. */
export declare class Reconciler implements Participant {
    readonly id: string;
    private readonly journal;
    private readonly ledgers;
    private readonly unreconciled;
    private readonly registered;
    private readonly boundaries;
    private readonly tolerance;
    private state;
    constructor(options: ReconcilerOptions);
    private holdings;
    baseline(t: SimTime): void;
    reconcile(t: SimTime): ReconcileReport;
    process(options: {
        period: SimTime;
        offset?: SimTime;
        throwOnFailure: boolean;
    }): Process;
    reports(): ReconcileReport[];
    snapshot(): ReconcileState;
    restore(snapshot: unknown): void;
}
export {};
