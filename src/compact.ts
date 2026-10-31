/** Host-owned time, keys and amounts; the helper assigns no domain meaning to them. */
export interface CompactorOptions<R, K> {
  time(record: R): number
  key(record: R): { in: K; out: K }
  amount(record: R): number
  keep?(record: R): boolean
}

/**
 * Wrap an array that the host may only append to (records must remain immutable).
 * compact mutates that same array. Cursors are absolute original array positions,
 * including removed rows; advance a consumer to end, never by a returned length.
 * Removed history is available as totals, not individual records. Compact only
 * history that consumers no longer need to inspect.
 */
export class Compactor<R, K = string> {
  private readonly records: R[]
  private readonly options: CompactorOptions<R, K>
  private positions: number[] = []
  private next = 0
  private readonly inSums = new Map<K, number>()
  private readonly outSums = new Map<K, number>()

  constructor(records: R[], options: CompactorOptions<R, K>) {
    this.records = records
    this.options = options
  }

  /** First surviving absolute position (or end for an empty array). */
  get baseOffset(): number {
    this.fold()
    return this.positions[0] ?? this.next
  }

  /** Absolute cursor immediately after the latest append. */
  get end(): number {
    this.fold()
    return this.next
  }

  /** All-time totals, including retained and compacted records exactly once. */
  into(key: K): number {
    this.fold()
    return this.inSums.get(key) ?? 0
  }

  outOf(key: K): number {
    this.fold()
    return this.outSums.get(key) ?? 0
  }

  /** Map an absolute cursor to the next surviving row's current array index. */
  index(cursor: number): number {
    this.fold()
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.next) {
      throw new Error('compact cursor must be a non-negative safe integer at or before end')
    }
    let lo = 0, hi = this.positions.length
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (this.positions[mid] < cursor) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** Surviving records at or after the absolute cursor, in append order. */
  since(cursor = 0): R[] {
    return this.records.slice(this.index(cursor))
  }

  /** Remove records strictly before horizon, except those selected by keep. */
  compact(horizon: number): number {
    if (!Number.isFinite(horizon)) throw new Error('compact horizon must be finite')
    this.fold()
    // Evaluate host callbacks before changing the array, including when they throw.
    const retain = this.records.map(record =>
      !(this.options.time(record) < horizon) || (this.options.keep?.(record) ?? false))
    let write = 0
    for (let read = 0; read < this.records.length; read++) {
      if (!retain[read]) continue
      this.records[write] = this.records[read]
      this.positions[write++] = this.positions[read]
    }
    const removed = this.records.length - write
    this.records.length = write
    this.positions.length = write
    return removed
  }

  private fold(): void {
    if (this.records.length < this.positions.length) throw new Error('compact records must be append-only')
    // Fold every append in original order, even retained rows. Summing dropped
    // rows first and retained rows later would change floating-point results.
    while (this.positions.length < this.records.length) {
      const record = this.records[this.positions.length]
      const keys = this.options.key(record)
      const amount = this.options.amount(record)
      this.inSums.set(keys.in, (this.inSums.get(keys.in) ?? 0) + amount)
      this.outSums.set(keys.out, (this.outSums.get(keys.out) ?? 0) + amount)
      this.positions.push(this.next++)
    }
  }
}
