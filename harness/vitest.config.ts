import { defineConfig } from 'vitest/config'

// The realism runs are 7 and 30 simulated days at 60 s steps.
export default defineConfig({ test: { testTimeout: 600000 } })
