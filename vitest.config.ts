import { configDefaults, defineConfig } from 'vitest/config'

// harness/ is its own package with its own config (long realism runs); run it from there.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, 'harness/**'] } })
