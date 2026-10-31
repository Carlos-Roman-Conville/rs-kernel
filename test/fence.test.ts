import { readFileSync, readdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The Kernel imports no engine, game or harness code. Its source and scripts
// are scanned for those imports; harness/ is the one place allowed to import engines.
const SCANNED_DIRS = ['src', 'scripts']
const FORBIDDEN_PACKAGES = ['@rex/realism', '@rex/settlement', '@rex/economy']

export function findViolations(source: string): string[] {
  const found: string[] = []
  const specifiers = source.matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)
  for (const [, spec] of specifiers) {
    const engine = FORBIDDEN_PACKAGES.find(pkg => spec === pkg || spec.startsWith(`${pkg}/`))
    if (engine) found.push(`imports ${engine}`)
    else if (spec.includes('Games/')) found.push(`imports a game path: ${spec}`)
    else if (spec.startsWith('../..')) found.push(`imports outside the package: ${spec}`)
  }
  return found
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = `${dir}/${name}`
    if (statSync(path).isDirectory()) return tsFiles(path)
    return name.endsWith('.ts') ? [path] : []
  })
}

describe('fence', () => {
  it('flags engine, game and outside-package imports', () => {
    expect(findViolations(`import { x } from '@rex/realism'`)).toEqual(['imports @rex/realism'])
    expect(findViolations(`export * from "@rex/settlement/core"`)).toEqual(['imports @rex/settlement'])
    expect(findViolations(`const m = await import('@rex/economy')`)).toEqual(['imports @rex/economy'])
    expect(findViolations(`import '../../Games/poker/x.ts'`)).toEqual([
      'imports a game path: ../../Games/poker/x.ts',
    ])
    expect(findViolations(`import { y } from '../../other'`)).toEqual(['imports outside the package: ../../other'])
  })

  it('allows kernel-internal and one-level-up imports', () => {
    expect(findViolations(`import { parse } from '../src/units.ts'`)).toEqual([])
    expect(findViolations(`import { z } from './ids.ts'`)).toEqual([])
    expect(findViolations(`import type { T } from '@rex/realism-helpers-not-listed'`)).toEqual([])
  })

  it('no file under src/ or scripts/ breaks the fence', () => {
    const offenders = SCANNED_DIRS.flatMap(dir =>
      tsFiles(dir).flatMap(file => {
        const problems = findViolations(readFileSync(file, 'utf8'))
        return problems.map(problem => `${file}: ${problem}`)
      }),
    )
    expect(offenders).toEqual([])
  })
})
