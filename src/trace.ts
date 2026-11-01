/**
 * Service 5: validation and observability. Every transfer is recorded (source, sink, quantity, the process that did it);
 * every step checks conservation of each tracked quantity against the recorded flows, so an experiment can be read back
 * to see why it failed.
 */
export interface TraceRecord { kind: string; [field: string]: unknown }
export interface Transfer { t: number; process: string; quantity: string; from: string; to: string; amount: number; note?: string; chemicalChange?: boolean }

export interface Check { t: number; quantity: string; expected: number; actual: number; tolerance: number; ok: boolean }
/** Passing checks removed by compaction; ties keep the first encountered maximum. */
export interface CheckSummary { quantity: string; count: number; maxAbsError: number; maxErrorAt: number }
/** A note's kind is its leading token, excluding a trailing colon (e.g. anatomy or deficiency). */
export interface NoteSummary { kind: string; count: number }

export class Trace {
  #beforeCompact?: (count: number) => void;
  constructor(beforeCompact?: (count: number) => void) {
    // The owner hook is wiring, not trace data (keep structural trace comparisons unchanged).
    this.#beforeCompact = beforeCompact;
  }
  transfers: Transfer[] = [];
  checks: Check[] = [];
  checkSummaries: CheckSummary[] = [];
  /** `keep` (2715): compaction never folds a kept note; a snapshot without it reads as not kept. */
  notes: { t: number; text: string; keep?: boolean }[] = [];
  noteSummaries: NoteSummary[] = [];
  /** Audit records owned by consumers; compaction preserves every record verbatim. */
  records: TraceRecord[] = [];
  record(x: Transfer) { this.transfers.push(x); }
  note(t: number, text: string, opts?: { keep?: boolean }) { this.notes.push(opts?.keep ? { t, text, keep: true } : { t, text }); } // (2715)
  check(t: number, quantity: string, expected: number, actual: number, tolerance: number) {
    const ok = Math.abs(expected - actual) <= tolerance;
    this.checks.push({ t, quantity, expected, actual, tolerance, ok });
    if (!ok) this.note(t, `CONSERVATION FAILED ${quantity}: expected ${expected} got ${actual} (tolerance ${tolerance})`, { keep: true }); // (2715)
    return ok;
  }
  // Summaries contain only passes: every failure remains available verbatim here.
  failed() { return this.checks.filter(c => !c.ok); }
  get checkCount() { return this.checks.length + this.checkSummaries.reduce((n, s) => n + s.count, 0); }
  /** Drop the chronological prefix strictly before horizonT, preserving all-time into/outOf sums.
   * World-owned traces require those transfers to have passed afterStep first. Other consumers must
   * subtract the returned transfer count from their own cursors. Old passing checks and ordinary notes
   * become summaries; failures, kept notes and all records stay verbatim.
   */
  compact(horizonT: number): number {
    let count = 0;
    while (count < this.transfers.length && this.transfers[count].t < horizonT) count++;
    if (count) {
      // Validate before mutating any trace data, including the check/note summaries.
      this.#beforeCompact?.(count);
      // Fold the retained tail too: folded must describe the entire remaining array after the splice.
      this.fold();
      this.transfers.splice(0, count);
      this.folded = this.transfers.length;
    }
    const checks = new Map(this.checkSummaries.map(s => [s.quantity, s]));
    let kept = 0;
    for (const c of this.checks) {
      if (!(c.t < horizonT && c.ok)) { this.checks[kept++] = c; continue; }
      const error = Math.abs(c.expected - c.actual);
      let summary = checks.get(c.quantity);
      if (!summary) {
        summary = { quantity: c.quantity, count: 0, maxAbsError: error, maxErrorAt: c.t };
        checks.set(c.quantity, summary);
        this.checkSummaries.push(summary);
      }
      summary.count++;
      if (error > summary.maxAbsError) { summary.maxAbsError = error; summary.maxErrorAt = c.t; }
    }
    this.checks.length = kept;
    const notes = new Map(this.noteSummaries.map(s => [s.kind, s]));
    kept = 0;
    for (const n of this.notes) {
      if (!(n.t < horizonT) || n.keep) { // (2715)
        this.notes[kept++] = n;
        continue;
      }
      const kind = n.text.trim().split(/[\s:]/, 1)[0] || "note";
      let summary = notes.get(kind);
      if (!summary) {
        summary = { kind, count: 0 };
        notes.set(kind, summary);
        this.noteSummaries.push(summary);
      }
      summary.count++;
    }
    this.notes.length = kept;
    return count;
  }
  /** Sum of a quantity moved into a component by all processes. */
  into(component: string, quantity: string) { this.fold(); return this.total(this.inSums, `${component}\0${quantity}`); }
  outOf(component: string, quantity: string) { this.fold(); return this.total(this.outSums, `${component}\0${quantity}`); }
  // Running sums per (component, quantity), folded in order from the first transfer not yet seen: the same additions in the
  // same order with or without compaction. Neumaier carries survive folds and head removals (2656).
  private inSums = new Map<string, { sum: number; carry: number }>();
  private outSums = new Map<string, { sum: number; carry: number }>();
  private folded = 0;
  private total(sums: Map<string, { sum: number; carry: number }>, key: string) {
    const s = sums.get(key);
    return s ? s.sum + s.carry : 0;
  }
  private add(sums: Map<string, { sum: number; carry: number }>, key: string, amount: number) {
    let s = sums.get(key);
    if (!s) { s = { sum: 0, carry: 0 }; sums.set(key, s); }
    const total = s.sum + amount;
    s.carry += Math.abs(s.sum) >= Math.abs(amount) ? (s.sum - total) + amount : (amount - total) + s.sum;
    s.sum = total;
  }
  private fold() {
    const ts = this.transfers;
    if (this.folded > ts.length) { this.inSums.clear(); this.outSums.clear(); this.folded = 0; }
    for (; this.folded < ts.length; this.folded++) {
      const x = ts[this.folded];
      const i = `${x.to}\0${x.quantity}`, o = `${x.from}\0${x.quantity}`;
      this.add(this.inSums, i, x.amount);
      this.add(this.outSums, o, x.amount);
    }
  }
  summary(): string {
    const byProcess = new Map<string, number>();
    for (const x of this.transfers) byProcess.set(`${x.process}:${x.quantity}`, (byProcess.get(`${x.process}:${x.quantity}`) ?? 0) + x.amount);
    const lines = [...byProcess].map(([k, v]) => `${k.padEnd(40)} ${v.toExponential(4)}`);
    return `${this.transfers.length} transfers, ${this.checkCount} checks, ${this.failed().length} failed\n` + lines.join("\n");
  }
}
