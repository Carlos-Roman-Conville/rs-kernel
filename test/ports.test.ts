import { describe, expect, it } from 'vitest'
import { declareOutput, declareInput, PortTable, convert } from '../src/index.ts'

describe('ports (DESIGN section 7.1)', () => {
  it('P-declarations: declarations retain registry ids and reject invalid units or empty ids', () => {
    expect(declareOutput('writer', 'mass', 'kg')).toEqual({ mechanismId: 'writer', outputId: 'mass', unit: 'kg', direction: 'output' })
    expect(declareInput('reader', 'mass', 'g').direction).toBe('input')
    for (const declare of [declareInput, declareOutput]) {
      expect(() => declare('', 'mass', 'kg')).toThrow()
      expect(() => declare('writer', '', 'kg')).toThrow()
      expect(() => declare('writer', 'mass', 'unknown')).toThrow('unknown')
    }
  })

  it('P-declared: writing or reading an undeclared output throws', () => {
    const table = new PortTable()
    expect(() => table.write('mass', 10)).toThrow('undeclared output')
    expect(() => table.read('mass')).toThrow('undeclared output')
    table.declareOutput('writer', 'mass', 'kg')
    expect(table.read('mass')).toBeUndefined()
  })

  it('P-writer: a second mechanism cannot declare an existing output or replace its value', () => {
    const table = new PortTable([declareOutput('writer', 'mass', 'kg')])
    table.write('mass', 2)
    expect(() => table.declareOutput('other', 'mass', 'kg')).toThrow('already has writer')
    table.declareOutput('writer', 'mass', 'kg')
    expect(() => table.declareOutput('writer', 'mass', 'g')).toThrow('already declared')
    expect(table.read('mass')).toBe(2)
  })

  it('P-entity: reused declarations keep values and writers isolated per entity', () => {
    const declarations = [declareOutput('writer', 'mass', 'kg'), declareInput('reader', 'mass', 'g')]
    const first = new PortTable(declarations)
    const second = new PortTable(declarations)
    first.write('mass', 0)
    expect(first.read('mass', 'reader')).toBe(0)
    expect(second.read('mass')).toBeUndefined()
    expect(second.read('mass', 'reader')).toBeUndefined()
    first.write('mass', 3)
    expect(first.read('mass')).toBe(3)
    expect(second.read('mass')).toBeUndefined()
  })

  it('P-dimension: wiring different dimensions throws before registering the input', () => {
    const table = new PortTable([declareOutput('writer', 'mass', 'kg')])
    expect(() => table.declareInput('reader', 'mass', 'm')).toThrow('dimension mismatch')
    expect(() => table.read('mass', 'reader')).toThrow('undeclared input')
    expect(() => table.declareInput('reader', 'missing', 'kg')).toThrow('undeclared output')
    table.declareInput('reader', 'mass', 'g')
    expect(table.read('mass', 'reader')).toBeUndefined()
  })

  it('P-scale: each consumer reads its declared scale through units.convert, preserving the raw output', () => {
    const table = new PortTable([
      declareInput('reader', 'power', 'W'),
      declareOutput('writer', 'power', 'kcal/day'),
      declareInput('other', 'power', 'J/h'),
    ])
    table.write('power', 2000)
    expect(table.read('power', 'reader')).toBe(convert(2000, 'kcal/day', 'W'))
    expect(table.read('power', 'other')).toBe(convert(2000, 'kcal/day', 'J/h'))
    expect(table.read('power')).toBe(2000)
    expect(() => table.declareInput('reader', 'power', 'J/h')).toThrow('already declared')
    expect(table.read('power', 'reader')).toBe(convert(2000, 'kcal/day', 'W'))
  })

  it('P-affine: temperature input conversion includes the declared offset', () => {
    const table = new PortTable([declareOutput('writer', 'temperature', 'degC'), declareInput('reader', 'temperature', 'K')])
    table.write('temperature', 0)
    expect(table.read('temperature', 'reader')).toBe(273.15)
  })
})
