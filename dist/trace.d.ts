/**
 * Service 5: validation and observability. Every transfer is recorded (source, sink, quantity, the process that did it);
 * every step checks conservation of each tracked quantity against the recorded flows, so an experiment can be read back
 * to see why it failed.
 */
export interface TraceRecord {
    kind: string;
    [field: string]: unknown;
}
export interface Transfer {
    t: number;
    process: string;
    quantity: string;
    from: string;
    to: string;
    amount: number;
    note?: string;
    chemicalChange?: boolean;
}
export interface Check {
    t: number;
    quantity: string;
    expected: number;
    actual: number;
    tolerance: number;
    ok: boolean;
}
/** Passing checks removed by compaction; ties keep the first encountered maximum. */
export interface CheckSummary {
    quantity: string;
    count: number;
    maxAbsError: number;
    maxErrorAt: number;
}
/** A note's kind is its leading token, excluding a trailing colon (e.g. anatomy or deficiency). */
export interface NoteSummary {
    kind: string;
    count: number;
}
export declare class Trace {
    #private;
    constructor(beforeCompact?: (count: number) => void);
    transfers: Transfer[];
    checks: Check[];
    checkSummaries: CheckSummary[];
    /** `keep` (2715): compaction never folds a kept note; a snapshot without it reads as not kept. */
    notes: {
        t: number;
        text: string;
        keep?: boolean;
    }[];
    noteSummaries: NoteSummary[];
    /** Audit records owned by consumers; compaction preserves every record verbatim. */
    records: TraceRecord[];
    record(x: Transfer): void;
    note(t: number, text: string, opts?: {
        keep?: boolean;
    }): void;
    check(t: number, quantity: string, expected: number, actual: number, tolerance: number): boolean;
    failed(): Check[];
    get checkCount(): number;
    /** Drop the chronological prefix strictly before horizonT, preserving all-time into/outOf sums.
     * World-owned traces require those transfers to have passed afterStep first. Other consumers must
     * subtract the returned transfer count from their own cursors. Old passing checks and ordinary notes
     * become summaries; failures, kept notes and all records stay verbatim.
     */
    compact(horizonT: number): number;
    /** Sum of a quantity moved into a component by all processes. */
    into(component: string, quantity: string): number;
    outOf(component: string, quantity: string): number;
    private inSums;
    private outSums;
    private folded;
    private total;
    private add;
    private fold;
    summary(): string;
}
