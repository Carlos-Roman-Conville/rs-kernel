import { describe, expect, it } from "vitest";
import { Trace } from "../src/trace.ts";

describe("trace compaction", () => {
  it("preserves arbitrary audit records verbatim through repeated compaction (2777)", () => {
    const trace = new Trace();
    const records = [
      { kind: "inspection", t: 0, details: { measurements: [1, 2], accepted: true } },
      { kind: "host-event", payload: null },
    ];
    const saved = structuredClone(records);
    trace.records.push(...records);
    trace.record({ t: 0, amount: 1, process: "fixture", quantity: "q", from: "a", to: "b" });
    trace.check(0, "q", 1, 1, 0);
    trace.note(0, "status: ready");
    trace.compact(1);
    trace.compact(Infinity);
    expect(trace.records).toEqual(saved);
    for (const [i, record] of records.entries()) expect(trace.records[i]).toBe(record);
    expect(trace.transfers).toEqual([]);
    expect(trace.checks).toEqual([]);
    expect(trace.notes).toEqual([]);
  });

  it("preserves low bits through cancellation, retained tails, queries and compaction", () => {
    for (const compact of [false, true]) {
      const trace = new Trace();
      for (const [t, amount] of [1, 1e16, -1e16, 0.25].entries()) {
        trace.record({ t, amount, process: "fixture", quantity: "q", from: "a", to: "b" });
        if (t === 1) expect(trace.into("b", "q")).toBe(1e16);
        if (compact) trace.compact(t); // retain this transfer, already folded once
      }
      expect(trace.into("b", "q")).toBe(1.25);
      expect(trace.outOf("a", "q")).toBe(1.25);
      expect(trace.into("a", "q")).toBe(0);
      expect(trace.outOf("b", "q")).toBe(0);
    }
  });

  it("clears carries with the sums when a shortened transfer array resets the cache", () => {
    const trace = new Trace();
    for (const amount of [1e16, 1]) trace.record({ t: 0, amount, process: "fixture", quantity: "q", from: "a", to: "b" });
    expect(trace.into("b", "q")).toBe(1e16);
    trace.transfers.length = 0;
    trace.record({ t: 1, amount: 2, process: "fixture", quantity: "q", from: "a", to: "b" });
    expect(trace.into("b", "q")).toBe(2);
    expect(trace.outOf("a", "q")).toBe(2);
  });

  it("keeps exact all-time sums across partial folds, retained tails and repeated compaction", () => {
    const full = new Trace(), compacted = new Trace();
    const record = (t: number, amount: number) => {
      for (const trace of [full, compacted]) trace.record({ t, amount, process: "fixture", quantity: "q", from: "a", to: "b" });
    };
    record(0, 1e16);
    expect(compacted.into("b", "q")).toBe(1e16);
    record(1, -1e16); record(2, 1);
    expect(compacted.compact(2)).toBe(2);
    expect(compacted.transfers.map(x => x.t)).toEqual([2]);
    record(3, 2);
    expect(compacted.into("b", "q")).toBe(full.into("b", "q"));
    expect(compacted.compact(4)).toBe(2);
    expect(compacted.compact(4)).toBe(0);
    record(4, 0.25);
    expect(compacted.outOf("a", "q")).toBe(full.outOf("a", "q"));
    expect(compacted.into("b", "q")).toBe(3.25);
    expect(compacted.into("missing", "q")).toBe(0);
  });

  it("retains crises, crisis/death notes and exact old failures while folding passes and ordinary notes", () => {
    const trace = new Trace();
    trace.record({ t: 0, amount: 1, process: "fixture", quantity: "q", from: "a", to: "b" });
    trace.check(0, "q", 1, 1, 0);
    trace.check(0, "q", 1, 2, 0);
    trace.note(0, "anatomy: assembled a");
    trace.note(0, "anatomy: assembled b");
    trace.note(0, "deficiency vitamin stage 1");
    for (const text of ["crisis: a/fixture", "DEATH: a", "a died", "a is dead", "multiple crises"]) trace.note(0, text, { keep: true });
    trace.note(1, "anatomy: at horizon");
    trace.records.push({ kind: "crisis", body: "a", cause: "fixture", source: "test", startedAt: 0, durationSeconds: 0, risk: null });
    const failed = structuredClone(trace.failed()), crises = structuredClone(trace.records);
    const retainedNotes = trace.notes.filter(n => !/^(anatomy|deficiency)/.test(n.text) || n.t === 1);
    trace.compact(1);
    expect(trace.checks).toEqual(failed);
    expect(trace.failed()).toEqual(failed);
    expect(trace.records).toEqual(crises);
    expect(trace.notes).toEqual(retainedNotes);
    expect(trace.checkSummaries).toEqual([{ quantity: "q", count: 1, maxAbsError: 0, maxErrorAt: 0 }]);
    expect(trace.noteSummaries).toEqual([{ kind: "anatomy", count: 2 }, { kind: "deficiency", count: 1 }]);
    expect(trace.checkCount).toBe(2);
    expect(trace.summary()).toContain("2 checks, 1 failed");
    trace.compact(1);
    expect(trace.failed()).toEqual(failed);
    expect(trace.checkCount).toBe(2);
    expect(trace.noteSummaries[0].count).toBe(2);
  });

  it("keeps a note marked keep through repeated compaction whatever its wording (2715)", () => {
    const trace = new Trace();
    trace.note(0, "organ failure imminent", { keep: true });
    trace.compact(5);
    trace.compact(10);
    expect(trace.notes).toEqual([{ t: 0, text: "organ failure imminent", keep: true }]);
    expect(trace.noteSummaries).toEqual([]);
    expect(structuredClone(trace.notes)).toEqual(trace.notes);
  });

  it("an unmarked note containing the word death now folds: the keyword test is gone (2715)", () => {
    const trace = new Trace();
    trace.note(0, "death: mentioned without a keep marker");
    trace.compact(1);
    expect(trace.notes).toEqual([]);
    expect(trace.noteSummaries).toEqual([{ kind: "death", count: 1 }]);
  });

  it("folds without transfers, respects the strict horizon and merges counts and maximum times", () => {
    const trace = new Trace();
    trace.check(0, "q", 4, 4, 0);
    trace.check(1, "q", 4, 3.5, 1);
    trace.check(2, "q", 4, 4.5, 1); // equal maximum retains its first time
    trace.check(3, "r", 1, 1, 0);
    trace.check(4, "q", 4, 3, 1);
    trace.check(5, "q", 4, 2, 1); // failure must not inflate passing maximum
    trace.note(0, "status: ready");
    expect(trace.compact(2)).toBe(0);
    expect(trace.checks.map(c => c.t)).toEqual([2, 3, 4, 5]);
    expect(trace.checkSummaries).toEqual([{ quantity: "q", count: 2, maxAbsError: 0.5, maxErrorAt: 1 }]);
    trace.compact(4);
    expect(trace.checkSummaries).toEqual([
      { quantity: "q", count: 3, maxAbsError: 0.5, maxErrorAt: 1 },
      { quantity: "r", count: 1, maxAbsError: 0, maxErrorAt: 3 },
    ]);
    trace.compact(Infinity);
    expect(trace.checkSummaries[0]).toEqual({ quantity: "q", count: 4, maxAbsError: 1, maxErrorAt: 4 });
    expect(trace.failed().map(c => c.t)).toEqual([5]);
    expect(trace.checkCount).toBe(6);
    expect(trace.noteSummaries).toEqual([{ kind: "status", count: 1 }]);
    expect(trace.notes).toHaveLength(1);
    expect(trace.notes[0].text).toMatch(/^CONSERVATION FAILED/);
  });

  it("does not fold checks or notes unless compact is called", () => {
    const trace = new Trace();
    trace.check(0, "q", 1, 1, 0);
    trace.note(0, "status: ready");
    expect(trace.failed()).toEqual([]);
    expect(trace.summary()).toContain("1 checks, 0 failed");
    expect(trace.checks).toHaveLength(1);
    expect(trace.notes).toHaveLength(1);
    expect(trace.checkSummaries).toEqual([]);
    expect(trace.noteSummaries).toEqual([]);
  });

});
