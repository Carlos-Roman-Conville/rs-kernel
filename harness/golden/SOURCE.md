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

Rewrite only with `npm run golden:write` (never in an adoption unit).
