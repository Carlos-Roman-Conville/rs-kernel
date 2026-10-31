import { describe, expect, it } from 'vitest'
import mechanisms from './fixtures/registry/mechanisms.json' with { type: 'json' }
import quantities from './fixtures/registry/quantities.json' with { type: 'json' }
import aliases from './fixtures/registry/aliases.json' with { type: 'json' }
import kernel from './fixtures/registry/kernel.json' with { type: 'json' }
import unrelated from './fixtures/registry/unrelated.json' with { type: 'json' }
import retired from './fixtures/registry/retired.json' with { type: 'json' }
import { checkRegistry, type Declaration, type RegistryData } from '../scripts/check-registry.ts'

const registry = (): RegistryData => structuredClone({
  mechanisms: mechanisms.mechanisms, quantities: quantities.quantities, aliases: aliases.aliases,
}) as RegistryData
const declaration = (): Declaration => structuredClone({ file: 'kernel.json', ...kernel }) as Declaration

describe('checkRegistry', () => {
  it.each([false, true])('keeps live rows when retired aliases follow them (all=%s)', all => {
    const r = registry()
    r.mechanisms.push(...retired.mechanisms)
    r.quantities!.push(...retired.quantities)
    r.aliases!.push(...retired.aliases)
    const d = declaration()
    d.ports![0].quantity = 'body.retired_temp'
    d.ports![0].mechanism = 't.body.retired_heat'
    expect(checkRegistry(r, [d], { all })).toEqual([])
  })

  it.each([false, true])('rejects live quantity aliases without overwriting the first writer (all=%s)', all => {
    const r = registry()
    r.quantities!.push(...retired.quantities.map(q => ({ ...q, status: 'built' })))
    r.aliases!.push(...retired.aliases)
    expect(checkRegistry(r, [declaration()], { all })).toEqual([
      'body.temp: registry conflict: quantity rows body.temp and body.retired_temp resolve to the same id',
    ])
  })

  it.each([false, true])('rejects built mechanism aliases without overwriting the first row (all=%s)', all => {
    const r = registry()
    r.mechanisms.push(...retired.mechanisms.map(m => ({ ...m, status: 'built' })))
    r.aliases!.push(...retired.aliases)
    expect(checkRegistry(r, [declaration()], { all })).toEqual([
      't.body.heat: registry conflict: mechanism rows t.body.heat and t.body.retired_heat resolve to the same id',
    ])
  })

  it('ignores an unrelated null-writer seed in scoped mode but audits it with --all', () => {
    const r = registry()
    r.mechanisms.push(...unrelated.mechanisms)
    r.quantities!.push(...unrelated.quantities)
    expect(checkRegistry(r, [declaration()])).toEqual([])
    expect(checkRegistry(r, [declaration()], { all: true })).toContain(
      'unrelated.state: written by t.unrelated but its writer is null',
    )
  })

  it.each([false, true])('detects a competing unnamed built writer (all=%s)', all => {
    const r = registry()
    r.mechanisms.push({ id: 't.other', kind: 'mechanism', status: 'built', writes: ['body.temp'] })
    expect(checkRegistry(r, [declaration()], { all })).toContain(
      'body.temp: written by two mechanisms: t.body.heat, t.other',
    )
  })

  it('scopes seeded reads, writes and aggregates even on named mechanisms', () => {
    const r = registry()
    r.mechanisms[0].writes!.push('outside.missing')
    r.mechanisms[0].reads!.push('seed.unused')
    r.mechanisms.push({ id: 't.other', kind: 'mechanism', status: 'built', aggregates: { of: 'missing' } })
    expect(checkRegistry(r, [declaration()])).toEqual([])
    const out = checkRegistry(r, [declaration()], { all: true }).join('\n')
    expect(out).toContain('outside.missing')
    expect(out).toContain('seed.unused')
    expect(out).toContain('t.other: aggregates.of')
  })

  it('rejects unknown reads and null writers in the declaration scope', () => {
    const d = declaration()
    d.processes![0].reads = ['missing', 'seed.unused']
    const out = checkRegistry(registry(), [d]).join('\n')
    expect(out).toContain('reads quantity missing absent from quantities.json')
    expect(out).toContain('seed.unused: writer null has no built row')
  })

  it('checks output port ownership without treating input ports as writers', () => {
    const d = declaration()
    d.ports![0].mechanism = 't.pop.births'
    expect(checkRegistry(registry(), [d]).join('\n')).toContain('writes but its writer is t.body.heat')
    d.ports![0].direction = 'in'
    expect(checkRegistry(registry(), [d])).toEqual([])
  })

  it('rejects two declarations writing the same quantity even with the same mechanism', () => {
    const other = declaration()
    other.file = 'other.json'
    expect(checkRegistry(registry(), [declaration(), other])).toContain(
      'body.temp: written by multiple declarations: kernel.json, other.json',
    )
  })

  it('passes the clean fixtures, resolving aliases and ignoring unused null units', () => {
    expect(checkRegistry(registry(), [declaration()])).toEqual([])
  })

  it('treats missing quantities and aliases files as empty', () => {
    const r = registry()
    delete r.quantities
    delete r.aliases
    r.mechanisms = r.mechanisms.map(m => ({ ...m, writes: [], reads: [], aggregates: null }))
    const d = declaration()
    d.processes = [{ id: 'p', mechanisms: ['t.body.heat'] }]
    d.ports = []
    expect(checkRegistry(r, [d])).toEqual([])
  })

  it('fails a process naming a mechanism with no row, or only a planned or restated row', () => {
    const d = declaration()
    d.processes![0].mechanisms.push('t.nowhere', 't.planned.thing', 't.restated')
    const out = checkRegistry(registry(), [d])
    expect(out.filter(l => l.includes('no built row'))).toHaveLength(3)
  })

  it('fails a process writing a quantity absent from quantities.json', () => {
    const d = declaration()
    d.processes![0].writes!.push('body.missing')
    expect(checkRegistry(registry(), [d])).toEqual([
      'kernel.json: process t.step writes quantity body.missing absent from quantities.json',
    ])
  })

  it('fails a process writing a quantity whose writer is another mechanism', () => {
    const d = declaration()
    d.processes![1].writes!.push('body.temp')
    const out = checkRegistry(registry(), [d])
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('writer is t.body.heat')
  })

  it('fails a row writing a quantity that is not its writer, and two writers of one quantity', () => {
    const r = registry()
    r.mechanisms[1].writes!.push('body.temp')
    const out = checkRegistry(r, [declaration()])
    expect(out).toContain('body.temp: written by two mechanisms: t.body.heat, t.pop.births')
    expect(out).toContain('body.temp: written by t.pop.births but its writer is t.body.heat')
  })

  it('fails aggregates naming a missing target or leaving interface or test empty', () => {
    const r = registry()
    r.mechanisms[1].aggregates = { of: 't.gone', by: 'pop.deaths', interface: ' ', test: '' }
    const out = checkRegistry(r, [declaration()])
    expect(out).toEqual([
      't.pop.births: aggregates.of "t.gone" names no mechanism or quantity',
      't.pop.births: aggregates.interface is empty',
      't.pop.births: aggregates.test is empty',
    ])
  })

  it('fails a stream for an unknown mechanism id', () => {
    const d = declaration()
    d.streams = ['t.body.heat', 't.unknown']
    expect(checkRegistry(registry(), [d])).toEqual(['kernel.json: stream names mechanism t.unknown with no built row'])
  })

  it('fails a used quantity whose unit is unknown, unparseable or null', () => {
    for (const unit of ['unknown', 'kg//s', null]) {
      const r = registry()
      r.quantities![0].unit = unit
      const out = checkRegistry(r, [declaration()])
      expect(out.some(l => l.startsWith('body.temp: unit'))).toBe(true)
    }
  })

  it('fails a port unit that cannot parse or differs in dimension', () => {
    const d = declaration()
    d.ports![0].unit = 'unknown'
    expect(checkRegistry(registry(), [d]).join('\n')).toContain('port t.body.heat/body.temp unit "unknown"')
    d.ports![0].unit = 'kg'
    expect(checkRegistry(registry(), [d]).join('\n')).toContain('differs in dimension')
  })

  it('accepts a different scale of the same dimension on a port', () => {
    const d = declaration()
    d.ports![0].unit = 'K'
    expect(checkRegistry(registry(), [d])).toEqual([])
  })
})
