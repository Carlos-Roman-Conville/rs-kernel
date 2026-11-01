# Golden sources

Recorded 2026-10-30, before any kernel adoption, from each engine's HEAD:

| Engine | HEAD | Runs |
|---|---|---|
| realism | 15dc9d2 | human week, human wound (three variants and the healing reference), horse stable |
| settlement | 70e3117 (contains efc72cf, the DUP-44 fix) | A1 fixture after its six steps, hamlet 30 days |
| economy | 60cafa1 | three ports, `simulate(30)` |

Each file is `canonical(...)` of the run. Realism's conservation checks are stored as a count, a failure count, and
per quantity the count, first and last row and an `fnv1a64` hash of every `(t, quantity, expected, actual, ok)` row;
the transfer trace is stored as its count and `fnv1a64` of `canonical(trace.transfers)`. Wall-clock fields
(`elapsedMs`) are left out. Two consecutive captures were byte-identical.

2698: `settlement-A1.json` and `settlement-hamlet-30.json` re-recorded from settlement 0d76869 (person-hours, decay, status
writer); explained key by key in ADOPTION.md `### 2698`.

5092: `settlement-A1.json` and `settlement-hamlet-30.json` re-recorded at settlement 4a9d127: the only change is the
`postFilled` events that settlement 7e49d3c (unit 3047, IF-27) adds to every hire (2 in A1, 1 in hamlet); state and
ledger unchanged.

5258: realism goldens (`realism-*.json`) re-recorded at realism 9cec538; every change since 15dc9d2 is explained below (bisect: realism 5158, validation/GOLDEN-DRIFT.md).

Realism commits after the 5158 bisect, not bisected: 9cec538 bc42793 a3a5c8f 1008a49 289efe2 adf727e 9c69a83 0fb8379 4074843 b52d299 3ac69ca 2c7775a ddc778a d635366 0667d93 c5a4651 ab65bb4 d48370a eecf211 09bd809 2be3a09 ce0af2d cc60126 55f4443 700653e 0430dc2 688e557 cfc22cc 3c0d717 2aecc5c 672ed6b 8247021 67f82c8 (Reality keeper explains if a golden moves).

5158: realism 4c7e6f9 (2621): Physiology owns metabolic O2 demand; RMR/Kleiber-scaled breathing intentionally changes human/horse gas exchange and ventilation, with coupled water, energy, component-state and ledger changes (flags/atmosphere.md NOTE 2621).
5158: realism 2d8057a (2623): Shared body-water ownership and immediate traced body-mass changes intentionally alter heat capacity, metabolic demand, hydration/mass checkpoints, initialization fields and accounting checks/transfers (flags/physiology.md report 2623).
5158: realism d797082 (2656): Neumaier-compensated conservation/trace sums intentionally change check expected values and per-quantity hashes; daily checkpoints, final components and transfers stay unchanged (flags/independence.md 2656).
5158: realism 8cee7ac (2677 / 2687): Glycogen-bound water is included in the starting total-water reference; only props.water_start_kg changes in these five records, with no daily/check/transfer drift (flags/physiology.md 2677/2687).
5158: realism 5e9a866 (2633): Medicine's explicitly documented fixed world-time origin adds crisisTimeOrigin=0 to each wound medicine record; no other captured value changes (flags/medicine.md NOTE 2633).
5158: realism 3df7606 (2723): The documented healing pathway replaces daily healingFactors.vitCMg with collagenIntegrity and stores medicine.collagenIntegrity; wound records gain/lose 15 keys each, without changed human-week or horse records (flags/medicine.md pathway 2723).
5158: realism 8e57a45 (2787): Explicitly added dentition-aware scurvy signs publish gum_bleeding and teeth_lost as null in the wound fixtures, adding 30 keys per variant; no other captured values change (commit message and flags/medicine.md 2787).
5158: realism 12f61ac (2832): Documented 3CC roundoff clamping/renormalization changes wound hand fatigue/peak endpoints, hand-fraction check values/hash and transfer hash; rates and tolerances are unchanged (flags/muscular.md NOTE 2832).
5158: realism 9342308 (2833): Exact constant-effort 3CC replaces 1-second Euler, intentionally changing wound hand fatigue/peak endpoints and aggregating integrated trace flows/checks, with unchanged equations/rates (flags/muscular.md re-recorded 2833).
5158: realism c0ed753 (2634): one activity schedule drives local and systemic fatigue; the serialized activity output is new by design (Reality keeper ruling 2026-11-01); no existing value changes.
5158: realism 84257ea (2727): medicine consumes the breathing/gas outputs; the medicine.exposure.* keys are new, zero in these fixtures, by design (Reality keeper ruling 2026-11-01); no existing value changes.

Rewrite only with `npm run golden:write` (never in an adoption unit).
