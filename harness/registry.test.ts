import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('../scripts/check-registry.ts', import.meta.url))
const registry = fileURLToPath(new URL('../../registry', import.meta.url))
const kernels = ['settlement', 'economy', 'realism'].map(
  engine => fileURLToPath(new URL(`../../${engine}/kernel.json`, import.meta.url)))

const scratch = mkdtempSync(join(tmpdir(), 'registry-check-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function check(dir: string): { status: number | null, out: string } {
  const run = spawnSync(process.execPath, [script, dir, ...kernels], { encoding: 'utf8' })
  return { status: run.status, out: run.stdout + run.stderr }
}

/** A copy of the real registry with `edit` applied to its parsed files. */
function variant(name: string, edit: (files: { mechanisms: any, quantities: any }) => void): string {
  const dir = join(scratch, name)
  cpSync(registry, dir, { recursive: true })
  const files = {
    mechanisms: JSON.parse(readFileSync(join(dir, 'mechanisms.json'), 'utf8')),
    quantities: JSON.parse(readFileSync(join(dir, 'quantities.json'), 'utf8')),
  }
  edit(files)
  writeFileSync(join(dir, 'mechanisms.json'), JSON.stringify(files.mechanisms))
  writeFileSync(join(dir, 'quantities.json'), JSON.stringify(files.quantities))
  return dir
}

/** A quantity a declared process writes, so the variants break something the check looks at. */
function writtenQuantity(): string {
  for (const file of kernels) {
    const declaration = JSON.parse(readFileSync(file, 'utf8'))
    for (const process of declaration.processes ?? []) if (process.writes?.length) return process.writes[0]
  }
  throw new Error('no engine declares a written quantity')
}

describe('check-registry over the real registry and the three engines', () => {
  it('passes', () => {
    const { status, out } = check(registry)
    const failures = out
      .split('\n')
      .filter(line => line !== '' && !line.startsWith('warning: '))
    expect(failures).toEqual([])
    expect(status).toBe(0)
  })

  it('fails on a write of a quantity with no row', () => {
    const q = writtenQuantity()
    const dir = variant('no-row', ({ quantities }) => {
      quantities.quantities = quantities.quantities.filter((row: any) => row.id !== q)
    })
    const { status, out } = check(dir)
    expect(status).toBe(1)
    expect(out).toContain(`${q}`)
    expect(out).toContain('absent from quantities.json')
  })

  it('fails when a second mechanism writes one quantity', () => {
    const q = writtenQuantity()
    const dir = variant('two-writers', ({ mechanisms }) => {
      mechanisms.mechanisms.push({ id: 'zz.fixture.second_writer', kind: 'mechanism', status: 'built', writes: [q], reads: [] })
    })
    const { status, out } = check(dir)
    expect(status).toBe(1)
    expect(out).toContain(`${q}: written by two mechanisms`)
  })
})
