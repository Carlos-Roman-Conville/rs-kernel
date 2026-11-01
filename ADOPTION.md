# Adopting the Kernel: the edits per package (P0, Kernel keeper, 2026-10-30)

**P0 closed 2026-10-31** (Kernel keeper): every adoption and acceptance unit passed; the last re-check, 2696 (pirate web
33 files / 395 tests), passed 2026-10-30 23:59. The status line below is historical.

> **Recovered file (KRN-26; Card Games ISSUES I-1047, I-1048).** On 2026-10-30 at about 22:53 a realism worktree removal
> followed `node_modules` links into this repo and deleted its `.git` and 16 files. Rex checked Windows Previous Versions
> (none exist) and approved a controlled reconstruction. **The previous history is lost:** 48 commits, the last 5c76edd;
> commit hashes cited below refer to that lost history. This repo restarts with one "recovered" commit.
> How each lost file was rebuilt (details in `HQ/handoffs/kernel/ISSUES.md` KRN-26):
> - `data/*.json`: Codex patch replay plus unit 2648's logged script; the replay reproduced 30 surviving files byte for byte.
>   `unit-prefixes.json` is written UTF-8 (the original was probably cp1252 for `µ`).
> - `DESIGN.md`, this file, `HANDOFF.md`, `codex/RULES.md`, `harness/golden/golden.test.ts` and `SOURCE.md`: the last full
>   read captured in a session transcript plus every later logged edit, each checked against a later partial read.
>   Line endings normalised to LF.
> - `.gitignore`: from a logged directory listing (23 bytes).
> - `harness/golden/*.json`: regenerated at the commits `SOURCE.md` names (economy from its surviving source); every file has
>   its original byte size, and the old-to-new settlement diff reproduces `### 2698` exactly (6 and 214 paths).
>
> **Nothing in these files is untraceable:** every passage comes from a captured read or a logged edit.

**Status: proposed.** Nothing here runs until Rex approves `DESIGN.md`; every belt unit `Needs:` the approval marker
`2584-kernel-design-approval`. Each edit below is one belt unit (the file in
`Games/Card Games/_agent/queue/kernel/`), with its acceptance test. The order keeps every suite green at every step
(DESIGN.md §11). No edit deletes or rewrites engine behaviour; each one replaces a copy with an import of the same
code, or adds a hook, a test or a data file.

Rules for every adoption unit:

- The engine's full suite and typecheck pass after the edit with **the same test count or more** (baselines
  2026-10-30: settlement 27 at efc72cf, economy 25 at d84785a, pirate web 388 at fc83089, economy 25, realism 239 + 1 todo), and the pirate web suite (387) passes untouched.
- The engine depends on the kernel as `"@rex/kernel": "file:../kernel"` in `package.json` (`npm install` adds the
  symlink, as the pirate web does for the engines). Imports are `from '@rex/kernel'`.
- A unit changes only the files it names. Owners' other work in the same repo must not be in flight: the kernel lane
  runs an engine's adoption units only while that engine's own lane is idle (controller's scheduling).
- Each owner agreed (or objected) in DESIGN.md §12 before its units leave the queue.

## Golden outputs: adoption never changes a result (Rex, 2026-10-30)

**(Rex)** Adopting the kernel must not silently change existing results. The Kernel coordinates the engines; it never
changes their scientific or economic behaviour. So, before any adoption edit, the current outputs are recorded, and
every adoption unit proves they did not move:

| Unit | What it records or checks | Model |
|---|---|---|
| 2613 golden capture (engines) | `kernel/harness/golden/`: realism's checkpoints (human week with the hydration-week refresh, human wound, horse stable 30 days; `CHECKPOINTS.md`): result rows, final component states, `world.t`, every conservation check, transfer count and trace hash; settlement's A1 fixture (state, events, ledger) and the hamlet for 30 days; economy's three-ports `simulate(30)`. One canonical string per run, written once at the engines' current HEADs (`SOURCE.md`) | sonnet |
| 2614 golden capture (pirate benchmark) | the pirate adapter's I2 thirty-day run of both engines (`web/src/economy/golden.test.ts` and `golden/thirty-days.json`): states, ledger, economy log and events, the per-day rows I2 checks. In the pirate repo because the kernel never imports a game | sonnet |
| every adoption unit (2598–2599, 2601–2602, 2604–2607) | its Gate runs the engine goldens (`harness`, `vitest run golden`) and the pirate web suite (which includes 2614's test): any byte difference fails the unit | — |
| 2615 golden compare after adoption | the settlement, economy and pirate goldens once more after all adoption units (realism's were checked by 2604–2607, which run back to back in the realism lane; Reality's P1 units may change realism outputs after 2607); the result goes in `HANDOFF.md`; a difference passes only if it is listed below with its reason | haiku |

2598, 2601 and 2604 (the first edit in each engine) need 2613 and 2614, so the capture always precedes the change.
The settlement units 2598–2600 run in the **settlement lane** (one runner per repo; Settlement's P1 units need 2615).
The realism units 2604–2608 run in the **realism lane** (serialised with Reality's P1 units; 2604 also needs 2591 and
2595 so 2604–2607 run back to back); no output-changing realism commit may land between 2613 and 2607. A
golden file is never rewritten by an adoption unit.

## Intentional differences

None expected and none allowed so far. Every adoption edit is a re-export of identical code, an extracted function,
an added test or data file, or an option that is off by default; `world.t` set from the clock equals today's sum for
integer dt. Any difference must be added here, with its reason and Rex's or the owner's approval, before 2615 can
pass.

Outside the kernel's comparison: owners' P1 units that change outputs on purpose run **after** 2615 (their Needs name
it), so they are not adoption differences and are recorded in their own units: Settlement 2654 (one status writer: the spurious second `businessStatusChanged` event a producing day
is dropped, 20 → 1 in ten hamlet days; event streams in the goldens shrink, states unchanged), Settlement 2646-settlement-decay-by-material-class (buildings without a material class stop decaying: condition
moves in the hamlet and pirate thirty-day goldens) and 2616–2619 (labour in
person-hours, `Project.labourDays` → `labourHours`; settlement state and the pirate thirty-day golden change shape);
Economy's P1 re-records the 2614 pirate golden on purpose in 2629-economy-adapter-labour-hours (recipe rates
`labourPerUnit 0.25` → `labourHoursPerUnit 2.5`, CONTRACTS §16) and 2632-economy-retire-aliases (inventories minted at
load by Settlement's `inventoryOf`: ids change, empty inventories appear); both Gates require the golden's `rows`
(per-day production, prices, stocks, balances) byte-identical to the previous commit's; 2627 and 2631 leave it
untouched; Reality's batch-1 closures after 2607. A golden file that no longer
matches after those units is retired or re-captured by its owner, never by an adoption unit.

## Golden re-records after adoption (Kernel keeper; the no-silent-change rule continued)

After 2615 the pirate thirty-day golden (2614) stays in the pirate web suite and keeps guarding results: a P1 unit
that changes outputs on purpose re-records it in its own commit and writes an entry in
`Games/RPG's/pirate-ship/web/src/economy/golden/CHANGES.md` (changed keys, first paths, reason). Rule (proposed,
being agreed with Settlement and Economy 2026-10-30): the pirate-lane unit that first runs the web suite after a
settlement change re-records (2618 labour hours; 2651 decay by material class); Economy's 2629 and 2632 re-record with
their `rows` check; **2655** (pirate lane, Kernel keeper's) re-records once after Settlement's 2654, last, and fails
if anything other than the event streams moves. The kernel harness goldens (`harness/golden/`) are not run after
2615 and remain the pre-adoption record. Realism's will change on purpose after 2607 (Reality's 2656 compensates the
conservation sums in World and Trace; batch-1 units), which is why 2615 and 2612 do not run them. This section mirrors CHANGES.md.

| Unit | Golden | What changed | Reason |
|---|---|---|---|
| (filled from CHANGES.md as units land) | | | |

### 2698 harness settlement goldens re-recorded (Kernel keeper, KRN-23)

Settlement HEAD used: 0d76869. Fixture renamed to person-hours with CONTRACTS §16's stated conversion (×10, `hoursPerDay`
10): `labourPerUnit 0.25` → `labourHoursPerUnit 2.5`, `labourDays 0 / 2` → `labourHours 0 / 20`. `golden()` now also writes a
missing file (`GOLDEN_WRITE=1` still works). Every changed key is explained; none is unexplained.

`settlement-A1.json` (6 changed paths):
- `projects.proj.0001.labourDays` → `labourHours` (0), `proj.0002.labourDays` → `labourHours` (20), `proj.0002.progress` 2 → 20:
  rename and person-hour progress (e226b8f, labour supply and projects to person-hours).
- `buildings.bldg.0001.condition` 0.9965 → 1: the A1 building has no decay class, and unclassified buildings do not decay
  (79a848a, decay by material class).

`settlement-hamlet-30.json` (214 changed paths, 5 groups):
- `events`: `businessStatusChanged` 31 → 2 (the `staffed`/`producing` flips are gone; the 30 `wagePaid` events and the 2
  `projectCompleted` events are unchanged, other events equal): production is the only writer of `Business.status` in the
  tick (8dc8fcb).
- `projects.proj.N.labourDays` → `labourHours`, `progress` in hours, and `plan.decayClass` added: e226b8f and 79a848a/ca14252.
- `buildings.bldg.N`: `decayClass` added (`reed-thatch`, `wood-shingle`) and `condition` 0.9845 → 0.9986 (79a848a, ca14252);
  `bldg.0002.builtOn` 0 → 1 (its project now completes on day 1, e226b8f).
- `ledger`: the first project wage 2 on day 0 becomes 1 on day 0 and 1 on day 1 (hourly project labour, e226b8f), so one
  more transaction exists (39 → 40); every later `id`, `day` shift, and `counters.txn` 39 → 40 and `titles.title.0004.since`
  txn.0008 → txn.0009 follow from it.

### 5258 harness realism goldens re-recorded (Kernel keeper, I-1066)

Realism HEAD used: 9cec538. All six `harness/golden/realism-*.json` re-recorded with `npm run golden:write`; the eleven
realism commits since 15dc9d2 that move them are bisected in realism `validation/GOLDEN-DRIFT.md` (unit 5158) and each
has a reason line in `harness/golden/SOURCE.md`; two (2634, 2727) only add keys, by Reality keeper ruling 2026-11-01.
Settlement and economy goldens unchanged.

## Kernel (stage K; repo `Toolchain/kernel`, nothing outside it)

| Unit | Edit | Acceptance test (the Gate) | Model |
|---|---|---|---|
| 2585 scaffold | `package.json` (`@rex/kernel`, type module, vitest, typescript ~6.0.2 as the engines), `tsconfig.json`, `.gitignore` (`node_modules/`, `.claude/`), `src/index.ts`, `test/smoke.test.ts`, `README.md`, `HANDOFF.md` | `npm install`, `npx vitest run`, `npx tsc --noEmit` pass | sonnet |
| 2586 ids + guards | `src/ids.ts` (`mint` byte-identical to settlement's and economy's; `qualify(engine, id)`, `unqualify`), `src/guards.ts` (`must`, `nonempty`, `finite`, `integer`, same messages) | tests: `mint({}, 'bldg')` = `bldg.0001`, counter immutability, 10 000th id; each guard's message equals the engines' current text | codex |
| 2587 rng | `src/rng.ts`: `rng(seed)` (mulberry32 byte-identical to realism `process.ts`), `fnv1a32`, `mix32`, `streams(runSeed)` with `get(mechanismId)`, `state()`, `restore()` | the first 1 000 draws of `rng(1)` and `rng(42)` equal realism's (vector pinned in the test); two ids give independent sequences; state round-trip continues the sequence | codex |
| 2588 runner + transaction | `src/runner.ts` (generic `Runner` with `log`, `events`, `run`, static `replay`), `src/transaction.ts` (`Participant`, `transaction`) | a toy counter reducer: replay of the log gives `canonical`-equal state; a throwing command leaves state and log untouched; a transaction over two participants restores both on a throw and drops its events | codex |
| 2589 time + scheduler + order | `src/time.ts`, `src/scheduler.ts`, `src/order.ts`, `data/order.json` | 1 s, 1 h and 1 d processes over 2 days run in the declared order at each shared instant (phase, then position); a process missing from the order throws; `dt` is the time since its last run; 2.6 M instants with three periods and no-op processes under 2 s | codex high |
| 2590 events | `src/events.ts` (bus, `evt.NNNNNN` ids, `cause`, `since(cursor)`) | ordering by (t, phase, position, sequence); an event emitted in a later phase is invisible to an earlier phase at the same instant; ids continue after a snapshot restore | codex |
| 2591 snapshot | `src/snapshot.ts` (`canonical`, `fnv1a64`, `Snapshot` type, `take(participants)`, `restore`) | key order never changes the string; `-0` → `0`; `NaN` throws; round-trip of a nested state is equal | codex |
| 2592 units | `data/units.json` (each row sourced), `src/units.ts` (`parse`, `dim`, `sameDimension`, `convert`) | `kcal/day` → W dimension and 4184/86400 scale; `J/(kg K)` parses; °C ↔ K affine; `kg` vs `m` refuses conversion; every row has a source | codex |
| 2593 ports | `src/ports.ts` (`declareOutput`, `declareInput`, `PortTable`) | undeclared write throws; a second writer of one output throws; a wire between different dimensions throws | codex |
| 2594 resolution | `src/resolution.ts` (`Resolution`, `switchTo`, the round-trip check) | a toy aggregate of N people with conserved count and mass: refine then coarsen keeps both within tolerance; a refine that loses a person throws and rolls back | codex |
| 2595 compaction | `src/compact.ts` | after compaction past a horizon, per-key sums and consumer cursors give the same totals as the uncompacted list; records flagged keep are never dropped | codex |
| 2596 check script | `scripts/check-registry.ts <registry dir> <kernel.json…>` (`npm run check-registry`), reading `mechanisms.json`, `quantities.json`, `aliases.json` (DESIGN §8, the registry keeper's scheme), and fixtures under `test/fixtures/registry/` | fixtures: a clean registry passes; an unknown mechanism id fails; a write of a quantity not in `quantities.json` fails; a quantity written by two mechanisms, or by one that is not its `writer`, fails; an `aggregates` link with a missing target or empty interface/test fails; aliases resolve; restatements and unbuilt rows are not checked; an unknown stream id fails; an unparsable or `unknown` unit fails | sonnet |
| 2597 fence check | `test/fence.test.ts` | no file in `src/` or `scripts/` imports `@rex/realism`, `@rex/settlement`, `@rex/economy` or a path outside the package | haiku |

## Settlement (`Toolchain/settlement`)

| Unit | Edit | Acceptance test | Model |
|---|---|---|---|
| 2598 ids + guards | `package.json`: add `"@rex/kernel": "file:../kernel"`; `src/ids.ts`: keep `PREFIXES`, `Prefix`, `Counters`, `prefixOf`, `isPool`; replace the body of `mint` with a re-export of the kernel's (`export { mint } from '@rex/kernel'`, typed to `Prefix`); `src/context.ts`: `must`, `nonempty`, `finite` re-exported from the kernel | 27 tests green, typecheck clean, `grep '@rex/kernel' src/ids.ts src/context.ts`; pirate web 388 (387 until fc83089) green | sonnet |
| 2599 runner | `src/reduce.ts`: `Runner` extends the kernel `Runner` (constructor, `run<T>()` returning `result`, `tick(days)` kept); **adds** `static replay(log, config, providers, from)` | 27 green plus Settlement's test **U15**: the hamlet and A1 replayed through `Runner.replay(log)` against providers rebuilt by the same host setup (their own replay), state and events deep-equal; `run<T>` still returns the result; pirate web green (adapter T1) | codex |
| 2600 declarations | `kernel.json` at the repo root (DESIGN §8 field names): process `settlement.tick` (period DAY, phase `day.settlement`, the seven steps never split), its mechanism ids, `writes`/`reads` as quantity ids from `registry/quantities.json` | the check script exits 0 on it | sonnet |

What Settlement keeps: its command switch, `tickOrder` as config (the kernel orders the whole tick against other
engines; the order of steps inside the tick stays settlement's config), `tickTrace`, `state.settlement.day`, its
prefixes. What changes for its host: nothing until the pirate adapter moves to the kernel (pirate lane, later).

## Economy (`Toolchain/economy`)

| Unit | Edit | Acceptance test | Model |
|---|---|---|---|
| 2601 ids + guards | `package.json` dependency; `src/ids.ts` re-exports `mint` (keeps `PREFIXES`, `Prefix`, `Counters`, lazily keyed); `src/context.ts`: `must`, `nonempty`, `finite`, `integer` from the kernel; iteration order over records untouched | 25 green (E3 byte-for-byte, E14 unchanged, counters JSON identical), typecheck; pirate web green (I1, I2) | sonnet |
| 2602 runner | `src/reduce.ts`: `Runner` extends the kernel `Runner`; `run()` returns the whole `ReduceResult` (`minted`, `taken`); `replay(log, config, providers, from)` keeps `from`; provider-issued commands stay in the log in the order run | 25 green; E3 byte-for-byte; pirate web green (I1, I2) | codex |
| 2603 declarations | `kernel.json`: process `economy.tick` (DAY, phase `day.economy`), its mechanism ids, `writes`/`reads` as quantity ids | the check script exits 0 on it | sonnet |

What Economy keeps: `apply()`, `tickOrder` config, `state.day`, `advance` as its own step, shipments' `arrives` in
days. Economy's `Runner.log` stays its audit log, including the commands Settlement's MaterialProvider runs; the
kernel's input log never replays those (DESIGN §4.2).

## Reality & Species (`Toolchain/realism`)

| Unit | Edit | Acceptance test | Model |
|---|---|---|---|
| 2604 rng | `package.json` dependency; `src/process.ts`: `export { rng } from '@rex/kernel'` replacing the local body | 239 green + 1 todo (still and medicine seeded tests unchanged); pirate web green | sonnet |
| 2605 stepOnce | `src/scheduler.ts`: extract the loop body of `run` into `stepOnce(world, dt, tAfter?)` (processes in insertion order by `% every` with `dt * every`; then `world.t = tAfter` if given, else `+= dt` as today; then `afterStep`); `run` calls it `n` times | 239 green; new `test/scheduler.test.ts`: `run(w, 10, 1)`, ten `stepOnce(w, 1)` and ten `stepOnce(w, 1, k)` give equal worlds and traces; pirate web green | codex |
| 2606 world snapshot | `src/snapshot.ts` (**Reality's**): `snapshotWorld(world, scheduler?)` → plain JSON for comparison; **no restore in P0** (P0 replay = restore initial + rerun, agreed) | horse-stable (shortened) and human-wound each run twice give `canonical`-equal snapshots; 239 green | codex |
| 2607 trace compaction | one `Trace.compact(horizonT)` owned by realism (may use the kernel's `Compactor`) that also moves World's conserved and element cursors; crises and failed checks kept; off by default | default-off: every old test unchanged; horse-stable at 1 s for 3 days compacted hourly: zero failed checks, the same daily ledger as uncompacted, bounded transfer count | codex |
| 2608 declarations | `kernel.json`: process `realism.step` (period = host dt, phase `fast`, `insertion` order inside) with the mechanism ids of the processes `examples/horse-stable.ts` registers, quantity ids, streams | the check script exits 0 on it | sonnet |

What Reality keeps: every process, `every` semantics, `world.t` as its float, `afterStep`, `Trace`, `Registry`,
the library loader. Per-process kernel scheduling, RNG streams for still/medicine, and UNIT-15 rewiring through ports
are Reality's later choices (P1), not P0.

## Harness (stage H; `Toolchain/kernel/harness/`, its own package.json; the only code that imports engines)

| Unit | Edit | Acceptance test | Model |
|---|---|---|---|
| 2609 30-day run | `harness/package.json` (file deps on kernel and the three engines), `harness/thirty-days.ts`, `harness/thirty-days.test.ts`. (1) Equivalence: horse-stable at 60 s through the kernel gives a byte-identical trace to direct `Scheduler.run`; human-wound at 1 s fires at exactly `woundAtS`; the hamlet and the three-ports fixture give the same 30-day state as their direct runs. (2) The run: horse-stable's world at dt 1 s with `Trace.compact` hourly, the hamlet and the three-ports fixture on one clock, settlement's tick in a transaction with the economy runner | **P0 test 1:** 30 days run; at each midnight realism step, then settlement tick, then economy tick; `tickTrace` lists all seven steps; days equal `floor(T/DAY)` and a skipped or doubled day fails; `world.t === T/1000`; no failed realism check; economy goods and money invariants hold; a provider throwing in `wages` after `produce` (and in `projects` after `take`) leaves economy state, log and events at the pre-tick snapshot and settlement unchanged; load-time seed events not re-emitted | codex high |
| 2610 replay + seed | `harness/replay.test.ts` | **P0 test 2:** restore initial + rerun with the same inputs and seed gives `canonical`-equal snapshots at day 30; a different seed changes realism's stochastic state and leaves settlement and economy equal | codex |
| 2611 registry and units checks in the harness | `harness/registry.test.ts` runs the check over `Toolchain/registry` and the three `kernel.json`; fixtures prove it fails on an unregistered quantity and on two writers. `harness/units.test.ts`: every unit in realism's `data/library/*.json` and `substances.json` headers parses (missing rows added to `data/units.json` with sources) | **P0 test 3**, plus Reality's units condition | sonnet |
| 2612 P0 check | runs every suite (kernel, harness, settlement, economy, realism, pirate web) and writes the counts into `HANDOFF.md` | all green; counts not lower than the baselines | haiku |
