import { describe, expect, it } from 'vitest'
import data from '../data/units.json' with { type: 'json' }
import { parse, dim, sameDimension, convert, defaultUnits, type UnitTable } from '../src/index.ts'

describe('units (DESIGN section 7)', () => {
  it('U-table: every required symbol has nine integer dimensions, a positive scale and a source', () => {
    const symbols = ['m', 'kg', 's', 'K', 'mol', 'A', 'cd', 'J', 'W', 'N', 'Pa', 'L', 'm3', 'g', 'min', 'h', 'd', 'kcal', 'cal', 'degC', 'percent', '1', 'money', 'count', 'person']
    for (const symbol of symbols) expect(Object.hasOwn(data, symbol)).toBe(true)
    for (const [symbol, row] of Object.entries(data)) {
      expect(row.source.trim().length, symbol).toBeGreaterThan(0)
      expect(row.dim, symbol).toHaveLength(9)
      expect(row.dim.every(Number.isSafeInteger), symbol).toBe(true)
      expect(row.scale, symbol).toBeGreaterThan(0)
      expect(Number.isFinite(row.scale), symbol).toBe(true)
      expect(parse(symbol).dim, symbol).toEqual(row.dim)
      expect(parse(symbol).scale, symbol).toBe(row.scale)
    }
    for (const [i, symbol] of ['m', 'kg', 's', 'K', 'mol', 'A', 'cd', 'money', 'count'].entries()) {
      expect(dim(symbol)).toEqual(Array.from({ length: 9 }, (_, j) => Number(i === j)))
      expect(parse(symbol).scale).toBe(1)
    }
  })

  it('U-derived: SI derived units and thermochemical calories have the declared scales', () => {
    for (const [a, b] of [['J', 'kg m2/s2'], ['W', 'J/s'], ['N', 'kg m/s2'], ['Pa', 'N/m2']]) {
      expect(parse(a)).toEqual(parse(b))
    }
    expect(convert(1, 'L', 'm3')).toBe(0.001)
    expect(convert(1, 'g', 'kg')).toBe(0.001)
    expect(convert(1, 'min', 's')).toBe(60)
    expect(convert(1, 'h', 's')).toBe(3600)
    expect(convert(1, 'd', 's')).toBe(86400)
    expect(convert(1, 'kcal', 'J')).toBe(4184)
    expect(convert(1, 'cal', 'J')).toBe(4.184)
    expect(defaultUnits.kcal.source).toContain('NIST SP 811')
    expect(convert(25, 'percent', '1')).toBe(0.25)
  })

  it('U-grammar: products, quotients, signed integer powers and nested parentheses compose dimensions', () => {
    for (const expression of ['m2', 'm^2', '(m)^2', 'm*m', 'm m']) expect(parse(expression)).toEqual(parse('m2'))
    expect(parse('s-1')).toEqual(parse('1/s'))
    expect(parse('s^-1')).toEqual(parse('1/s'))
    expect(parse('m^+2')).toEqual(parse('m2'))
    expect(parse('J/(kg K)')).toEqual({ dim: [2, 0, -2, -1, 0, 0, 0, 0, 0], scale: 1 })
    expect(parse('  ( J / ( kg * K ) )  ')).toEqual(parse('J/(kg K)'))
    expect(parse('m/s/s')).toEqual(parse('m/s2'))
    expect(parse('(h/min)^2')).toEqual({ dim: [0, 0, 0, 0, 0, 0, 0, 0, 0], scale: 3600 })
    expect(parse('m^0')).toEqual(parse('1'))
  })

  it('U-energy-rate: kcal/day has the dimension of W and scale 4184/86400', () => {
    expect(sameDimension('kcal/day', 'W')).toBe(true)
    expect(parse('kcal/day').scale).toBe(4184 / 86400)
  })

  it('U-labour: person*h is count times time at scale 3600 (Settlement CONTRACTS section 16)', () => {
    expect(parse('person*h')).toEqual({ dim: [0, 0, 1, 0, 0, 0, 0, 0, 1], scale: 3600 })
    expect(convert(1, 'person', 'count')).toBe(1)
    expect(sameDimension('person', '1')).toBe(false)
    expect(sameDimension('money', 'count')).toBe(false)
  })

  it('U-affine: Celsius and Kelvin temperature points convert in both directions', () => {
    expect(convert(37, 'degC', 'K')).toBe(310.15)
    expect(convert(310.15, 'K', 'degC')).toBe(37)
    expect(convert(0, '°C', 'K')).toBe(273.15)
    expect(convert(-273.15, '(degC)', 'K')).toBe(0)
    for (const expression of ['degC/s', 'kg degC', '1/degC', 'degC^2', 'degC^0']) {
      expect(() => parse(expression)).toThrow('affine')
    }
    expect(parse('K/s').dim).toEqual([0, 0, -1, 1, 0, 0, 0, 0, 0])
  })

  it('U-errors: incompatible dimensions, unknown symbols and malformed grammar throw', () => {
    expect(() => convert(1, 'kg', 'm')).toThrow('dimension mismatch')
    for (const symbol of ['mystery', 'USD', 'constructor', 'toString']) expect(() => parse(symbol)).toThrow(symbol)
    for (const expression of ['', ' ', '()', 'm/', '*m', 'm**s', 'm//s', '(m', 'm)', 'm^', 'm^1.5', 'm@', 'm(s)', 'm + s', 'm^999999999999999999999', 'h^9999']) {
      expect(() => parse(expression), expression).toThrow()
    }
  })

  it('parses siemens with prefixes (soil salinity dS/m)', () => {
    expect(sameDimension('dS/m', 'S/m')).toBe(true)
    expect(parse('dS/m').scale).toBe(parse('S/m').scale * 0.1)
    expect(parse('S').dim).toEqual([-2, -1, 3, 0, 0, 2, 0, 0, 0])
  })

  it('U-data: hosts can supply sourced rows without changing defaults; parsing does not mutate the table', () => {
    const table: UnitTable = { ...defaultUnits, shift: { dim: dim('h'), scale: 28800, source: 'test host shift policy' } }
    expect(convert(1, 'shift', 'h', table)).toBe(8)
    expect(sameDimension('shift', 's', table)).toBe(true)
    expect(() => parse('shift')).toThrow('shift')
    expect(parse('m').dim).not.toBe(defaultUnits.m.dim)
    expect(Object.isFrozen(defaultUnits.m.dim)).toBe(true)
    expect(() => parse('bad', { bad: { ...defaultUnits.m, offset: 1 } })).toThrow('temperature')
  })
})
