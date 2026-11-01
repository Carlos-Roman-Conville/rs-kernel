import { defineConfig } from 'vitest/config'

// The 30-day 1 s runs are periodic validation (PLATFORM §11b); on a busy machine they take tens of minutes (KRN-30).
export default defineConfig({ test: { testTimeout: 3600000 } })
