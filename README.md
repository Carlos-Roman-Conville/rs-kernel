# @rex/kernel

The Kernel is the small shared package the engines (realism, settlement, economy) and their hosts import for
simulation time and scheduling, event ordering, identifiers, units, seeded random streams, snapshots and replay, and
cross-engine transactions. Design: `DESIGN.md`; build order: `ADOPTION.md`.

The fence (DESIGN §0):

- It never owns a scientific or economic formula; physics, biology and economy stay with their engines.
- It imports nothing from any engine or game; the engines import it (only `harness/` may import engines).
- Adopting it never silently changes a result; golden outputs are checked in every adoption unit.

Test: `npm install`, then `npx vitest run` and `npx tsc --noEmit` (or `npm test`, `npm run typecheck`).
