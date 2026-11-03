# Kernel: PLAN.md (Kernel keeper, 2026-11-02; draft in HQ, never committed)

Consolidates `Toolchain/kernel/DESIGN.md` (§0–§17) and `ADOPTION.md` per `HQ/handoffs/PLAN-SPEC.md`. Issues: `ISSUES.md` (KRN-).
Code cited at kernel HEAD ad56e63; `K/` = `Toolchain/kernel/`, `H/` = `K/harness/`.

## Pass 1 (one page)

**The kernel owns no science** (Rex, 2026-10-30). It owns time, order, ids, units, RNG streams, snapshots and replay,
transactions, `transfer()`, the registry check and the harness. Every number in a world comes from an engine.

**Mechanisms present (built and tested, 149 kernel tests):** integer-ms clock (`K/src/time.ts`); multi-period scheduler
with declared phase order and the interval-closing rule (`scheduler.ts`, `order.ts`); pull-based event bus with cause ids
and snapshot/restore (`events.ts`); `mint`/qualified ids (`ids.ts`); guards; mulberry32 streams per mechanism and per
entity (`rng.ts`); reducer runner with replay (`runner.ts`); `canonical`/FNV snapshots, header v2 (`snapshot.ts`);
`transaction()` (`transaction.ts`); `transfer()` + `TransferJournal` (`transfer.ts`); units table and parser
(`units.ts`, `data/units.json`); ports (`ports.ts`); resolution hand-off (`resolution.ts`); trace and compaction
(`trace.ts`, `compact.ts`); `scripts/check-registry.ts` (writers, units, ports, provider `call` ports, warnings, event
contracts). Harness: equivalence, 30-day, replay, registry, units, goldens (`H/*.test.ts`, `H/golden/`).

**Missing or defective (each labelled):**
- **Confirmed** KRN-41: `TransferJournal.balance()` adds `amount` to both debits and credits (`transfer.ts:57-58`), so
  it can never report an imbalance. Reproduction: any journal; `debits === credits` always. It is not a balance check.
- **Confirmed** KRN-42: engines throw their `transfer()` records away: one new journal per call
  (`settlement/src/context.ts:92,131`; `economy/src/providers.ts:124,158`, `commands.ts:338,356`, `tick/index.ts:125`).
  No run-wide record exists to reconcile against.
- **Confirmed** KRN-43 (audit): `H/thirty-days.ts:18-65` joins three unrelated examples: horse stable, a hamlet whose day
  counter is rebased (`:65`), and three-ports driven by a `StubLedger` and its own scripted daily commands (`:38-43`). It
  proves scheduling, replay and bookkeeping, not one world: no shared population, no shared stock.
- **Confirmed** KRN-44: the harness still links engines by `file:` (`H/package.json:20-22`), against DESIGN §16.
- **Missing:** a reconciler (balance check at sync points, §3 below); a run-scoped journal handed to every engine; a
  declared boundary-account vocabulary (sources, sinks, transformations); snapshot `versions` (DESIGN §16); mid-run
  realism restore (K-O11, Reality's half); a one-world fixture.

**Quantities owned:** `T` (ms, integer, 0 ≤ T ≤ 2^53), event counter, RNG stream states, the run journal (records, not
balances), snapshot header. No physical, biological or economic quantity.

**External inputs:** run seed; epoch label and catalogue hash (host/Catalogue); `order.json`; each engine's
`kernel.json`; registry `mechanisms.json`, `quantities.json`, `aliases.json`, `events.json`; host input log.

**Outputs:** `T`, `dt` per process; ordered events; stream draws; transaction outcome (commit or full restore); journal
entries; snapshots and canonical hashes; check-script and reconciler reports.

**Contribution to M1a:** the run itself. One clock runs Life (body), Cognition (decision), the resolver (host phase),
Economy/Settlement (stock) at their own periods; the eat flow is one `transfer()` from an Economy inventory to Life's
gut account inside one transaction; the reconciler proves the inventory fell once and the body received once; replay and
seeds make the paired provisioned/deprived runs reproducible; the same world runs again at a different fast step.

**Flagged assumptions / open:** KRN-45 (risk): Economy counts food in units, Life in kg; `transfer()` refuses mixed
units and never converts, so a declared mass per good (Economy's, UNIT-12) must exist before the eat transfer. KRN-46: eat resolution
is History-specified and kernel-built in the harness (DC-13, §3.11); "within reach" stays with the location owner.

**5069 settled (KRN-48):** Settlement is right. The work landed (settlement 4a9d127); the gate failed only on harness
goldens stale since settlement 7e49d3c (`postFilled`), re-recorded by 5092 (kernel d62287a); 5093 re-ran 5069's exact
gate and passed (d57d0a3). The kernel's "failed" entry was stale. **Settlement closes it** (moves the file with
`--recheck` when the belt resumes); the kernel drops it from its list. The throwaway journal in that same code is KRN-42,
paired kernel + Settlement + Economy work in this plan.

**Next dependency-ready task (after Rex approves):** K1, run-scoped journal + honest `balance()` + reconciler in the
kernel only (no engine touched), then the M1a harness skeleton against stub participants that pass the reconciler.

---

## Pass 2: the full plan

**Consolidation.** This file is the kernel's one plan. `DESIGN.md` stays as the reference for reasoning and for the
owners' agreed conditions (§12); `ADOPTION.md` stays as the historical record of P0 adoption and golden re-records.

| Source | Status here |
|---|---|
| DESIGN §0 fence, §2 time/scheduling, §2.3 events, §3 ids, §4 reducer/replay/snapshots, §5 RNG, §6 transactions, §7 units/ports, §8 check script, §9 resolution, §10 trace/compaction, §16 releases | carried (§3 below), unchanged unless stated |
| DESIGN §12 owners' conditions (settlement tick never split into kernel processes; economy insertion order never re-keyed; no kernel timestamps inside a realism step; `world.t` set from the clock) | carried as standing constraints (§3.1, §3.6) |
| DESIGN §15 coupled updates (Lie splitting; Strang, sub-stepping, sensitivity, scale selection open) | carried; first-order splitting gets a numerical check (§7 V-6) |
| DESIGN §16 "the harness depends on the engines at their release tags" | **gap** KRN-44 (`H/package.json:20-22`) |
| DESIGN §17 "per quantity per instant debits equal credits (`test/transfer.test.ts`)" | **superseded**: passes by construction (KRN-41); replaced by the reconciler (§3.5) |
| DESIGN §1 inventory, §11 migration table, ADOPTION per-package edits | historical (P0 closed 2026-10-31) |
| `H/thirty-days.ts` as the platform acceptance run | **superseded** as acceptance by M1a (§3.11); kept as the P0 regression run (PLATFORM §10) |

### §1 Purpose and boundaries

The kernel determines **when** each process runs, **in what order**, **what it may see** (events, ports), **whether a
group of changes commits or rolls back**, **that every transfer has two equal legs and is recorded once**, **whether the
engines' holdings agree with those records**, and **that a run repeats exactly**. It receives declarations (processes,
ports, streams, boundary accounts), state readers from the engines, the registry vocabularies, the run seed and the
host's external inputs. It never calculates a physical, biological, cognitive, economic or social quantity, a rate, a
requirement, a refusal policy (debt, capacity, reach), a tolerance for an owner's quantity, a calendar or an outcome. The
harness composes engines and may hold **fixture values supplied by owners**, never a rule.

### §2 State (everything the kernel owns)

| Quantity | Unit | Range | Meaning | Kind |
|---|---|---|---|---|
| `T` | ms, integer | 0 … 2^53−1 | simulation time since the run epoch | invariant: monotone safe integer |
| per process `last` | ms | ≤ `T` | last run; `dt = T − last` | invariant: `dt = period` after the first run |
| event counter / sequence | count | ≥ 0, +1 per event | `evt.NNNNNN`; total order `(t, phase, position, seq)` | invariant: dense, never reused |
| stream states | uint32 per `<mechanism>[@<entity>]` | 0 … 2^32−1 | mulberry32 state | invariant: replayable |
| run journal | records | append-only | every `transfer()` entry of the run | **record, not a balance**; owns no quantity |
| reconciler cursor | number per ledger×quantity, journal index | — | engine totals read at the previous sync | derived; never written back; recomputed on restore |
| snapshot header v2 (+ `versions`, planned) | — | — | t, epoch label, catalogue hash, seed, event counter, rng, resolved commits | record |
| order data, check and reconciler reports | — | — | declared phase order; outputs | data |

### §3 Mechanisms (each a calculation chain)

**3.1 Clock and scheduler** (`scheduler.ts`, `order.ts`, `time.ts`). Adapters register `{id, mechanisms, period, offset,
phase}` → `T_next = min` over period buckets → every due process runs in (phase index, position in `order.json`) → each
gets `{t, dt, rng, emit}` → it changes its own engine. A process due at `T` closes the interval ending at `T`.
Assumptions: integer-ms fixed periods (no adaptive steps); sequential splitting, first order (DESIGN §15). Stops
applying: sub-ms processes; a mechanism stiffer than its period (the owner sub-steps); couplings needing Strang order or
in-instant iteration (open, Reality). Failure: a throwing callback fails the scheduler and ends the run, never retried
(`scheduler.ts` `runUntil` catch), because host state may already have changed.

*Engines with different time steps (rules; into DESIGN as §2.5 on approval):*
1. **Stocks are read as last finished:** a slow process reads what the last finished faster process left at or before `T`.
2. **Rates are integrated by their producer** over its own `dt`; no consumer re-integrates another engine's rate.
3. **Flows over a consumer's interval come from the run journal** (`journal.since(cursor)`), never a sum the consumer keeps.
4. **A decision's effect appears at the next instant:** an intention emitted at `T` resolves in a later phase at `T`;
   faster processes see the result at their next run. Two-way coupling lags one step in the declared direction.
5. **Periods need not divide each other** (the heap handles any set); reconciliation needs only instant ends (§3.5).

**3.2 Events** (`events.ts`). Emit → id and order → readers pull `since(cursor, reader)`; nothing earlier in the order at
the same `T` sees it; `cause` recorded, never inferred. Change: **the bus is a participant in every cross-engine
transaction**, so events emitted inside a failed one vanish (today adapters publish after commit, `H/adapters.ts`
`publish`; the resolver envelope of §3.11 includes the bus).

**3.3 Transactions** (`transaction.ts`). Detached snapshots → `fn` → on throw restore all, rethrow. Synchronous, one
instant; restore never throws; a transaction never spans instants. A multi-instant action (walking M1b, work M2) is an
owner's state machine whose every step commits or rolls back on its own. **Risk** KRN-49: runner snapshots
`structuredClone` the whole engine state; one transaction per meal at a 1 s step may cost more than the step. K2
measures it and, if needed, lets participants snapshot only the accounts and cursors a transaction can touch.

**3.4 `transfer()` and the run journal** (`transfer.ts`). Request `{t, process, quantity, unit, amount > 0, from, to,
note, cause?}` → both endpoints hold the same unit symbol (no conversion, ever) → owner's `apply(−q)`, `apply(+q)` (the
owner refuses by throwing: debt, capacity) → entry appended → the batch is atomic. Changes (K1):
- **One journal per run**, created by the host and passed to every engine (constructor or ctx); a throwaway journal only
  in an engine's own unit tests (fixes KRN-42 with Settlement, Economy, Reality soils, Society).
- Entry gains `cause` (intention or event id), so "the body received once" traces to one decision.
- `since(cursor)`, `length`; `balance()` replaced by signed per-account `net(account, quantity)` (fixes KRN-41).
- **Boundary accounts.** Flows that cross the declared system boundary or change form (production, metabolism, spoilage,
  outside credit/debit, decomposition) go to or from accounts the owner declares in `kernel.json`:
  `boundaries: [{ ledger, account, quantity, kind: source | sink | transform }]`. A transformation is two transfers
  through a transform account, both posted by the owner; the kernel checks only that each leg balances.

*Who debits, who credits (PLATFORM §7a), for flows the kernel carries:*

| Flow | Debit (owner) | Credit (owner) | Through |
|---|---|---|---|
| M1a eat | Economy inventory (food mass) | Life body gut account | one `transfer()` in the resolver transaction |
| wages, rent, sales | Settlement money (payer) | Settlement money (payee) | `pay()` → `transfer()` (5069, landed) |
| goods moves, shipments | Economy goods | Economy goods | economy 5068 (landed) |
| money and goods together | Settlement money / Economy goods | same | one batch: done (settlement CONTRACTS §20, 898243b, U26) |
| soil nutrients | Reality soils `NutrientLedger` | uptake account | `realism/src/soils.ts` (journal to become run-scoped) |
| digestion, metabolism | Life | Life transform/sink accounts | Life's ledger, declared boundaries |

**3.5 The reconciler (PLAN-SPEC §3; new, K1).** Inputs: each conserving ledger's read-only `holdings(quantity) →
Map<account, amount>` over **its own engine state** (optional `TransferLedger` method; the kernel keeps no copy); the
journal window since the last sync; the declared boundary accounts. At sync *k*, **per account** *a* (every
non-boundary account of every reconciled ledger) and quantity *q*:

```
ΔH(a,q)  = holdings_k(a) − holdings_{k−1}(a)
J(a,q)   = Σ entries in (k−1, k] credited to a − Σ entries debited from a
residual = ΔH − J;  pass iff |residual| ≤ tol(q) · max(1, |holdings_k(a)|)
```

Per account, not per ledger: an unrecorded equal-and-opposite change inside one ledger (+x on one account, −x on
another) leaves the ledger total unchanged and would pass a ledger-level check; per account it fails twice (Rex's
review, 2026-11-02). Ledger and system totals are cross-checks only. Neumaier-compensated sums. `tol(q)` from the
quantity's registry row (the owner's); no row → exact. Also: every entry's endpoints are declared accounts. Output rows
`{T, ledger, account, quantity, ΔH, J, residual}`; in the harness a failure throws at the sync point, in long runs it may report only. **Sync
points:** a read-only process `kernel.reconcile` in a final `check` phase of `order.json`, at a declared period (every
fast step in tests, hourly or daily in long runs), optionally after every transaction in debug mode. Valid at any instant
end because transfers are atomic and producers post boundary flows on every step that changes holdings (rule 2). Not
reconciled: non-conserved quantities (prices, beliefs, fatigue, counts without declared sources and sinks); their owners
keep invariants. **A reconciled ledger routes every account change through `transfer()` or a declared boundary**; a
ledger whose engine still moves amounts between its own accounts by hand (realism's Trace-audited flows today) is reported
"unreconciled" by name, never passed silently, until its owner migrates it.
**View entries (EN-4 review, 2026-11-02, KRN-50).** One physical stock is reconciled under one key: its native
(ledger, account, quantity), e.g. Economy's count of a good. An entry written through an owner's view in another
quantity and unit (the eat entry: quantity = Life food id, kg) is mapped to that key by the owner's ledger method
`native(account, quantity, amount) → {account, quantity, amount}`; the kernel only sums what it returns and never
converts. Without it, a purchase (count) and a meal (kg) on the same stock each show as an unrecorded change in the
other key. Valid while the factor is fixed for the good (EN-2: a change of condition is a transformation into another
good, never an edit of w), so replay and reconcile-time mapping agree. A view entry whose ledger has no `native()`
fails the reconciler (a runtime fact; the check script only sees declarations).
**No second ledger:** the kernel holds only the previous sync's totals, read from engine state.

**3.6 Replay and snapshots** (`snapshot.ts`, `runner.ts`, DESIGN §4). Initial snapshot + seed + kernel input log (external
inputs at their `T`) → rerun → `canonical` equality of the kernel block and every engine part. Provider-issued commands
regenerate (§4.2). Additions: `versions` in the header (DESIGN §16, paired per KRN-31); the input log carries **external
series** (M3 weather) as timed inputs. Mid-run restore waits on Reality's K-O11; until then replay = from the initial state.

**3.7 RNG streams** (`rng.ts`): unchanged.

**3.8 Ids and one population.** Qualified ids at the boundary (DESIGN §3). The kernel does not own person identity
(Society or Life, per the registry map). It supplies `checkIdentity`: at each sync every engine's entity set of a shared
kind equals the run's population list.

**3.9 Units, ports, check script** (DESIGN §7, §8, §8.1, §14, §17): unchanged, plus validation of `boundaries` (ledger
exists, quantity row exists, unit parses).

**3.10 Resolution hand-off** (DESIGN §9): unchanged; first user History P10.

**3.11 The harness.** Two runs, both kept:
- **P0 regression** (`H/thirty-days.ts`, as today): scheduling, replay and bookkeeping over three unrelated examples.
  Not a world, never cited as one.
- **M1a one world** (`H/m1a/`, new). One fixture: one population list (≥ 2 persons, so decisions compete for one stock),
  one food stock in one Economy inventory at one place, adjacency from the location owner (KRN-46). Values come from the
  Life, Economy and Settlement keepers with their labels; the kernel writes none. **Resolution (DC-13, registry
  2026-11-02; HIST-16 amends REG-39, controller-accepted):** Kernel and the action owners own the eat, take, gather and
  move resolvers' behaviour; History states evidence only (its §3.11, E1–E8). The harness resolver is the **only** emitter
  of `shared.action.outcome`, under one declared source id, **`kernel.harness.resolver`**, on every outcome; nothing
  from that source is a crisis or death event. An intention may span several committed steps (HIST-15), each its own
  transaction, each cause-linked to the intention, ending in exactly one terminal outcome. A failure restores only the
  rolled-back transaction: an interrupted activity keeps the progress and expenditure its earlier steps committed. A
  single-step eat is one transaction, one `transfer()`, one outcome after commit (completed) or rollback (failed, reason
  in the stimuli; zero journal entries from that step); cause = intention id. **Unknown food is a configuration
  failure** (the harness load check stops the run; never an `impossible` outcome). Engine commands called inside it tag records with `cause` and emit no outcome. `body.crisis` and
  `body.death` are Life's events; the resolver never emits them. **Technical failure settles too (Rex, 2026-11-02, M1a-20):** a rollback
  or harness fault either retries explicitly (same intention id, exactly one later outcome) or emits exactly one outcome
  `{status: failed, reason: technical}`; a cancel with no outcome is invalid. The true cause goes only in a diagnostic
  field for History, never in the stimuli. Agreed text (registry INTEGRATION-PLAN M1a-17, M1a-20,
  M1a-25): statuses **impossible** (decided before any transaction from Life's precondition read; no transfer; not for unknown food),
  **failed** (rollback or owner refusal; zero entries; effort still spent once through Life's MET path), **completed**
  (q = min(terms kg, available kg, gastric room; the harness load check refuses an undeclared gastric capacity, INTEGRATION-PLAN rev 3), the rule History specifies and owners'
  values feed; the kernel computes none of them). Engine commands inside it carry `resolvedBy: 'host'`. The one
  `transfer()` is in kg, written by Economy from its kg goods view to Life's `life.gut` ledger passed beside the command
  (CONTRACTS §20 pattern); the resolver reads Economy's refused event and `takenKg`, and Life's stimuli, as records.
  **Death (NP-11, controller 2026-11-02; M1a-25):** with no game host, the harness declares death exactly when Life's
  terminal criterion (LIFE-25) is met and adds no rule; while that criterion is unsourced the deprived arm records
  "terminal state reached". The resolver emits neither `body.crisis` nor `body.death`. Processes: `life.body.step` (fast,
  Life's period), `cognition.minds` (Cognition's period), the eat resolver (host phase, History-specified, DC-13),
  `settlement.tick` and `economy.tick` (daily), `kernel.reconcile` (check). Chain: Life's hunger signal (port) →
  Cognition emits `cognition.intention {mind, action: eat, target}` → resolver transaction over [bus, economy, Life
  ledger, journal]: owners' refusals (stock, ingestion capacity) → one `transfer()` with `cause` = intention id →
  `shared.action.outcome` with the same cause → Life digests on its next step → Cognition reads the changed signal at its
  next instant. Configurations **provisioned** and **deprived**, seeds {1, 2, 3}, each replayed, each also at a second
  fast step (1 s and 60 s). Outcomes (Life's reserve states to incapacity or death, meals, timing) recorded side by side,
  never tuned, never asserted to a wanted value.

**3.12 Time reservations (NP-17 / SET-50, INTEGRATION-PLAN M2-14, controller 2026-11-02; M2, not M1a; KRN-51).**
One generic ledger per actor beside `transfer()`. State: per actor, reservations `{id, cause, start, end, share,
status: reserved | fulfilled | released}` on integer-ms SimTime, plus the actor's bound series supplied as input.
Operations: `reserve(actor, [start, end), share, cause)`, `release(id, at)`, `fulfil(id, at)`. Rules (kernel's, no domain
formula): intervals are half-open; `start ≥ T` (nothing is reserved in the past); release and fulfil act only on
`[max(at, T), end)`: the part before T is elapsed and is never restored or released, it is recorded as fulfilled or
lapsed. Overlap is allowed within the bound: a reservation is admitted iff Σ shares of active reservations ≤ B_p(t) at every
instant of the interval (IT-M2-1), else refused with nothing changed. The bound is the owners' (Life: bodily;
Cognition: intended participation); the kernel checks it and never sets one. **Unknown ≠ zero ≠ unlimited (RC-10):**
a missing bound refuses the reservation and names the missing bound; only an explicitly declared `unbounded` fixture
admits shares. The ledger is a transaction
participant: a reservation made inside a transaction that rolls back is restored away (rollback happens at one
instant, so no time elapses inside it). Records carry `cause` and go to the trace; replay reproduces them. Not
reconciled by §3.5 (time is not a conserved stock); its invariants are the checks above. Consumers: Settlement and the
host resolvers.

**3.13 Ownership enforcement (RC-12, RG-1; INTEGRATION-PLAN §2e; KRN-53).** The guard keys on the owner's write
interface, never on which engine asked. Per kind of state:
- *Ledger accounts:* only through the owner's `TransferLedger.apply` inside `transfer()`; any other change shows as a
  per-account residual at the next sync (§3.5).
- *Port state* (hunger and satiety signals, any declared output): `PortTable.write` today takes no writer, so anyone
  holding the table can write (defect). K1 changes it to `write(writer, outputId, value)`, throwing unless `writer` is
  the output's declared mechanism; when run under the scheduler, the writer must also equal the running process id,
  so the id cannot simply be passed in by another engine. Statically, `check-registry` keeps one writer per quantity.
- *Owner-internal state not on a port or ledger* (position, unless its owner declares it a port output): guarded by the
  owner's own write interface and the static one-writer rule; the kernel has no runtime guard for it and says so. An
  owner that wants runtime enforcement publishes it as a port output.

### §4 Inputs and outputs

| Quantity | Producer → consumer | Unit / range | Timing | Failure and rollback |
|---|---|---|---|---|
| process declarations | adapter → scheduler | ms periods > 0 | registration, between `runUntil` calls | invalid → throw at registration |
| `T`, `dt` | scheduler → processes | ms, safe integer | each due instant | — |
| events | process → bus → readers | `KernelEvent` + cause | emit order; visible later in order | inside a failed transaction: dropped |
| stream draws | rng → process | [0, 1) | on demand, declared mechanism only | undeclared → throw |
| transfer request | engine / resolver → `transfer()` | owner's unit, amount > 0 | inside an instant | any leg throws → batch and all participants restored |
| journal entries | `transfer()` → reconciler, slow consumers | records | append; read by cursor | restored with the transaction |
| holdings readers | conserving ledger → reconciler | owner's unit | each sync | missing → ledger reported unreconciled |
| boundary declarations | `kernel.json` → check script, reconciler | — | load | undeclared account → check failure |
| reconciler report | reconciler → harness, keepers | residual, owner's unit | each sync | over tolerance → throw (harness) or report |
| snapshots, input log | kernel + participants → replay | canonical JSON | start; inputs at `T` | non-JSON or NaN → throw |
| check-script report | registry + `kernel.json` → gates | text, exit code | gate time | exit 1 on failure; warnings never fail |

### §5 Evidence

| Item | Source | Label |
|---|---|---|
| `DAY = 86 400 000 ms` | SI day of 86 400 s | measured (definition) |
| `TROPICAL_YEAR = 365.24219 d` | IERS / Astronomical Almanac mean tropical year (DESIGN §2.1) | measured; use deferred to Catalogue/History (K-O1) |
| kcal = 4184 J, atm = 101 325 Pa, units table | NIST SP 811 (B.8) | measured (definitions) |
| mulberry32 | public-domain generator, byte-identical to realism's | assumption: adequate for simulation, not cryptographic; period 2^32 per stream |
| FNV-1a 32/64, murmur3 finaliser | published hash specifications | established algorithms; labels and seeds only |
| Neumaier compensated summation | Neumaier (1974) | established numerical method |
| sequential (Lie) splitting is first order | standard operator-splitting analysis | established; per-coupling accuracy is Reality's |
| interval-closing order, two logs, transaction semantics, one transfer per flow | Rex's rules (PLATFORM §7a, §11; DESIGN §2.2, §4.2) | design rules, tested as algorithms |
| reconciler tolerances | each quantity's registry row | owner's; kernel default exact |

### §6 Status (designed · implemented · connected · numerically checked · empirically validated)

Empirical validation does not apply to bookkeeping (n/a); the kernel's evidence is verification (§7).

| Mechanism | Des. | Impl. | Connected | Checked | Valid. |
|---|---|---|---|---|---|
| clock, scheduler, order | yes | yes | realism, settlement, economy, cognition bench | yes (P-perf, 30 d at 1 s) | n/a |
| multi-step rules (§3.1 1–5) | this plan | 1, 2, 4 by construction; 3 no | — | no | n/a |
| events, causes | yes | yes | settlement, economy, cognition | yes | n/a |
| ids, guards, runner | yes | yes | settlement, economy | yes (goldens) | n/a |
| RNG streams | yes | yes | cognition (per entity) | yes | n/a |
| transactions | yes | yes | harness settlement + economy tick | yes (rollback tests) | n/a |
| `transfer()` | yes | yes | settlement 5069, economy 5068, realism soils, society | per call | n/a |
| run journal, `cause`, `since` | this plan | no | no (KRN-42) | no | n/a |
| `balance()` | yes | **defective** (KRN-41) | — | vacuous | n/a |
| reconciler, boundary accounts | this plan | no | no | no | n/a |
| replay from initial state | yes | yes | harness | yes (30 d) | n/a |
| mid-run restore | yes | kernel side | realism no (K-O11) | no | n/a |
| snapshot `versions` | yes (§16) | no | no | no | n/a |
| units, ports, check script | yes | yes | every `kernel.json` engine | yes | n/a |
| resolution hand-off | yes | yes | none yet | yes (round trip) | n/a |
| trace, compaction | yes | yes | realism | yes (30 d, zero failed checks) | n/a |
| harness P0 regression | yes | yes | three examples | yes | n/a |
| harness M1a one world | this plan | no | no | no | no |

### §7 Validation

- **V-1 scheduler:** order equals the declared order for any registration order; 2.6 M instants with three periods
  under 2 s (no-op processes); `dt = period` after the first run. Exact.
- **V-2 replay:** same seed and inputs → canonical-equal snapshots; a second seed changes only stochastic descendants.
- **V-3 transactions:** after a throw anywhere, every participant's canonical snapshot equals the pre-transaction one and
  the bus holds no new events. Exact.
- **V-4 transfer:** Δsource = −q and Δdestination = +q exactly per entry; a mixed-unit request throws.
- **V-5 reconciler (mutation tests, kernel only):** clean run → every residual within tolerance; each injected defect is
  detected with residual equal to the defect: a hand-edited balance, a dropped entry, a doubled credit (food received
  twice), an undeclared account, a production change with no boundary entry. A test that cannot fail is no test (KRN-41).
- **V-6 splitting order (numerical; fixture only):** a two-reservoir linear exchange with a closed-form solution, split
  across two processes; global error halves with the step (ratio 2 ± 0.2 over three halvings). Constants are arbitrary
  test numbers, labelled, never world values.
- **V-7 M1a:** per eat intention exactly one outcome event; per successful outcome exactly one journal entry with that
  cause; inventory falls and gut gains by Σ entries; every residual within tolerance; **Life's signal reaches and affects
  Cognition's evaluation through the specified mapping** (traced by cause ids; no direction or immediacy is asserted:
  there is no rule that eating lowers the next evaluation, HIST-16; the chosen action need not change, other needs may
  still win; Rex's review wording, 2026-11-02); every outcome carries source `kernel.harness.resolver`; a multi-step
  intention has one terminal outcome and its earlier committed steps survive a later step's rollback; identity sets
  equal the population list at every sync; each configuration × seed replays canonical-equal; the 60 s run passes every
  conservation and identity check, and its differences from the 1 s run are reported against owners' tolerances
  (KRN-47), never tuned away.

### §7a Kernel test lanes (review procedure, Rex 2026-11-02)

Each lane gives the seven items: **Question · Boundary · Model · Evidence · Functional tests · Realism tests ·
Connection test** (with units). What these lanes accept is **accounting and execution correctness, not physiological
realism**. The kernel's realism item is therefore "none applies" in every lane, stated rather than left blank. Fixtures
are labelled test doubles (in-memory ledgers, no-op processes, arbitrary numbers) that exercise the interface only. No
stub passes any engine's realism test, and none appears in a demonstration claimed as a world. Component tests check
what only the kernel can see; the pair tests listed under Connection belong to the owners' paired units (K4, K5). Where
both check the same invariant at different scopes, both are kept.

**L1 Atomic transfer** (K1; `transfer.ts`)
- *Question:* does one request make exactly one debit, one credit and one authoritative record, equal in magnitude, in the declared unit?
- *Boundary:* `transfer()`, two fixture ledgers that record the deltas they receive, one run journal. Supplied: amount, unit, accounts, cause. Excluded: any owner refusal policy beyond "throw".
- *Model:* source receives −q and destination +q; journal +1 entry `{t, process, quantity, unit, amount: q, from, to, cause}`; a batch of n requests applies all of them or none. Same unit symbol at both ends; no conversion.
- *Evidence:* PLATFORM §7a (Rex's rule, one transfer per physical flow); double-entry bookkeeping. A rule, not an equation.
- *Functional:* q = 2.5 from A = 10 to B = 0 gives A 7.5, B 2.5 and one entry. The deltas each ledger *received* equal −q and +q bit for bit, also for q = 0.1 (not exactly representable; never recomputed by subtraction). A batch of 3 gives 3 entries. Each invalid input leaves ledgers and journal canonical-equal to before, with the error named: q ≤ 0, NaN, ∞, same endpoint, unknown account, `kg` vs `g`.
- *Realism:* none applies.
- *Connection:* Economy inventory (kg view) → Life `life.gut` (kg), one entry carrying the intention id (DC-13; Economy + Life pair test in K5). Settlement money → Settlement money (`money`), already on `transfer()` (5069).

**L2 Rollback** (K1; `transaction.ts`)
- *Question:* after a failure anywhere inside a transaction, are participants, journal and bus exactly as before, while a separately committed transaction survives?
- *Boundary:* `transaction()` over fixture ledgers, the journal and the bus. Failures injected before the first leg, between legs, after the journal append, in the second request of a batch, and in a later step of `fn`. A restore that throws violates the contract; the test checks only that the original error still propagates.
- *Model:* on a throw, every participant's canonical snapshot equals its pre-transaction snapshot; on success, the change is kept. A transaction T1 committed before T2 fails stays committed. **The kernel never creates an expenditure because a transaction failed.** Whether effort was spent, and how much, is Life's to compute and commit in its own step (DC-13 "failed: effort spent once through Life's MET path").
- *Evidence:* DESIGN §6; DC-13 status rules. A rule.
- *Functional:* canonical equality at each injection point; no new bus events; the outcome emitted after rollback appears exactly once. An injected harness fault yields one `failed`/`technical` outcome (diagnostic field set, stimuli free of the cause) or one retry with the same intention id and one later outcome; an intention with no outcome fails the test. Fixture: T1 (an "effort" ledger, committed) then T2 (food, fails): the journal holds T1's entries only, the food ledgers are unchanged, the effort ledger keeps T1. A nested transaction that throws and is caught by the outer one: the inner participants are restored and the outer continues.
- *Realism:* none applies.
- *Connection:* the M1a resolver over [bus, Economy, Life gut ledger, journal]. IT-M1a-3: a failure injected between the inventory debit and the gut credit leaves neither leg. Pair test: a failed eat leaves inventory and gut unchanged, zero food entries, Life's own expenditure record present once (K5).

**L3 Account reconciliation** (K1; §3.5)
- *Question:* does every change in every reconciled account equal the journal flows into and out of it between two sync points?
- *Boundary:* the reconciler over fixture ledgers that expose `holdings()`, the run journal and declared sync points. A ledger that cannot route every change through `transfer()` is reported as unreconciled and never passed.
- *Model:* §3.5 per-account residual with tolerance `tol(q) · max(1, |H|)`, Neumaier sums; ledger and system totals as cross-checks.
- *Evidence:* Rex's rule (PLAN-SPEC §3: reconcile from engine state and `transfer()` records, no second ledger); Neumaier (1974).
- *Functional (mutation, each must fail where stated):* a clean run gives every residual 0. Unrecorded +x on one account fails with residual x. **An unrecorded equal-and-opposite change within one ledger fails on both accounts.** The same across two ledgers fails on both. A purchase in count and a meal through the kg view on one stock reconcile to zero via `native()`; the same meal with `native()` removed fails. A dropped journal entry gives two residuals; a doubled credit gives one residual of q. An entry naming an undeclared account fails. A residual exactly at tolerance passes and the next float above fails. A NaN holding fails.
- *Realism:* none applies.
- *Connection:* the owners add `holdings()` to Settlement money (`money`), Economy goods (count, with `native()` for kg view entries, KRN-45, KRN-50) and Life gut (kg). The pair test is P0 regression plus M1a with zero residuals (K4, K5).

**L4 Boundary and transformation records** (K1; §3.4 boundaries, check script)
- *Question:* are flows into the system, out of it and between forms recorded as declared boundary entries, with no conversion computed by the kernel?
- *Boundary:* `kernel.json` `boundaries`, the check script and the reconciler. The owner supplies every amount on both sides of a transformation.
- *Model:* a source account may only be debited, a sink only credited. A transformation is the owner's batch of entries in and out through a transform account; the kernel checks units and records, never that in equals out (they are different quantities). Order within an instant: transfers, then transformations (owner processes), then reconciliation (the `check` phase), so the transform entries fall inside the window. Proposed for owners to accept or decline: an owner-declared conservation group (quantities of one dimension that the owner says must sum) that the kernel totals with the owner's tolerance and no equation of its own.
- *Evidence:* PLATFORM §7a ("losses and transformations accounted separately"). A rule.
- *Functional:* use of an undeclared boundary account fails the check script. A production change with no source entry fails the reconciler. A transformation whose second leg throws rolls back both legs. Crediting a source fails, and so does debiting a sink. Each transformation leg carries its unit, so mismatched units throw.
- *Realism:* none applies; the transformation's equation (for example food → absorbed nutrients, CO₂, water, heat) is Life's, with its own realism tests.
- *Connection:* Life metabolism (transform, kg and J per Life's declaration), Economy production (source) and spoilage (sink), and later decomposition to soil (M4).

**L5 Scheduling** (K1 rules text, K6; `scheduler.ts`, §3.1)
- *Question:* does each consumer see the producer's state as declared, at the declared time, with no update skipped or doubled, when engines run at different periods?
- *Boundary:* the scheduler with fixture processes at 1 s, 60 s, 7 s (dividing nothing), 1 h and 1 d; the five rules of §3.1; `journal.since()`.
- *Model:* a process runs at every T with (T − offset) mod period = 0, in (phase, position) order, with dt = T − last. An event emitted at T is visible only later in the order. A consumer reading flows gets each journal entry exactly once across consecutive reads.
- *Evidence:* DESIGN §2.2 (declared order, interval closing); first-order Lie splitting (standard analysis).
- *Functional:* run counts over a horizon equal the closed form. The sum of a process's dt equals the elapsed time since registration exactly, so no time is skipped or doubled. Shuffled registration orders give identical runs. A daily reader over a 1 s producer's entries partitions them, each entry read once. A skipped or doubled engine day is detected (existing, `H/thirty-days.test.ts`). V-6 splitting order shows O(dt).
- *Realism:* none applies; V-6 is numerical verification, not realism.
- *Time reservations (§3.12, K7, M2):* reserve within the bound passes; overlapping reservations whose Σ shares ≤ B_p(t) are admitted; one share over it is refused with nothing changed; a reservation starting before T is refused; release mid-interval frees only [T, end) and keeps the elapsed part; fulfil records exactly the elapsed time; a reservation inside a rolled-back transaction is gone afterwards; a missing bound refuses and names the bound; a declared `unbounded` fixture admits; replay gives identical records. Connection: Life's bound and Cognition's participation in → Settlement or a resolver reserves → the actor's later intention is refused on overlap (pair test in M2).
- *Connection:* Life fast step → Cognition period → resolver (host phase) → daily engines → `check`. The M1a pair: Life's signal reaches Cognition's evaluation through the specified mapping, traced by cause; no immediacy or direction asserted (HIST-16).

**L6 Replay** (K1, K2; `snapshot.ts`, §3.6)
- *Question:* do the same initial state, inputs and seeds give the same declared outputs?
- *Boundary:* initial snapshot, the kernel input log (external inputs and series at their T), and the seed. Mid-run restore is excluded until K-O11.
- *Model:* canonical(run 1) = canonical(run 2) for the kernel block, every engine part, the journal, the event log and the reconciler reports. A second seed changes only stochastic descendants. `versions` recorded (K2).
- *Evidence:* DESIGN §4.3, §5 (P0 replay definition agreed with Reality). A rule.
- *Functional:* the existing P0 replay, extended to the journal and reconciler reports. Mutation: an external input that is applied but not logged must make replay differ, proving the test can fail. A run whose recorded `versions` differ is refused, or flagged as not comparable.
- *Realism:* none applies.
- *Connection:* every engine's snapshot participant; M1a provisioned and deprived, seeds 1–3, each replayed.

**Diagnosis when a seam fails (Rex's review procedure):** classify before changing anything: a connection error (units,
ids, timing, a duplicated update) is fixed in the connection; invalid use (inputs outside a model's conditions) is fixed
at the caller or the model's declared domain; a missing interaction gets a mechanism; a model error changes an equation
only on evidence. Repeated failures at one seam trigger an investigation, not an automatic verdict. Kernel lanes can only
show the first kind; the others go to the owning keeper.

### §8 Build order (after Rex approves; units per PRODUCTION §2, Gates with a validation spec)

| Step | What | Model | Needs | Smallest demonstration | Milestone |
|---|---|---|---|---|---|
| K1 | run journal (`cause`, `since`, `length`, `net`); vacuous `balance()` removed; reconciler; `boundaries` in the check script; `check` phase in `order.json`; lanes L1–L4, L5 rules text, L6 journal/report replay (§7a); port writer guard (§3.13) | codex (logic), composer (V-5 tests; DESIGN §2.5, §17 text) | approval | each injected defect fails; release v0.2.0 | M1a prerequisite |
| K2 | transaction snapshot cost measured; scoped snapshots if needed (KRN-49); snapshot `versions` (paired, KRN-31) | codex | K1 | eat-sized transaction cost at a 1 s step recorded | M1a |
| K3 | harness pinned to engine tags (KRN-44); P0 regression unchanged | sonnet | engines' tags | P0 goldens identical through tags | — |
| K4 | engines take the run journal, declare boundaries and holdings readers: Settlement money, Economy goods, Reality soils, Society organisation (owners' units, paired by Needs) | owners' lanes (codex) | K1 release | P0 regression passes the reconciler with zero residuals | M1a, M5 |
| K5 | M1a harness: owners' fixture; V-7 | codex (adapters), composer (fixture data, report) | K4; Life ingestion + reserve states; Cognition eat intention; History eat-resolution spec (DC-13); Economy per-good mass (KRN-45) | provisioned and deprived, seeds 1–3, replayed, at 1 s and 60 s | **M1a** |
| K6 | V-6 splitting check; seed-ensemble and sweep runner (DESIGN §15 sensitivity) | codex | K1 | O(dt) convergence shown | M1b, M2 |
| K7 | time-reservation ledger (§3.12) and its L5 tests | codex | K1, K2 (`versions`) | L5 reservation tests pass; replay identical | M2 |
| later | multi-instant actions as owner state machines with per-step transactions (M1b, M2); external series in the input log (M3 weather); transform accounts for decomposition to soil (M4); money and goods batch (landed, 898243b) under the reconciler (M5); resolution hand-off (History P10) | per milestone | as named | each milestone's paired runs pass the reconciler | M1b–M5 |

**5069 (KRN-48).** Done in substance (4a9d127, rechecked by 5093): goldens re-recorded by 5092 (kernel d62287a), 5093 ran
the identical gate and passed (d57d0a3); 4a9d127 is in settlement v0.1.0 (d21c26d). **Settlement closes the queue file**
(`--recheck` when Rex lifts the stop; its SET-41).
The kernel no longer lists it as failed. Its one-journal-per-call belongs to K4, not to 5069.
