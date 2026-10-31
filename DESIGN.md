# The Kernel: design (P0, Kernel keeper, 2026-10-30)

**Status: approved (Rex, 2026-10-30).** Rex approved the design with the proposed answers to K-O1, K-O2, K-O3 and K-O5 (§13); the belt units run. Every item is marked **(Rex)** = Rex's
decision, **proposed** = the Kernel keeper's proposal, or **open** = a question for Rex or an owner. The adoption
edits per package are in `ADOPTION.md`; the belt units in `Games/Card Games/_agent/queue/kernel/`.

## 0. The fence and the rules

**(Rex, 2026-10-30)** The Kernel owns simulation time and scheduling across timescales (ms to years) with declared
process order; event ordering and causality; stable identifiers; units and dimensional validation; seeded
random-number streams per mechanism; state snapshots and replay; cross-engine transaction boundaries. **It never owns
a scientific or economic formula**: physics stays physics', biology biology's, economy economy's. It coordinates
without duplicating.

Package rules **(Rex)**: `Toolchain/kernel/` is its own git repo, TypeScript with vitest like the others, imports
nothing from any engine or game; the engines import it. Nothing existing is deleted or rewritten (PLATFORM §10); no
disruptive migration until the affected keepers agree ownership and acceptance tests (ENGINES.md).

**(Rex, 2026-10-30)** Adopting the kernel must not silently change existing results: the thirty-day settlement
simulation (the pirate adapter's I2 benchmark, settlement's A1) and the realism checkpoints (`CHECKPOINTS.md`) give the
same outputs under equivalent initial conditions before and after adoption; any intentional difference is documented
in ADOPTION.md with its reason. Golden outputs are captured before the first adoption edit and checked in every
adoption unit's Gate (ADOPTION.md "Golden outputs", units 2613–2615).

What the Kernel closes (GRAPH.md): **DUP-32** (reducer, runner, ctx, mint, must, finite copied in three engines;
three id schemes), **DUP-33** (six clocks, nothing converting), **UNIT-13** (three day counters plus seconds),
**UNIT-5 / -9 / -12** (units, via the units table and the registry check; the fixes inside each mechanism stay the
owner's P1 work), **UNIT-15** (interfaces by registry id: the Kernel supplies the port, Reality rewires in P1),
**REAL-10** (trace compaction: a helper; the Trace stays realism's). **DUP-22** and **DUP-44** are *not* the
Kernel's to close: they are ownership questions (body water; inventory identity). The Kernel only gives them the
tools: one writer per output (the check script, §8) and qualified ids (§3), so Reality and Economy can close them
in P1.

Proposed module layout (`src/`, one file per service, each with its test file):

| File | Service | Closes |
|---|---|---|
| `time.ts` | integer simulation time, period constants | DUP-33, UNIT-13 |
| `scheduler.ts` | the clock, processes, phases, declared order | DUP-33 |
| `order.ts` + `data/order.json` | the declared phase and process order, as data | GRAPH §4 run-order coupling |
| `events.ts` | the event bus: ordering, causality | ENGINES "universal time and events" |
| `ids.ts` | `mint`, qualified ids | DUP-32 |
| `guards.ts` | `must`, `finite`, `nonempty`, `integer` | DUP-32 |
| `runner.ts` | generic reducer runner with log and replay | DUP-32 |
| `transaction.ts` | participants, all-or-nothing across engines | ENGINES fence |
| `snapshot.ts` | canonical JSON, snapshot, hash | ROADMAP P0 test 2 |
| `rng.ts` | mulberry32, streams keyed by mechanism id | DUP-32, P0 test 2 |
| `units.ts` + `data/units.json` | the units table, dimensions, conversion | UNIT-5, -9, -12 |
| `ports.ts` | outputs keyed by registry id with a declared unit | UNIT-15 |
| `resolution.ts` | the aggregate ↔ individual hand-off contract | PLATFORM §9 |
| `compact.ts` | rolling compaction of an append-only ledger | REAL-10 |
| `scripts/check-registry.ts` | the registry check | ROADMAP P0 test 3 |
| `harness/` | the 30-day three-engine acceptance run (its own package.json; the only place that imports engines) | ROADMAP P0 tests 1–2 |

## 1. What exists today (read 2026-10-30)

| Service | realism (`src/`) | settlement (`src/`) | economy (`src/`) |
|---|---|---|---|
| Clock | `World.t` seconds (float, `+= dt` each step) | `state.settlement.day` (int) | `state.day` (int) |
| Scheduler | `Scheduler.run(world, seconds, dt)`: `n = round(seconds/dt)` fast steps; a process runs when `stepCount % every === 0` with `dt * every`; processes in registration order; then `world.t += dt`, `world.afterStep()` (conservation checks). dt is the host's (1 s in the 30-day pirate run, 60 s in `examples/human-week.ts`) | `tick(ctx)`: `config.tickOrder` = decay, projects, staffing, production, wages, publicWorks, expiry; `tickTrace`; then `day += 1` | `tick(ctx)`: `config.tickOrder` = production, shipments, spoilage, consumption, prices, advance (`advance` does `day += 1`); `tickTrace` |
| Cross-engine order | none | CONTRACTS §9: settlement tick, then economy tick; enforced only by the pirate adapter's `runDay` (throws on day mismatch) | same |
| Reducer | none: `World` is mutable (Maps, `Graph`, `Trace`, Kahan carry `WeakMap`) | `reduce(state, command, config, providers)` → `{state, events, result}`, `structuredClone` first; `Runner` with `log` and `events`, **no replay** | `reduce` → `{state, events, minted, taken}`; `Runner` with `log`, `events` and **static `replay(log)`** (E3) |
| Ids | host strings for components, substances, materials, edges; library rows `file.table.row` | `mint(counters, prefix)` → `prefix.0001`, 13 prefixes, `pool.*` host ids | the same `mint`, 5 prefixes (inv, mkt, ship, ord, org); everything else host-opaque |
| Guards | `Registry.substance/material/component` throw on unknown | `must`, `nonempty`, `finite` | `must`, `nonempty`, `finite`, `integer` (byte-identical copies of settlement's) |
| RNG | `rng(seed)` mulberry32 in `process.ts`; used by `lab/still.ts` and `medicine.ts` (`seed ?? 1`) | none | none |
| Trace | `Trace`: every transfer, checks, notes, crises; grows without bound (REAL-10) | `tickTrace` per day; ledger rows | `tickTrace`; events |
| Snapshot | none | state is plain JSON | state is plain JSON |
| Units | SI in code with inline conversions (`KCAL_J`), per-row units in library tables | money unitless, hours/day config | money, weight, volume unitless (UNIT-12) |
| Tests touching these | `registry.test.ts`, `checkpoint1/2`, `hydration-week`, `perf`, `still`, `medicine` (seeded), every process test via `Scheduler` | `engine.test.ts`, `acceptance.test.ts` (tickTrace order, determinism) | `engine.test.ts` E3 replay byte-for-byte; `labour-and-sim.test.ts` E14 three-port determinism |

Baseline before any adoption: settlement 27 tests (26 until efc72cf, 2026-10-30), economy 25, realism 239 + 1 todo (run 2026-10-30), pirate web 388 (387 until fc83089).

## 2. Time and scheduling (DUP-33, UNIT-13)

### 2.1 One clock, integer milliseconds (proposed)

- `SimTime` is an **integer count of milliseconds since the run's epoch**, a JS number kept a safe integer
  (≤ 2^53 ms ≈ 285 000 years). Integer time means no float drift between engines: a day is exactly 86 400 000 ms
  and "day N" is `floor(t / DAY)` everywhere.
- Period constants in `time.ts`: `MS`, `SECOND`, `MINUTE`, `HOUR`, `DAY` (exact), and `TROPICAL_YEAR =
  31 556 925 216 ms` (365.24219 d, researched: the mean tropical year, IERS/Astronomical Almanac). **Open (Rex):**
  whether a multi-year aggregate step uses the tropical year, a 365-day year, or the period's calendar (Julian
  vs Gregorian in 1690s England differ by 10 days). The Kernel offers the constants; the choice of a calendar is
  the Catalogue's / History's (P4, P10), not the Kernel's. **Open:** the epoch's calendar date is a run parameter
  carried in the snapshot (`epoch: "1690-01-01"` as a label only); the Kernel never computes with it.
- Sub-millisecond processes (none today) would need a finer tick; the integer unit is a single constant, so moving
  to microseconds is a one-line change before any snapshot exists, a migration after. **Open:** keep ms.

### 2.2 Processes and phases (proposed)

A **process** is anything the clock runs: `{ id, mechanisms: string[], period: SimTime, offset?: SimTime, phase:
string, run(ctx: { t, dt, rng, emit }) }`. `id` is unique in a run; `mechanisms` lists the registry ids it executes
(for the check script and the RNG streams). `dt` is the time since this process last ran (= `period` except on the
first run after an offset or a resolution switch).

A **phase** groups processes that run at the same instant in a declared order. The order of phases, and of
processes inside a phase, is **data** (`data/order.json`, the host may extend it), never registration order and
never comments:

```json
{ "phases": ["fast", "cognition", "host", "day.settlement", "day.economy", "aggregate"],
  "order": { "fast": ["realism.step"], "day.settlement": ["settlement.tick"], "day.economy": ["economy.tick"] } }
```

The instant rule: the scheduler advances to the next `T` at which any process is due (`(T - offset) % period ===
0`). At `T` it runs every due process sorted by (phase index, position in the phase's order list). A process due
at `T` **closes the interval ending at `T`**: the 1 s realism step that ends at midnight runs before the day's
settlement tick at that same midnight, so the daily tick reads a finished day of physiology (the BODY.md §4 rule,
"each process reads finished inputs", lifted to the engines). A process with no entry in `order.json` is an error,
so the order across engines is always declared. A phase may declare its order as `"insertion"`: its processes
then run in the order added. That is the default for an engine's own processes (Reality's condition: existing
hosts declare nothing and keep their order). The scheduler never reads the wall clock.

How the three timescales share it:

| Process | Period | Phase | Today |
|---|---|---|---|
| `realism.step` | the host's dt (1 000 ms in the 30-day run) | fast | realism `Scheduler`, one call per step |
| `settlement.tick` | `DAY` | day.settlement | `Runner.tick()` |
| `economy.tick` | `DAY` | day.economy | `economy.run({type:'tick'})` |
| an aggregate village (P10) | e.g. `TROPICAL_YEAR` or a season | aggregate | none yet |

Cost: 30 days at 1 s is 2 592 000 instants. The scheduler's per-instant overhead must be O(due processes), not a
scan of every process: proposed a bucket per distinct period (most runs have three to six periods), next-due time
per bucket, `min` over buckets. Acceptance: `scheduler.test.ts` P-perf: 2.6 M instants with three periods finish
in under 2 s on this machine with no-op processes (the engines' own cost is theirs).

Realism's inner `every` semantics are kept exactly: in stage 1 the Kernel runs realism's whole step as one
process (`Scheduler.stepOnce`, ADOPTION R2), so `stepCount % every`, `dt * every`, registration order inside the
step, `world.t += dt` and `afterStep()` are unchanged and every realism test stays green. Stage 2 (optional,
Reality's call, P1 or later) registers each realism process as its own Kernel process with `period = every × dt`
in phase `fast`, its order list taken from realism's declared order, and `afterStep` as the phase's end hook; that
is where the GRAPH §4 run-order coupling becomes data.

`world.t` is **set from the clock** (Reality's condition, §12): the kernel adapter calls `stepOnce(world, dt,
T/1000)`, which assigns `world.t` instead of accumulating it, so `world.t` stays an exact integer number of seconds
for integer dt and the host checks `(world.t + dt) % 86400 === 0` and `world.t === woundAtS` keep firing. Without the
kernel, `run` keeps `world.t += dt` exactly as today (identical for integer dt). The adapter asserts
`world.t === T/1000` each step. Settlement's `state.settlement.day` and economy's `state.day` stay theirs;
the adapter asserts each equals `floor(T / DAY)` after its tick (this replaces `runDay`'s day-mismatch check).

### 2.3 Events across engines (proposed)

- An **event** is `{ id, t, source, type, payload, cause? }`. `id` is minted by the Kernel (`evt.000001`, a counter
  in the snapshot); `source` is the emitting process id; `cause` is the id of the event or external command that
  led to it (causality is recorded, never inferred).
- Order is total and deterministic: `(t, phase index, process position, emission sequence)`.
- **Delivery is never synchronous across engines.** An event emitted at `T` by a process in phase *p* is visible
  to processes in later phases at the same `T`, and to every process at later instants; never to a process
  earlier in the order at `T` (that would be a hidden cycle). Subscribers read a queue (`bus.since(cursor)`),
  they are not called back.
- Settlement's and economy's existing `events` arrays are published by their adapters unchanged; realism's crisis
  records can be published the same way later (Reality's call).
- The existing synchronous coupling, settlement's `MaterialProvider` calling economy commands mid-tick, is a
  **provider call, not an event**, and stays as CONTRACTS §13 agreed. The Kernel wraps it in a transaction (§6).

### 2.4 Migration order for time (each step keeps every suite green)

1. Kernel `time.ts`, `scheduler.ts`, `order.ts` with their own tests (no engine touched).
2. Realism gains `Scheduler.stepOnce(world, dt)` (the loop body of `run`, extracted; `run` calls it). Pure refactor.
3. The harness registers `realism.step`, `settlement.tick`, `economy.tick` and runs 30 days (P0 test 1).
4. The pirate adapter's `runDay` may later call the Kernel instead (pirate lane, its keepers' call; not P0).

## 3. Identifiers (DUP-32)

Proposed scheme, chosen so **no existing id changes**:

- **Local id** (inside an engine's state): exactly today's. Minted ids stay `prefix.NNNN` (four digits, widening
  past 9999 as today's `padStart` already does); host ids (realism components, `pool.*`, goods, recipes) stay
  opaque strings.
- **Qualified id** (only at the Kernel boundary: events, snapshots, the check script, cross-engine references):
  `<engine>/<local id>`, e.g. `settlement/bldg.0001`, `economy/inv.0003`, `realism/body`. The `/` never occurs in
  a minted id. A host-supplied id that contains `/` is rejected only at the boundary (open: none found today).
- **Mechanism ids** are the registry's `<engine>.<area>.<mechanism>` (registry keeper's scheme, §9).
- **Kernel-minted ids**: `evt.NNNNNN` (events), `run.<seed>` (a run label).
- `mint(counters, prefix)` moves to the Kernel byte-identical; each engine keeps its own `PREFIXES` list (which
  prefixes exist is the engine's business) and re-exports `mint`. Settlement's `prefixOf`, `isPool` stay its own.

The three schemes mapped:

| Engine | Today | Under the Kernel |
|---|---|---|
| realism | host strings; library ids `file.table.row` | unchanged; qualified `realism/<id>` at the boundary |
| settlement | `mint` 13 prefixes; `pool.*`; placeholder `inv.port.<place>` refs to economy inventories | unchanged locally; `mint` imported; a reference to another engine's record should carry the qualified id (open, DUP-44: settlement's `Project.account` as inventory id is Economy's and Settlement's to settle in P1) |
| economy | `mint` 5 prefixes; host-opaque goods, recipes, holders | unchanged; `mint` imported |

Collision note: settlement and economy both mint into separate counters, so `inv.0001` can be minted by economy
only; settlement never mints `inv`. Qualification removes any future clash (two engines minting `org.0001`).

## 4. Reducer, replay, snapshots (DUP-32; P0 test 2)

### 4.1 The reducer contract (proposed)

An engine that is a reducer keeps its own `reduce(state, command, config, providers)` and command switch; the
Kernel supplies the shared parts so they exist once:

- `guards.ts`: `must`, `nonempty`, `finite`, `integer`: byte-identical to the current copies (same messages).
- `runner.ts`: `class Runner<S, C, R extends { state: S; events: E[] }, E>` built from a `reduce` function,
  holding `state`, `log` (structuredClone of each command), `events`, with `run(command)` and
  `static replay(log, …)` exactly as economy's. Each engine's `Runner` becomes a thin subclass that keeps its
  constructor signature and extras (settlement's `tick(days)` and `run<T>()` returning `result`; economy's
  `ReduceResult` with `minted`/`taken`). Settlement thereby **gains** replay.
- Rule kept from both engines: the state is copied before a command; a throw leaves the caller's state untouched.

### 4.2 Replay (proposed)

Two logs, never confused:

- An **engine log** (`Runner.log`) records every command the engine reduced, including those its providers issued
  on another engine's behalf (economy's log holds the `produce` commands settlement's MaterialProvider ran). It
  remains the engine's own audit record and its own E3 replay.
- The **Kernel input log** records only **external inputs**: each command a host or player gave, with its `T`, the
  run seed, and the starting snapshot. Replay = restore the snapshot, re-run the scheduler to the same `T`,
  applying each logged input at its `T` before the instant's processes. Provider-issued commands are regenerated,
  so they are never applied twice.

### 4.3 Snapshots (proposed)

`Snapshot = { kernel: { version, t, epoch, seed, eventCounter, rng: { <mechanism id>: state } }, engines: {
<engine>: unknown } }`. Each engine's part comes from its participant adapter (§6): settlement and economy their
state JSON (already plain); realism a `snapshotWorld(world)` **owned and written by Reality**.

**The P0 definition of replay (agreed with Reality):** restore the *initial* state and rerun with the same inputs
and seed. That is exact today and needs no mid-run restore. Realism's snapshot in P0 is therefore an export for
comparison only (components, graph, `t`, `env`, tallies and cursors, trace, `stepCount`). Mid-run restore needs
the Kahan carry (a private `WeakMap` today; without it restored masses drift past the 1e-9 checks within hours) and
the rng state (hidden in a closure); Reality will make both serialisable when a mid-run snapshot is first needed
(K-O11). Settlement and economy can restore mid-run today (plain JSON); economy's iteration order (insertion order
of its records) must survive any snapshot, so the kernel never re-keys or sorts an engine's state, it only sorts keys
when writing `canonical` strings for comparison.

`canonical(x)`: JSON with object keys sorted, `undefined` dropped, numbers by `JSON.stringify` (shortest exact
round-trip), `-0` written as `0` (open: realism to confirm no `-0` matters), `NaN`/`Infinity` rejected. "Replays
byte-identical" means `canonical(snapshotA) === canonical(snapshotB)`. A short hash (FNV-1a 64, pure TS, so it
also runs in the browser build) labels snapshots in logs; tests compare the strings, never only the hash.

## 5. Seeded random-number streams (DUP-32; P0 test 2)

- The generator stays **mulberry32**, byte-identical to realism's `rng(seed)`; `kernel.rng` is that function and
  realism's `process.ts` re-exports it, so `still.ts` and `medicine.ts` give the same numbers (`seed ?? 1`
  unchanged).
- **Streams:** `streams(runSeed).get(mechanismId)` returns a mulberry32 whose seed is
  `mix32(runSeed, fnv1a32(mechanismId))` (a murmur3-style finaliser). One stream per registry mechanism id, so
  adding a draw in one mechanism never shifts another mechanism's numbers. Requesting a stream for an id with no
  registry row fails the check script (§8), not the run.
- Stream state is the generator's 32-bit integer, kept in the snapshot; `restore` continues the same sequence.
- **Per-entity streams** (Cognition's C-K1, unit 2660): `get(mechanismId, entityId?)`; with an entity the seed is
  `mix32(mix32(runSeed, fnv1a32(mechanismId)), fnv1a32(entityId))`, so one mind's draws never depend on how many
  minds exist; snapshot key `<mechanismId>@<entityId>`; declarations still list mechanism ids only.
- Engines migrate to streams at their own pace: realism's two seeded uses could take
  `realism.infra.operator_control` / `realism.medicine.process` streams; that changes their numbers, so it is a
  Reality decision with its tests re-pinned, not a P0 step. Settlement and economy have no randomness today.
- P0 test 2's second half: two runs with seeds s1 ≠ s2 differ only in state written by mechanisms that drew from a
  stream, or that read (transitively, through declared reads) such state. The harness checks it per engine; in the
  30-day harness the stochastic mechanism is a realism process and no settlement or economy input reads it, so
  their snapshots must be equal across seeds while realism's differs.

## 6. Cross-engine transaction boundaries (proposed)

- A **participant** is an adapter `{ id, snapshot(): unknown, restore(s: unknown): void }`. Settlement's and
  economy's runners: `{ state (structuredClone), log.length, events.length }`; realism: `snapshotWorld` /
  `restoreWorld` (Reality's), or "not restorable" for now (then realism is never inside a multi-engine transaction;
  P0 needs none).
- `transaction(participants, fn)`: snapshot every participant, run `fn`, and on a throw restore all of them, drop
  the events emitted inside, and rethrow. Nothing else.
- First use: a settlement tick includes the economy runner as a participant, because settlement's MaterialProvider
  runs economy commands mid-tick and settlement's own `reduce` throws on a copy while the economy runner has already
  moved (settlement's reduce.ts comment: "a throw after a provider call is the host's to roll back"). The Kernel
  becomes that host.

## 7. Units and dimensional checks (UNIT-5, -9, -12)

- `data/units.json` (data, sourced): each symbol → `{ dim: [m, kg, s, K, mol, A, cd, money, count], scale,
  offset?, source }`. SI base and derived units (J, W, Pa, N, L, h, d, kcal = 4184 J thermochemical per NIST SP 811,
  °C with offset 273.15), plus two non-SI base dimensions **proposed**: `money` (one dimension; **which currency and
  any exchange rate are Economy's**, UNIT-12) and `count` (persons, items, units of a good). **Open (Rex):** whether
  "unit of a good" is dimensionless count or its own dimension per good. The labour unit is `person*h` (person-hours, Settlement CONTRACTS §16;
  requested by Reality 2026-10-30): the base symbol `person` (dimension count) times `h`.
- `units.ts`: `parse("kcal/day")` handles products, quotients, powers and parentheses (`J/(kg K)`); `dim(u)`,
  `sameDimension(a, b)`, `convert(x, from, to)` (affine only for temperature points).
- **No runtime tagging of engine numbers** (cost, and every engine's arithmetic stays its own). Units are checked
  where they are declared: registry rows' inputs and outputs (the check script, §8), port declarations (§7.1), and
  a wire from one mechanism's output to another's input must have equal dimension, with the scale converted at the
  edge by `convert`.
- UNIT-5 (kcal vs J), UNIT-9 (per-year/day/second inline): the check flags them as "unparsed" or "dimension
  mismatch on a wire"; the fixes are inside realism's mechanisms (Reality's P1 work). UNIT-12: Economy chooses a
  unit per good; the Kernel only checks it parses.

### 7.1 Ports: interfaces by registry id (UNIT-15)

`ports.ts`: `declareOutput(mechanismId, outputId, unit)` and `declareInput(...)`; a `PortTable` per entity
(`write(outputId, value)`, `read(outputId)`) that throws on an undeclared output or a second writer of one output,
and checks dimensions when an input is wired to an output. The Kernel holds no value semantics; the owner of the
output is the registry row. Reality rewires neurology's inputs through it in P1 (UNIT-15's fix is Reality's).

## 8. The registry check script (P0 test 3)

The scheme agreed with the registry keeper (2026-10-30, §12): mechanism ids plus a separate **quantity vocabulary**.
The registry keeper keeps `Toolchain/registry/quantities.json` (`{ id: "<scope>.<quantity>", unit (a kernel
units-table symbol), scope, writer: one mechanism id, description }`; each quantity's owner is its writer's keeper)
and `registry/aliases.json` (`{ old, new, date, reason }`; a retired id is never reused). Mechanism rows gain
`writes` and `reads` (quantity ids) in schema version 2.

`scripts/check-registry.ts <registry dir> <kernel.json…>`; aliases resolved first; only rows with `kind:
"mechanism"` and `status: "built"` are checked; exit 1 with a list on any failure:

1. a process names a mechanism id with no row, or writes a quantity id absent from `quantities.json`;
2. a quantity is written by two mechanisms, or by one that is not its `writer`. **No exception list:** a detailed and
   an aggregate mechanism write different quantities at different scopes (`body.death` vs `population.deaths`);
3. an `aggregates: { of, by, interface, test }` link names a missing quantity or mechanism, or leaves the interface
   or test empty (refinement B, §9);
4. an RNG stream is requested for a mechanism id with no row;
5. a quantity (of kind `quantity`, the default) or port unit does not parse; quantities of kind `categorical`,
   `record` or `text` have `unit: null`, skip unit checks, and wires must join the same kind (unit 2648);
   SI prefixes and the rows mmHg, ppm, a (Julian year, a unit only), MET (1 kcal/(kg h)) are added by 2648.
   Formerly: a quantity or port unit does not parse (`unknown` fails; free-text `unitless` maps to `1`), or a wire joins two
   different dimensions.

**Declarations** (agreed field names): each engine keeps, as data, `kernel.json` at its root: `{ processes: [{ id,
mechanisms, writes, reads, period, phase, order? }], ports: [{ mechanism, quantity, unit, direction }], streams:
[mechanism ids] }`, `writes`/`reads` being quantity ids. Data, not code, so the check runs without importing the
engine. The declarations are each owner's; their first versions are adoption units; the registry mirrors them.

## 9. The resolution hand-off (PLATFORM §9; refinement B)

PLATFORM §9: "Finer resolution refines the aggregate, never contradicts it." The Kernel owns the **protocol**, never
the quantities or the formulas:

- `Resolution<A, I> = { id, conserved: { quantity, unit, tolerance }[], coarsen(individuals: I): A,
  refine(aggregate: A, rng): I }`, registered by the owning engine (Society / History for villages, Reality for
  bodies in BODY §8's sim levels).
- `switchTo(fine | coarse, at T)` runs inside a transaction (§6): it deactivates the coarse processes and activates
  the fine ones (or the reverse) at an instant boundary, never mid-instant.
- **The check the Kernel enforces:** on refine, `coarsen(refine(a))` equals `a` on every `conserved` quantity within
  tolerance; on coarsen, the aggregate after the switch equals `coarsen(individuals)` exactly (no jump). A failure
  throws and the transaction rolls back.
- Which quantities are conserved, their tolerances, and when a switch happens are the owning engine's (and Rex's
  where no source decides). P10's "village run individually and aggregated agrees within 10 % over 50 years" is
  History's acceptance test; the Kernel's is the round-trip check above.
- Refinement B: a detailed and an aggregate mechanism may coexist when one owner holds the state and the
  aggregation interface is documented. The registry marks such a pair (registry keeper, §10); the check script
  allows exactly those pairs to share an output.

## 10. Trace compaction (REAL-10)

`compact.ts`: a generic helper over an append-only list with running per-key sums: fold everything before a horizon
into the sums and drop it, keeping a cursor offset so `into`/`outOf` and any consumer's cursor stay right. Realism's
`Trace` already folds into running sums (2569) and `World.afterStep` keeps cursors; agreed with Reality: one
`Trace.compact(horizonT)` owned by realism (it may use the helper) that also moves World's conserved and element
cursors; crises and failed checks are never dropped; off by default (ADOPTION 2607). Required for the 1 s harness run.

## 11. Migration order (every step keeps every suite green)

| Stage | Steps | Touches | Green check |
|---|---|---|---|
| G (golden capture) | record engine outputs and the pirate benchmark before any engine is touched (2613, 2614) | `kernel/harness/golden/`, pirate `web/src/economy/golden*` (new files only) | the goldens compare equal to themselves |
| K (kernel only) | scaffold; ids + guards; rng; runner + transaction; time + scheduler + order; events; snapshot; units; ports; resolution; compaction helper; check script; no-engine-import check | `kernel/` only | kernel's own tests |
| A1 (pure re-exports) | settlement and economy import `mint` and the guards from the kernel; realism re-exports `rng` | each engine's `ids.ts`, `context.ts`, `process.ts` | each engine's full suite unchanged + pirate web |
| A2 (runners) | economy's and settlement's `Runner` become kernel subclasses; settlement gains replay (new test) | `reduce.ts` | full suites + new replay test |
| A3 (step hook) | realism `Scheduler.stepOnce` | `scheduler.ts` | full suite |
| A4 (declarations) | each engine's `kernel.json` | new data file per engine | check script passes on all three |
| H (harness) | golden compare after adoption (2615); 30-day run; replay and seed tests; the check script in the harness gate | `kernel/harness/` | P0 tests 1–3 |
| later (owners) | realism snapshot; trace compaction; per-process realism scheduling; realism RNG to streams; pirate `runDay` to the kernel | each owner's lane | owner's tests |

## 12. The owners' answers (recorded as they arrive)

Questions sent 2026-10-30 to Reality & Species, Settlement, Economy and the registry keeper.

| Owner | What they said today does | What would break | Objections / required acceptance tests | State |
|---|---|---|---|---|
| Settlement (2026-10-30, at bca54db) | `mint` as read; `counters` live inside the state; host ids (`pool.*`, `stl.*`, persons, fixtures, roles, recipes, economy's inv/mkt/ship/ord/org) never minted; `reduce` clones first; `Runner` has log and events, no replay; tick runs the seven steps in config order, writes `tickTrace`, then `day += 1`; everything per day, `hoursPerDay` only a divisor; providers mutate economy inventories mid-tick (`produce`, `take`); no RNG | Replay over **fresh** stub providers does not reproduce state: the stub stores are written outside the log and mutated by the tick. Replay needs the providers' own state rebuilt by their own replay (real adapter), or provider answers recorded (cheap harness) | **No objection to any of steps 1–6**, with conditions: (1) `mint` byte-identical, counters passed in and out, never global; pirate adapter T1 (bindings from replay order) stays green. (2) keep `finite(value, what, min)` and its messages; `Runner.replay` must call settlement's `reduce`; `run<T>` keeps returning the result (load.ts derives bindings from it); test **U15**: hamlet and A1 replayed against providers restored by their own replay, state and events deep-equal. (3) the kernel calls the tick exactly once per day, settlement before economy; **do not split TICK_ORDER into kernel processes** (seven steps share one Ctx; `tickTrace` lists all seven in one reduce); a skipped or doubled day must fail the assertion; I2 unchanged. (4) the transaction must cover `produce` in production and `take` in projects; test: a provider that throws in wages after `produce` leaves inventories equal to the pre-tick snapshot and settlement state unchanged. (5) no RNG now. (6) `file:` dep fine. Also: qualified refs must not parse the `inv.port.<place>` placeholders (DUP-44, until settlement's `inventoryOf(place)` hook); the event bus must not re-emit load-time seed events. Daily granularity enough; Q15's hours are a budget inside the daily step | **agreed**; conditions folded into units 2598, 2599, 2609 |
| Economy (2026-10-30) | no scheduler: one `{type:'tick'}` command runs `config.tickOrder`, `day += 1` at the end; `mint` with counters a `Partial` record keyed only when first minted; no RNG in the engine, the three-ports example or the adapter | (1) every tick step walks `Object.values` of markets, goods, inventories, shipments in insertion order and float sums depend on it: any re-keying or sorting changes bytes; (2) `replay(log, config, providers, from)` needs `from` (the adapter clears the log after loading the catalogue); (3) the log interleaves settlement's provider-issued `produce`/`take` in order: never batch or reorder them; (4) the transaction must also cover the pirate adapter's `Aliases` map, which mints economy inventories on first use (else dangling ids) | **No objection in principle to 1–6.** (1) counters stay lazily keyed; E3, I1, I2 byte-identical and the counters JSON identical. (2) `run()` returns the whole result (`minted`, `taken`); 25 tests unchanged. (3) tick takes no day by design: CONTRACTS §9's `tick(N)` means "the tick for day N"; rewording §9 needs a section agreed by both keepers; I2 under the kernel gives the same 30-day state as `runDay`. (4) transaction test: settlement throws mid-tick after a `produce`, both runners' states, logs, events and the alias table equal the pre-day snapshot, replay still matches (logged as ECON-11). (5) E14 and I2 unchanged with a stream present and unused. (6) a good's unit is an optional stored field, never converted; no test value changes. `runDay`'s check becomes the kernel's; `runDay` thins or goes. **DUP-44 is Settlement's** (`Project.account` used as inventory ref, `src/tick/projects.ts`); fix = a `Project.inventory` field and a CONTRACTS section from both; Economy prefers it **before** adoption so the byte-identity baseline is taken after it (K-O9) | **agreed**; folded into 2601, 2602, 2609; the Aliases part is the pirate adapter's (K-O10) |
| Reality & Species (2026-10-30, at fa85e66) | Scheduler as read; processes see `world.t` before the step's increment; `every > 1` users: control and thermometer 10, wear 60, the game's drink-to-deficit; day and hour boundaries are host code: seven exact float checks `(world.t + dt) % 86400 === 0`, `world.t === woundAtS`, which work only because `world.t` is an integer sum of integer dt; ids are host strings, library ids, substance and material ids; `rng` mulberry32 in closures (still, medicine, control and thermometer take a `rand`); Trace with running sums since 2569; World cursors private; Kahan carry in a private `WeakMap`; units SI by name, library headers carry units as text | snapshot to JSON: serialisable today except the Kahan carry, Trace's fold maps (recomputable), rng closures, host-process closures; byte-identical **mid-run** replay needs the carry; 30 days at 1 s is ~2.59 M steps, ~25 s compute for one body but ~7.8 M transfers in memory without compaction | **No objection** if: per step, insertion order with the `% every` rule and `dt * every`; `world.t` advanced after the processes and before `afterStep`; `afterStep` once per fast step; **`world.t` derived from the integer clock, never a float sum** (adopted, §2.2); order-as-data defaults to insertion order (adopted). Tests: horse-stable through the kernel byte-identical to direct `Scheduler.run`; human-wound at 1 s fires at exactly `woundAtS`; RNG 10^6 draws equal, still and medicine unchanged, streams from (runSeed, id) never call order; ids never rewritten in data or outputs; **P0 replay = restore initial + rerun** (adopted, §4.3), mid-run later (carry to a Map, rng state exposed: small, Reality's); compaction as one `Trace.compact(horizonT)` owned by realism that also moves World's cursors; a 30-day 1 s run with compaction has zero failed checks and the same daily ledger; the units table must list every header unit in `data/library/*.json` and `substances.json`; no kernel timestamps inside a step. Minimum world: `examples/horse-stable.ts` (stepS 60, ~4.4 s for 30 days); at 1 s compaction is required | **agreed**; folded into 2587, 2589, 2605–2611 (harness uses horse-stable at 1 s with compaction, plus the 60 s equivalence run). Follow-up: Reality accepted 2604–2608 and edited three in place: 2604 commits the lockfile and stops rather than editing the kernel if the pirate `tsc -b` flags fail (so the scaffold 2585 now sets `noUnusedLocals` and `noUnusedParameters`); 2606 adds one read-only `World.ledgerState()` accessor instead of public fields, carry left out (K-O11); 2607 names the two indexes a head-drop breaks (`Trace.fold` re-sums when `folded > transfers.length`: fold to the horizon, splice, then set `folded`; World's `cursor` and each `elements[i].cursor`: drop only what every cursor passed, right after `afterStep`, and subtract the count, in one World method); crises, checks and notes never dropped |
| Economy (2614, golden pirate benchmark; 2026-10-30) | — | the unit's "reuse its setup" contradicted "touch no other pirate file" (the I2 setup was private to a test file) | **yes to 2614**; Economy moved the I2 run into `web/src/economy/fixture.ts` (`thirtyDays()`, pirate ba7c0c1, byte-identical to the old loop, 388 web tests green); 2614 now calls it and captures `e.state`, `s.state`, the ledger, `e.log`, `e.events`, `rows`, at ba7c0c1 or later | **agreed**; unit edited |
| Registry keeper (2026-10-30) | ids `<engine>.<area>.<mechanism>`, stable from now; a Reality split changes only `owning_engine`; renames in `registry/aliases.json`; audit renames kept in `audit_id`, not aliased | — | Output ids: a separate `registry/quantities.json` (`<scope>.<quantity>`, unit from the kernel table, scope, one `writer`, description), not `<mechanism>#<output>` (that would make two owners impossible by construction); rows gain `writes`/`reads` (schema 2, `meta.schema_version`); the kernel's unit symbols become the only allowed vocabulary (`unitless` → `1`, `unknown` flagged); aggregation never shares a quantity: the aggregate row declares `aggregates: {of, by, interface, test}`; read `Toolchain/registry/mechanisms.json` (path fixed); check only kind mechanism + status built; pirate rows only if the plugin declares processes. It will create `aliases.json`, seed `quantities.json` once the units table exists, and add schema-2 fields | **agreed**; §8 rewritten; field names sent back; 2596 and the three declaration units read `quantities.json` |

## 14. Verification and validation (Rex, 2026-10-30; PLATFORM.md §11a)

- **(Rex)** The registry gains per-mechanism implemented / integrated / validated states and a validation record
  (the registry keeper adds the fields). **After P0**, a later unit extends the check script (2596): mechanisms that
  are wired (ports declared in a `kernel.json`) but not marked integrated, and connected pairs (one's output read by
  another) with no named integration test, are reported as **warnings, never failures**. Not queued until the fields
  exist and P0 has passed (2612); the running lane is unchanged.
- The Kernel's own evidence: verification tests per service (scheduler order and perf, events, replay and
  transactions, RNG streams against realism's generator, units parsing and conversion, ports, resolution round-trip,
  compaction, the check script's fixtures, the import fence), and as validation the no-silent-change goldens
  (2613, 2614, checked by every adoption Gate and by 2615).

## 13. Open items

| Id | Item | Whose |
|---|---|---|
| K-O1 | Year length for aggregate steps; calendar and epoch | **(Rex, 2026-10-30)** deferred to Catalogue / History; the kernel offers period constants only |
| K-O2 | ms as the tick unit | **(Rex, 2026-10-30)** ms |
| K-O3 | `money` and `count` as base dimensions; a good's unit | **(Rex, 2026-10-30)** `money` and `count` are base dimensions; a good's unit stays Economy's |
| K-O4 | the output-id vocabulary for the check script | registry keeper |
| K-O5 | where the harness lives | **(Rex, 2026-10-30)** `kernel/harness/`, its own package.json, the only importer of engines |
| K-O6 | `--continue-on-fail` would fail every kernel unit (they need the approval marker, absent until Rex approves) | controller: never run the kernel lane with that flag |
| K-O7 | realism World snapshot: feasibility, Kahan carry | Reality |
| K-O9 | DUP-44 (`Project.account` as inventory ref) before adoption | **resolved 2026-10-30**: Settlement fixed it in efc72cf (`Project.inventory`, CONTRACTS §15 agreed with Economy, U16; 27 tests, pirate web 388 (387 until fc83089)). Golden baselines are taken at settlement efc72cf or later |
| K-O10 | when the pirate adapter moves to the kernel, its transaction must also snapshot the economy `Aliases` map (ECON-11) | pirate adapter owners, later |
| K-O11 | mid-run realism snapshot and restore (Kahan carry to a serialisable Map, rng state exposed) | Reality, when first needed |
| K-O12 | `quantities.json` (317 seeds), `aliases.json` and schema 2 exist (registry keeper, 2026-10-30); when unit 2592 lands, send it `kernel/data/units.json` to replace its provisional unit symbols. Seeds with `writer: null` (17, REG-16) are left out of declarations and reported; units are checked only on quantities a declaration uses | registry keeper; unblocked |
| K-O8 | engines depend on the kernel as `"@rex/kernel": "file:../kernel"`; the pirate web must add `Toolchain/kernel` to vite `fs.allow` | pirate keepers, before realism/settlement/economy adoption reaches the web |
