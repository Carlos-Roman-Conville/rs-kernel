// Records the golden files (GOLDEN_WRITE=1) without relying on shell-specific env syntax.
import { spawnSync } from 'node:child_process'

const run = spawnSync('npx', ['vitest', 'run', 'golden'], { stdio: 'inherit', shell: true, env: { ...process.env, GOLDEN_WRITE: '1' } })
process.exit(run.status ?? 1)
