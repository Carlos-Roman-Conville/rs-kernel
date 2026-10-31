import { describe, expect, it } from 'vitest'
import { must, nonempty, finite, integer } from '../src/index.ts'

describe('guards preserve engine behavior and exact messages', () => {
  it('must returns own entries and refuses unknown or inherited ids', () => {
    const entry = { name: 'building' }
    expect(must({ bldg: entry }, 'bldg', 'building')).toBe(entry)
    expect(must({ zero: 0 }, 'zero', 'count')).toBe(0)
    expect(must({ present: undefined }, 'present', 'value')).toBeUndefined()
    for (const id of ['missing', 'toString', '__proto__']) {
      expect(() => must({}, id, 'building')).toThrow(new Error(`unknown building: ${id}`))
    }
  })

  it('nonempty refuses nonstrings and blank strings without trimming valid values', () => {
    for (const value of [undefined, null, 0, false, {}, '', ' \t\n']) {
      expect(() => nonempty(value, 'name')).toThrow(new Error('name must be a non-empty string'))
    }
    expect(nonempty(' name ', 'name')).toBe(' name ')
  })

  it('finite refuses nonnumbers and nonfinite values with the default minimum message', () => {
    for (const value of [undefined, null, '1', false, NaN, Infinity, -Infinity]) {
      expect(() => finite(value, 'amount')).toThrow(new Error('amount must be a number >= -Infinity'))
    }
    expect(finite(-1.5, 'amount')).toBe(-1.5)
  })

  it('finite enforces an inclusive minimum with the engines exact message', () => {
    expect(() => finite(-0.1, 'amount', 0)).toThrow(new Error('amount must be a number >= 0'))
    expect(finite(0, 'amount', 0)).toBe(0)
    expect(finite(1.5, 'amount', 0)).toBe(1.5)
  })

  it('integer checks finite and minimum before rejecting fractional values', () => {
    for (const value of [undefined, null, '2', NaN, Infinity, -Infinity, -1, -0.5]) {
      expect(() => integer(value, 'count', 0)).toThrow(new Error('count must be a number >= 0'))
    }
    expect(() => integer(1.5, 'count', 0)).toThrow(new Error('count must be an integer'))
    expect(integer(0, 'count', 0)).toBe(0)
    expect(integer(-2, 'count', -2)).toBe(-2)
    expect(integer(2, 'count', 0)).toBe(2)
  })
})
