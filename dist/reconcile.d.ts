import type { Process } from './scheduler.ts';
import { type SimTime } from './time.ts';
import type { Participant } from './transaction.ts';
import type { TransferJournal, TransferLedger } from './transfer.ts';
export interface ToleranceSpec {
    abs: number;
    rel: number;
    scale: 'span' | 'current';
}
export type Tolerance = number | ToleranceSpec;
/**
 * Checks a residual in the quantity's own unit; undefined means exact.
 * Numbers retain the legacy current-holdings scale with a floor of one.
 * Exact integer counts use { abs: 0, rel: 0, scale: 'current' }.
 */
export declare function withinTolerance(residual: number, tolerance: Tolerance | undefined, x0: number, x1: number, volume: number): boolean;
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
    volume: number;
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
    tolerance?: (quantity: string) => Tolerance | undefined;
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
