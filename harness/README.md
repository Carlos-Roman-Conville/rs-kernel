# Kernel harness (`@rex/kernel-harness`)

## Link safety (Windows)

`harness/node_modules/@rex/` holds **junctions** to the live engine folders (`Toolchain/kernel`, `realism`, `settlement`, `economy`). Never delete `harness/node_modules` (or any folder containing it) with a recursive delete (`rm -rf`, `Remove-Item -Recurse`, `git worktree remove --force` on a worktree that links to it): deletion follows the junctions and removes the engines. This happened on 2026-10-30 (KRN-26). Remove each junction with `cmd /c rmdir <path>` first; `npm ci --offline` in `harness/` recreates them.

## What this is

`harness/` is its own npm package (`@rex/kernel-harness`, `harness/package.json`) and the only code in the Kernel repo that imports the engines (`@rex/realism`, `@rex/settlement`, `@rex/economy` via `file:` dependencies, plus realism, settlement, and economy source and examples by relative paths). The Kernel's `src/` and `scripts/` import no engine (DESIGN.md §0, K-O5).

## Files

- `thirty-days.ts`: 30-day three-engine run on one kernel clock (realism at 1 s steps with hourly trace compaction, settlement and economy daily ticks in a transaction); exports `runnerAdapter`, `dailyProcesses`, `withKernelSteps`, `threePorts`, `runThirtyDays`.
- `thirty-days.test.ts`: P0 test 1 (one clock, process order, transactions roll back, invariants).
- `replay.test.ts`: P0 test 2 (restore initial state and rerun gives equal snapshots; a different seed changes only realism's stochastic state).
- `registry.test.ts`: P0 test 3 (check script over the real registry and the engines' `kernel.json`; advisory `warning:` lines allowed, failures not).
- `units.test.ts`: every unit named in realism's library column headers parses with the Kernel's unit table.
- `golden/golden.test.ts` with `golden/*.json` and `golden/SOURCE.md`: no-silent-change goldens (ADOPTION.md); missing golden written on first run, `npm run golden:write` (`write-golden.mjs`) rewrites all.
- `vitest.config.ts`: 600 s test timeout (realism runs are long).

## How to run

From `harness/`:

- `npx vitest run` — everything (thirty-day run takes many minutes)
- `npx vitest run thirty-days`
- `npx vitest run replay`
- `npx vitest run registry units`
- `npx vitest run golden -t 'settlement: |economy: '` — realism goldens not run after unit 2607 (they change on purpose, ADOPTION.md)

## When to run it

Per PLATFORM.md §11b (Rex 2026-10-31): test enough to know things work; a belt unit's Gate runs only filtered tests for what it touches. Run the full harness only when a shared interface or contract changes, after recovery, or as periodic validation. A unit that changes the check script's output must include `npx vitest run registry` in its Gate.
