# Handoff: @rex/kernel

## State
Scaffold only (unit 2585): package.json, tsconfig.json (strict, `noUnusedLocals` and `noUnusedParameters` on, since
the pirate web compiles `file:` packages under its own flags, I-1030), empty barrel `src/index.ts`, smoke test,
README. DESIGN.md approved by Rex 2026-10-30. No engine dependency.

## Next
ADOPTION.md stage K, in order: 2586 ids + guards, 2587 rng, 2588 runner + transaction, 2589 time + scheduler +
order, 2590 events, 2591 snapshot, 2592 units, 2593 ports, 2594 resolution, 2595 compaction, 2596 check script,
2597 fence check. Then the engines' adoption units (2598 onward).

## Blocked
- **2609 thirty-day harness (2026-10-30): parked on realism conservation.** The new
  `harness/thirty-days.test.ts` gate runs, but the 1 s horse-stable world first fails
  `mass:water` at `t = 1460124 s` (day 16.899583333333332). Expected
  `285.57525407659784`, actual `285.5752540755978`: error
  `1.0000462680181954e-9` exceeds the example's `1e-9` tolerance. The hourly audit
  reports it at kernel `T = 1461600000 ms`. No tolerance was relaxed and no failed
  check was discarded. Engine repos and kernel `src/` remain untouched.
- Gate `cd harness; npx vitest run thirty-days`: **12 passed, 1 failed** (285 s).
  The passing checks cover 30-day horse trace equivalence at 60 s, the 1 s wound
  trigger, both daily-engine equivalences, day/time guards, and cross-engine
  rollback/publication. The full 30-day 1 s run cannot finish until this engine
  failure is resolved. Strict typechecking of both new harness files passes.
- A separate temporary diagnostic in the same test file ran native
  `runHorseStable(17, { stepS: 1, compactEveryS: 3600 })` with **no kernel clock**,
  retaining the native step and time accumulation and only inspecting/releasing
  successful checks hourly. It also failed (248 s): `mass:water` at `1460317 s`,
  expected `285.562789393862`, actual `285.56278939286193`, tolerance `1e-9`.
  This reproduces the failure category independently; the first failing second
  differs, so the precise numerical cause is not established. The temporary test
  was removed; the committed acceptance test remains failing and unskipped.
- Reality's owner should investigate the long-run water ledger (notably the plain
  `entered`/`left` accumulation in `World.afterStep`, versus compensated component
  contents), preserve the existing equivalent-dt outputs, then rerun the harness
  gate. This is a lead from source inspection, not a confirmed numerical cause.

## Gotchas
- Versions match economy (typescript ~6.0.2, vitest ^5.0.5); `types: []`, so tests import from `vitest`.
- Barrel is `export {}` until the first service lands; keep it a module.
- `.gitignore` holds `node_modules/` and `.claude/`.
- 2609 fixture details: `buildHamlet()` has already ticked two setup days. Its
  equivalence test keeps day 2; the shared run explicitly rebases the prepared
  hamlet's day counter to 0. Three-ports uses its native `simulate(30)` policy log
  as daily host commands, replayed against a captured native zero-day runner and
  providers; only the kernel issues daily ticks. The synchronous example bridges
  restore their prototype hooks in `finally` and must not run concurrently in one
  worker. Horse compaction remains in the example so its private audit cursor moves
  correctly. Every conservation check is validated hourly before successful checks
  are released to bound memory; the engine's transfer compaction alone retains them.
- Settlement has no MaterialProvider callback in `wages`: the rollback test uses an
  invalid wage fixture to fail the real wages step after a successful economy
  `produce`. The projects case throws from the material provider after a real `take`.

## Golden check (2615, 2026-10-30)
Compared after every adoption unit against the pre-adoption captures (`SOURCE.md`). Realism not compared (2604-2607 checked it).
- Kernel `harness/golden`, settlement and economy (`npx vitest run golden -t 'settlement: |economy: '`): **identical**.
  3 passed (settlement A1, settlement hamlet 30 days, economy three ports), 6 skipped (realism). Compared at kernel
  `141fbea`, settlement `a3bd3a9`, economy `57e99fa`.
- Pirate web `src/economy/golden` (`npx vitest run src/economy/golden --testTimeout=30000`, root pirate-ship web):
  **identical**, 1 passed. Compared at pirate-ship `725aa13`.
- No differences, so ADOPTION.md "Intentional differences" needed no entry.
- Gotcha: the Gate's `-t '^(settlement|economy):'` matches nothing, because the golden tests are nested under
  `describe('settlement')`, so the harness run reports 0 tests and passes vacuously. Use `'settlement: |economy: '`.

## P0 check (2612, 2026-10-30)
Partial. Only the kernel suite could be run from this session; the rest were not run, so no count is claimed for them.
- Kernel `npx vitest run`: **17 files passed, 149 tests passed** (no failures).
- Harness `thirty-days replay registry units` and `golden -t 'settlement: |economy: '`: **not recorded.** The run
  was moved to the background by the Bash timeout and produced no summary before this session ended.
- Settlement, economy, realism, pirate web: **not run.** The session's working directory is restricted to
  `Toolchain/kernel`, so `cd` into those repos was blocked. Settlement was tried with `--root` from kernel: 1 failed
  (`test/engine.test.ts` U17, ENOENT on `kernel/src/tick`), but that comes from the wrong cwd and is not a result.
- Baselines for the next run: settlement 27, economy 25, realism 239 + 1 todo, web 388.
