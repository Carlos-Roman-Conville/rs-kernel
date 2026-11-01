/** Host-owned time, keys and amounts; the helper assigns no domain meaning to them. */
export interface CompactorOptions<R, K> {
    time(record: R): number;
    key(record: R): {
        in: K;
        out: K;
    };
    amount(record: R): number;
    keep?(record: R): boolean;
}
/**
 * Wrap an array that the host may only append to (records must remain immutable).
 * compact mutates that same array. Cursors are absolute original array positions,
 * including removed rows; advance a consumer to end, never by a returned length.
 * Removed history is available as totals, not individual records. Compact only
 * history that consumers no longer need to inspect.
 */
export declare class Compactor<R, K = string> {
    private readonly records;
    private readonly options;
    private positions;
    private next;
    private readonly inSums;
    private readonly outSums;
    constructor(records: R[], options: CompactorOptions<R, K>);
    /** First surviving absolute position (or end for an empty array). */
    get baseOffset(): number;
    /** Absolute cursor immediately after the latest append. */
    get end(): number;
    /** All-time totals, including retained and compacted records exactly once. */
    into(key: K): number;
    outOf(key: K): number;
    /** Map an absolute cursor to the next surviving row's current array index. */
    index(cursor: number): number;
    /** Surviving records at or after the absolute cursor, in append order. */
    since(cursor?: number): R[];
    /** Remove records strictly before horizon, except those selected by keep. */
    compact(horizon: number): number;
    private fold;
}
