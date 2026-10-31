import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from '../src/units.ts'

const realism = new URL('../../realism/data/', import.meta.url)

/** Parenthetical header text that names a unit but is not written as a unit expression. */
const spelled: Record<string, string> = {
  'C': 'degC',
  'days': 'd',
  'per s': '1/s',
  '% of blood volume': 'percent',
  '% body mass': 'percent',
  "% of the group's max": 'percent',
  'g/dL for alcohol': 'g/L',
}

/** Parenthetical header text that qualifies a column and names no unit. */
const prose = new Set([
  'science', 'from', 'to', 'model', 'MEDICINE.md', 'NUTRITION, PHYSIOLOGY', 'ANATOMY', 'placeholder', 'rest',
  'usual', 'modern', 'good', 'groups', '70 kg man', 'see bleeding table', 'MET', 'hours below 8 h',
  'per day per unit of mean occupancy', 'C per hour per C over', 'development x (1 - fatigue) x condition, per group',
  'direction, potency per standard dose', 'systems, weight', 'inhalation', 'tone', 'woman', 'man', 'full',
  'the state it needs', 'fresh', 'Human default','A horse (example)', 'example', 'inhalation',
])

/** The unit named by a header's parenthetical, `null` when it is prose. */
function headerUnits(header: string): string[] {
  const out: string[] = []
  for (const match of header.matchAll(/\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
    const text = match[1].trim()
    if (prose.has(text)) continue
    const first = text.split(',')[0].trim()
    if (prose.has(first) || /^\d/.test(first)) continue
    out.push(spelled[first] ?? spelled[text] ?? first)
  }
  return out
}

function libraryHeaders(): { file: string, header: string }[] {
  const dir = new URL('library/', realism)
  const found: { file: string, header: string }[] = []
  for (const name of readdirSync(dir).filter(n => n.endsWith('.json')).sort()) {
    const doc = JSON.parse(readFileSync(new URL(name, dir), 'utf8'))
    const walk = (node: any): void => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node.columns)) for (const header of node.columns) if (typeof header === 'string') found.push({ file: name, header })
      Object.values(node).forEach(walk)
    }
    walk(doc)
  }
  return found
}

/** substances.json carries no column headers; `_about` names the unit of each field. */
const substanceUnits = ['kg/mol', 'J/(kg K)', 'J/kg', 'kg/m3', 'degC']

describe('realism units parse with src/units.ts', () => {
  it('finds column headers to check', () => {
    expect(libraryHeaders().length).toBeGreaterThan(50)
    expect(libraryHeaders().flatMap(h => headerUnits(h.header)).length).toBeGreaterThan(10)
  })

  it('parses every unit named in a library column header', () => {
    const bad: string[] = []
    for (const { file, header } of libraryHeaders()) {
      for (const unit of headerUnits(header)) {
        try { parse(unit) } catch (e) { bad.push(`${file}: ${JSON.stringify(header)} -> ${unit}: ${(e as Error).message}`) }
      }
    }
    expect(bad).toEqual([])
  })

  it('parses every unit substances.json names', () => {
    const about: string = JSON.parse(readFileSync(new URL('substances.json', realism), 'utf8'))._about
    for (const unit of ['molarMass kg/mol', 'cp J/(kg K)', 'hhv J/kg', 'density kg/m3']) expect(about).toContain(unit)
    for (const unit of substanceUnits) expect(() => parse(unit), unit).not.toThrow()
  })
})
