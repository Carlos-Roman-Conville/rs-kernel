import { describe, expect, it } from 'vitest'
import mechanisms from './fixtures/registry/mechanisms.json' with { type: 'json' }
import quantities from './fixtures/registry/quantities.json' with { type: 'json' }
import aliases from './fixtures/registry/aliases.json' with { type: 'json' }
import kernel from './fixtures/registry/kernel.json' with { type: 'json' }
import unrelated from './fixtures/registry/unrelated.json' with { type: 'json' }
import retired from './fixtures/registry/retired.json' with { type: 'json' }
import { checkRegistry, checkWarnings, type Declaration, type RegistryData } from '../scripts/check-registry.ts'

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


describe('checkWarnings', () => {
  it.each([undefined, null, '', ' \t ', ' documented '])('checks schema 4 contract fields for emptiness (%s)', value => {
    const r: RegistryData = { mechanisms: [{
      id: 'a', kind: 'mechanism', status: 'built',
      ...(value === undefined ? {} : { rate_limiter: value, failure_mode: value }),
    }] }
    const d: Declaration = { file: 'schema4.json', streams: ['a'] }
    expect(checkWarnings(r, [d])).toEqual(value === ' documented ' ? [] : [
      'warning: a: has no failure_mode', 'warning: a: has no rate_limiter',
    ])
    expect(checkRegistry(r, [d])).toEqual([])
  })

  for (const integration_tests of [undefined, [], ['integration.test']]) {
    it.each([undefined, null, '', ' \t ', ' stable '])(`checks schema 4 stability only with integration evidence (${JSON.stringify(integration_tests)}, %s)`, stability => {
      const r: RegistryData = { mechanisms: [{
        id: 'a', kind: 'mechanism', status: 'built', rate_limiter: 'capacity', failure_mode: 'overload',
        vv: { record: { integration_tests, ...(stability === undefined ? {} : { numerical: { stability } }) } },
      }] }
      const d: Declaration = { file: 'schema4.json', streams: ['a'] }
      expect(checkWarnings(r, [d])).toEqual(integration_tests?.length && stability !== ' stable ' ? [
        'warning: a: has an integration test but no numerical.stability',
      ] : [])
      expect(checkRegistry(r, [d])).toEqual([])
    })
  }

  it.each(['processes', 'ports', 'streams'] as const)('scopes schema 4 warnings by %s, resolving aliases and sorting unique lines', source => {
    const r: RegistryData = {
      mechanisms: ['z', 'a'].map(id => ({ id, kind: 'mechanism', status: 'built',
        vv: { integrated: true, record: { integration_tests: ['test'], numerical: {} } } })),
      aliases: [{ old: 'old-z', new: 'z' }],
      quantities: [{ id: 'q', unit: '1', writer: 'z' }],
    }
    const d: Declaration = { file: 'schema4.json' }
    if (source === 'processes') d.processes = [{ id: 'p', mechanisms: ['old-z', 'z'] }]
    if (source === 'ports') d.ports = [{ mechanism: 'old-z', quantity: 'q', unit: '1' }]
    if (source === 'streams') d.streams = ['old-z', 'z']
    const lines = (id: string) => [
      `warning: ${id}: has an integration test but no numerical.stability`,
      `warning: ${id}: has no failure_mode`,
      `warning: ${id}: has no rate_limiter`,
    ]
    expect(checkWarnings(r, [])).toEqual([])
    expect(checkWarnings(r, [d, d])).toEqual(lines('z'))
    expect(checkWarnings(r, [d, d], { all: true })).toEqual([...lines('a'), ...lines('z')])
    expect(checkRegistry(r, [d])).toEqual([])
    expect(checkRegistry(r, [d], { all: true })).toEqual([])
  })

  it.each([
    { kind: 'mechanism', status: 'planned' },
    { kind: 'mechanism', status: 'retired' },
    { kind: 'restatement', status: 'built' },
  ])('ignores schema 4 gaps for $kind/$status rows', fields => {
    const r: RegistryData = { mechanisms: [{ id: 'a', ...fields,
      vv: { record: { integration_tests: ['test'] } } }] }
    expect(checkWarnings(r, [{ file: 'schema4.json', streams: ['a'] }], { all: true })).toEqual([])
    expect(checkRegistry(r, [], { all: true })).toEqual([])
  })

  const fixture = (): RegistryData => ({
    mechanisms: [
      { id: 'a', kind: 'mechanism', status: 'built' },
      { id: 'b', kind: 'mechanism', status: 'built' },
    ],
    quantities: [{ id: 'q', unit: '1', writer: 'a' }],
  })
  const reading = (): Declaration => ({ file: 'reader.json', processes: [{ id: 'read', mechanisms: ['b'], reads: ['q'] }] })
  const pair = 'warning: a -> b via q: connected with no named integration test'

  it.each(['no (not built)', 'n/a (restatement)', 'plugin (outside the registry ports)', 'by convention', false, ''])('warns once per mechanism per file when integrated is %s', integrated => {
    const r = fixture()
    r.mechanisms[0].vv = { integrated }
    r.quantities!.push({ id: 'r', unit: '1', writer: 'a' })
    const d: Declaration = { file: 'ports.json', ports: [
      { mechanism: 'a', quantity: 'q', unit: '1' },
      { mechanism: 'a', quantity: 'r', unit: '1', direction: 'in' },
    ] }
    const other = { ...d, file: 'other.json' }
    expect(checkWarnings(r, [d, d, other])).toEqual(['other.json', 'ports.json'].map(file =>
      `warning: ${file}: port a/q is wired but a is not marked integrated (vv.integrated: ${JSON.stringify(integrated)})`))
    expect(checkRegistry(r, [d, other])).toEqual([])
  })

  it.each([true, 'yes (kernel ports, 2026-11-01)', '  YeS  '])('does not warn for an integrated port (%s)', integrated => {
    const r = fixture()
    r.mechanisms[0].vv = { integrated }
    const d: Declaration = { file: 'ports.json', ports: [{ mechanism: 'a', quantity: 'q', unit: '1', direction: 'output' }] }
    expect(checkWarnings(r, [d])).toEqual([])
    expect(checkRegistry(r, [d])).toEqual([])
  })

  it('treats missing vv as not integrated and untested without adding failures', () => {
    const r = fixture()
    const d = reading()
    d.ports = [{ mechanism: 'b', quantity: 'q', unit: '1' }]
    expect(checkWarnings(r, [d])).toEqual([pair,
      'warning: reader.json: port b/q is wired but b is not marked integrated (vv.integrated: "")'])
    expect(checkRegistry(r, [d])).toEqual([])
  })

  it.each([0, 1])('accepts named integration evidence from side %s only when both lists match', side => {
    const r = fixture()
    const d = reading()
    expect(checkWarnings(r, [d])).toEqual([pair])
    r.mechanisms[side].vv = { record: { integration_tested_with: [side === 0 ? 'b' : 'a'], integration_tests: [] } }
    expect(checkWarnings(r, [d])).toEqual([pair])
    r.mechanisms[side].vv!.record!.integration_tests = ['integration.test']
    expect(checkWarnings(r, [d])).toEqual([])
    r.mechanisms[side].vv!.record!.integration_tested_with = ['unrelated']
    expect(checkWarnings(r, [d])).toEqual([pair])
    expect(checkRegistry(r, [d])).toEqual([])
  })

  it('combines quantities in sorted order and de-duplicates repeated connections', () => {
    const r = fixture()
    r.quantities!.unshift({ id: 'z', unit: '1', writer: 'a' })
    r.mechanisms[0].writes = ['z', 'q', 'q']
    r.mechanisms[1].reads = ['z', 'q']
    const d = reading()
    d.processes![0].reads = ['z', 'q', 'q']
    expect(checkWarnings(r, [d, d])).toEqual(['warning: a -> b via q,z: connected with no named integration test'])
    expect(checkRegistry(r, [d])).toEqual([])
  })

  it.each(['processes', 'ports', 'streams'] as const)('scopes pairs to either endpoint named by %s', source => {
    const r = fixture()
    r.mechanisms[1].reads = ['q']
    expect(checkWarnings(r, [])).toEqual([])
    expect(checkWarnings(r, [], { all: true })).toEqual([pair])
    for (const m of ['a', 'b']) {
      r.mechanisms.forEach(row => { row.vv = { integrated: true } })
      const d: Declaration = { file: 'scope.json' }
      if (source === 'processes') d.processes = [{ id: 'p', mechanisms: [m] }]
      if (source === 'ports') d.ports = [{ mechanism: m, quantity: 'q', unit: '1' }]
      if (source === 'streams') d.streams = [m]
      expect(checkWarnings(r, [d])).toEqual([pair])
      expect(checkRegistry(r, [d])).toEqual([])
    }
    expect(checkRegistry(r, [], { all: true })).toEqual([])
  })

  it.each(['planned', 'retired', 'restated'])('ignores %s mechanisms even when declared or connected', status => {
    const r = fixture()
    r.mechanisms[1].status = status
    r.mechanisms[1].writes = ['q']
    r.mechanisms[1].reads = ['q']
    const d = reading()
    d.ports = [{ mechanism: 'b', quantity: 'q', unit: '1' }]
    expect(checkWarnings(r, [d], { all: true })).toEqual([])
  })

  it('ignores non-mechanism rows', () => {
    const r = fixture()
    r.mechanisms[1].kind = 'restatement'
    r.mechanisms[1].reads = ['q']
    expect(checkWarnings(r, [reading()], { all: true })).toEqual([])
  })

  it('resolves aliases for both endpoints, quantities and coverage while skipping retired rows', () => {
    const r = fixture()
    r.aliases = [{ old: 'old-a', new: 'a' }, { old: 'old-b', new: 'b' }, { old: 'old-q', new: 'q' }]
    r.quantities![0].writer = 'old-a'
    r.quantities!.push({ id: 'old-q', status: 'retired', unit: '1', writer: 'b' })
    r.mechanisms.push({ id: 'old-a', kind: 'mechanism', status: 'retired', reads: ['q'], writes: ['q'] })
    r.mechanisms[0].writes = ['old-q']
    const d: Declaration = { file: 'alias.json', processes: [{ id: 'p', mechanisms: ['old-b'], reads: ['old-q'] }],
      ports: [{ mechanism: 'old-a', quantity: 'old-q', unit: '1', direction: 'out' }] }
    expect(checkWarnings(r, [d])).toEqual([pair,
      'warning: alias.json: port a/q is wired but a is not marked integrated (vv.integrated: "")'])
    r.mechanisms[0].vv = { integrated: true, record: { integration_tested_with: ['old-b'], integration_tests: ['test'] } }
    expect(checkWarnings(r, [d])).toEqual([])
    expect(checkRegistry(r, [d])).toEqual([])
  })

  for (const writer of ['quantity', 'process', 'out', 'output', 'row']) {
    it.each(['process', 'in', 'input', undefined, 'row'])(`connects a ${writer} writer to a %s reader`, reader => {
      const r = fixture()
      r.quantities![0].writer = writer === 'quantity' ? 'a' : null
      r.mechanisms.forEach(row => { row.vv = { integrated: true } })
      const d: Declaration = { file: 'sources.json', processes: [], ports: [] }
      if (writer === 'process') d.processes!.push({ id: 'write', mechanisms: ['a'], writes: ['q'] })
      if (writer === 'out' || writer === 'output') d.ports!.push({ mechanism: 'a', quantity: 'q', unit: '1', direction: writer })
      if (writer === 'row') r.mechanisms[0].writes = ['q']
      if (reader === 'process') d.processes!.push({ id: 'read', mechanisms: ['b'], reads: ['q'] })
      else if (reader === 'row') r.mechanisms[1].reads = ['q']
      else d.ports!.push({ mechanism: 'b', quantity: 'q', unit: '1', direction: reader })
      expect(checkWarnings(r, [d], { all: true })).toEqual([pair])
      r.mechanisms[1].status = 'planned'
      expect(checkWarnings(r, [d], { all: true })).toEqual([])
    })
  }

  it('does not pair a mechanism with itself and tolerates absent optional collections', () => {
    const r: RegistryData = { mechanisms: [{ id: 'a', kind: 'mechanism', status: 'built', reads: ['q'], writes: ['q'] }] }
    expect(checkWarnings(r, [{ file: 'empty.json' }], { all: true })).toEqual([])
    expect(checkWarnings({ mechanisms: [] }, [])).toEqual([])
  })
})
