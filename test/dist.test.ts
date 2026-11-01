// @ts-expect-error The repo omits Node typings; node:child_process is provided by the test runtime.
import { execFileSync } from 'node:child_process'
// @ts-expect-error The repo's minimal node:fs shim omits these test-runtime APIs.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
// @ts-expect-error The repo omits Node typings; node:os is provided by the test runtime.
import { tmpdir } from 'node:os'
// @ts-expect-error The repo omits Node typings; node:path is provided by the test runtime.
import { join } from 'node:path'
// @ts-expect-error The repo omits Node typings; node:process is provided by the test runtime.
import { execPath } from 'node:process'
import { describe, expect, it } from 'vitest'
import * as dist from '../dist/index.js'
import * as src from '../src/index.ts'

describe('compiled distribution', () => {
  it('exports the same runtime names as src', () => {
    expect(Object.keys(dist).sort()).toEqual(Object.keys(src).sort())
  })

  it('loads in plain Node from node_modules, including units data', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'kernel-dist-'))
    try {
      const installed = join(tmp, 'node_modules', '@rex', 'kernel')
      mkdirSync(installed, { recursive: true })
      for (const name of ['package.json', 'dist', 'data']) {
        cpSync(new URL(`../${name}`, import.meta.url), join(installed, name), {
          recursive: true,
          dereference: true,
        })
      }
      writeFileSync(join(tmp, 'probe.mjs'), `
import { parse, transfer, EventBus } from '@rex/kernel'
console.log(JSON.stringify({
  names: [parse.name, transfer.name, EventBus.name],
  types: [typeof parse, typeof transfer, typeof EventBus],
  money: parse('money').dim,
}))
`)
      const output = execFileSync(execPath, ['probe.mjs'], { cwd: tmp, encoding: 'utf8' })
      expect(JSON.parse(output)).toEqual({
        names: ['parse', 'transfer', 'EventBus'],
        types: ['function', 'function', 'function'],
        money: [0, 0, 0, 0, 0, 0, 0, 1, 0],
      })
    } finally {
      // This directory was created above; copied contents are dereferenced, so it holds no links.
      rmSync(tmp, { recursive: true })
    }
  })
})
