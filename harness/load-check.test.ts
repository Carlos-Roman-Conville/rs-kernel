import { describe, expect, it } from 'vitest'
import { ConfigurationError, loadCheck, type Parameter, type Requirement } from './load-check.ts'

// Labelled test doubles: arbitrary quantities, not owner-supplied domain values.
const requirement: Requirement = { id: 'life.gastric_capacity', owner: 'life', unit: 'kg' }
const fixture = (changes: Partial<Parameter> = {}): Parameter => ({
  id: requirement.id, owner: 'life', value: 7, unit: 'kg',
  evidence: 'fixture', source: 'load-check test double; arbitrary number', ...changes,
})
const check = (parameter: Parameter, required = requirement) => loadCheck({
  parameters: [parameter], requirements: [required],
})

describe('harness load check', () => {
  it('requires declared gastric capacity', () => {
    expect(() => loadCheck({ parameters: [], requirements: [requirement] }))
      .toThrow('missing life.gastric_capacity (life)')
  })

  it('rejects unknown values', () => {
    expect(() => check(fixture({ value: null }))).toThrow('unknown life.gastric_capacity')
  })

  it('accepts a labelled, sourced fixture and preserves zero', () => {
    for (const value of [7, 0]) expect(check(fixture({ value })).get(requirement.id)?.value).toBe(value)
  })

  it('allows unbounded only by explicit requirement permission', () => {
    expect(() => check(fixture({ value: 'unbounded' }))).toThrow('life.gastric_capacity may not be unbounded')
    expect(check(fixture({ value: 'unbounded' }), { ...requirement, allowUnbounded: true })
      .get(requirement.id)?.value).toBe('unbounded')
  })

  it('rejects unknown food and references without a resolver', () => {
    for (const resolve of [undefined, () => false]) {
      expect(() => loadCheck({ parameters: [], requirements: [],
        references: [{ kind: 'food', id: 'fixture.missing' }], resolve,
      })).toThrow('unresolved food fixture.missing')
    }
    expect(loadCheck({ parameters: [], requirements: [],
      references: [{ kind: 'food', id: 'fixture.known' }], resolve: ref => ref.id === 'fixture.known',
    }).size).toBe(0)
  })

  it('reports three problems in one configuration error', () => {
    let error: unknown
    try { check(fixture({ value: null, evidence: 'invalid' as Parameter['evidence'], source: '' })) }
    catch (caught) { error = caught }
    expect(error).toBeInstanceOf(ConfigurationError)
    expect((error as ConfigurationError).problems).toEqual([
      'unknown life.gastric_capacity', 'invalid evidence life.gastric_capacity', 'empty source life.gastric_capacity',
    ])
    expect((error as Error).message).toBe((error as ConfigurationError).problems.join('\n'))
  })

  it('requires the exact unit symbol without converting', () => {
    expect(() => check(fixture({ unit: 'g' }))).toThrow('unit mismatch life.gastric_capacity: g expected kg')
  })

  it('rejects duplicates, invalid units and non-finite numbers', () => {
    expect(() => loadCheck({ parameters: [fixture(), fixture()], requirements: [requirement] }))
      .toThrow('duplicate parameter life.gastric_capacity')
    expect(() => check(fixture({ unit: 'not_a_unit' }))).toThrow('invalid unit')
    expect(() => check(fixture(), { ...requirement, unit: 'not_a_unit' })).toThrow('invalid unit')
    for (const value of [NaN, Infinity, -Infinity]) expect(() => check(fixture({ value }))).toThrow('non-finite')
    expect(() => check(fixture({ source: '  ' }))).toThrow('empty source')
  })

  it('returns a frozen read-only snapshot with map iteration', () => {
    const parameter = fixture()
    const result = check(parameter)
    parameter.value = 99
    expect(result.get(parameter.id)?.value).toBe(7)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.get(parameter.id))).toBe(true)
    expect('set' in result || 'delete' in result || 'clear' in result).toBe(false)
    expect([...result.keys()]).toEqual([parameter.id])
    expect([...result]).toEqual([...result.entries()])
    expect([...result.values()]).toEqual([result.get(parameter.id)])
    expect(result.has(parameter.id)).toBe(true)
    const context = {}
    result.forEach(function (this: unknown, value, key, map) {
      expect(this).toBe(context)
      expect(map).toBe(result)
      expect(value).toBe(result.get(key))
    }, context)
  })
})
