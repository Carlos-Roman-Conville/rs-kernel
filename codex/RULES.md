# Rules for Codex (and any belt worker) in `Toolchain/kernel`

1. Read `DESIGN.md` (the section your task names) and `ADOPTION.md` (your unit's row) first. They are the spec.
2. The Kernel is infrastructure only (Rex, 2026-10-30): time, scheduling, event order, ids, units, RNG streams,
   snapshots, replay, transactions. Never write a scientific, biological or economic formula or constant here.
3. `src/` and `scripts/` import nothing from `@rex/realism`, `@rex/settlement`, `@rex/economy` or any game.
   Only `harness/` imports engines.
4. Anything a host or owner could choose (orders, periods, unit rows, tolerances) is data or a parameter, never a
   hard-coded value. Unit rows carry a `source`.
5. Deterministic everywhere: no `Math.random`, no `Date.now` in logic, no iteration over unordered keys where order
   reaches the output.
6. Style matches the engines: TypeScript, ES modules with `.ts` import suffixes, small files, one test file per
   source file in `test/`, test titles name the rule they check.
7. Run only your own tests while working (`npx vitest run test/<file>.test.ts`); the runner runs the Gate.
8. In an engine repo (adoption units): change only the files the task names; the engine's tests and its count must
   stay green; never touch the pirate repo.
9. One commit, not pushed, ending with `Co-Authored-By: OpenAI Codex <codex@openai.com>`. Nothing left uncommitted.
10. Close with a short report: done or parked, tests, commit hash.
