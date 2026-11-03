import { describe, expect, it } from 'vitest'
import { declareOutput, declareInput, PortTable, convert, Scheduler } from '../src/index.ts'

describe('ports (DESIGN section 7.1)', () => {
  it('rejects a wrong writer without changing the value', () => {
    const table = new PortTable([declareOutput('writer', 'mass', 'kg')])
    table.write('writer', 'mass', 2)
    expect(() => table.write('other', 'mass', 3)).toThrow('output mass is written by writer, not other')
    expect(table.read('mass')).toBe(2)
  })

  it('rejects an impersonated writer from a process without the mechanism', () => {
    const scheduler = new Scheduler()
    const table = new PortTable([declareOutput('writer', 'mass', 'kg')], {
      running: () => scheduler.current()?.mechanisms ?? null,
    })
    table.write('writer', 'mass', 2)
    scheduler.register({ id: 'realism.step', mechanisms: ['other'], period: 1, phase: 'fast',
      run: () => table.write('writer', 'mass', 3),
    })
    expect(() => scheduler.runUntil(1)).toThrow('port write by writer outside its process')
    expect(table.read('mass')).toBe(2)
    expect(scheduler.current()).toBeNull()
  })

  it('allows the owning mechanism in a process and host writes between runs', () => {
    const scheduler = new Scheduler()
    const table = new PortTable([declareOutput('writer', 'mass', 'kg')], {
      running: () => scheduler.current()?.mechanisms ?? null,
    })
    table.write('writer', 'mass', 1)
    scheduler.register({ id: 'realism.step', mechanisms: ['other', 'writer'], period: 1, phase: 'fast',
      run: () => table.write('writer', 'mass', 2),
    })
    scheduler.runUntil(1)
    expect(table.read('mass')).toBe(2)
    table.write('writer', 'mass', 3)
    expect(table.read('mass')).toBe(3)
    expect(() => table.write('other', 'mass', 4)).toThrow('output mass is written by writer, not other')
    expect(table.read('mass')).toBe(3)
  })

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
    expect(() => table.write('writer', 'mass', 10)).toThrow('undeclared output')
    expect(() => table.read('mass')).toThrow('undeclared output')
    table.declareOutput('writer', 'mass', 'kg')
    expect(table.read('mass')).toBeUndefined()
  })

  it('P-writer: a second mechanism cannot declare an existing output or replace its value', () => {
    const table = new PortTable([declareOutput('writer', 'mass', 'kg')])
    table.write('writer', 'mass', 2)
    expect(() => table.declareOutput('other', 'mass', 'kg')).toThrow('already has writer')
    table.declareOutput('writer', 'mass', 'kg')
    expect(() => table.declareOutput('writer', 'mass', 'g')).toThrow('already declared')
    expect(table.read('mass')).toBe(2)
  })

  it('P-entity: reused declarations keep values and writers isolated per entity', () => {
    const declarations = [declareOutput('writer', 'mass', 'kg'), declareInput('reader', 'mass', 'g')]
    const first = new PortTable(declarations)
    const second = new PortTable(declarations)
    first.write('writer', 'mass', 0)
    expect(first.read('mass', 'reader')).toBe(0)
    expect(second.read('mass')).toBeUndefined()
    expect(second.read('mass', 'reader')).toBeUndefined()
    first.write('writer', 'mass', 3)
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
    table.write('writer', 'power', 2000)
    expect(table.read('power', 'reader')).toBe(convert(2000, 'kcal/day', 'W'))
    expect(table.read('power', 'other')).toBe(convert(2000, 'kcal/day', 'J/h'))
    expect(table.read('power')).toBe(2000)
    expect(() => table.declareInput('reader', 'power', 'J/h')).toThrow('already declared')
    expect(table.read('power', 'reader')).toBe(convert(2000, 'kcal/day', 'W'))
  })

  it('P-affine: temperature input conversion includes the declared offset', () => {
    const table = new PortTable([declareOutput('writer', 'temperature', 'degC'), declareInput('reader', 'temperature', 'K')])
    table.write('writer', 'temperature', 0)
    expect(table.read('temperature', 'reader')).toBe(273.15)
  })
})
