import { describe, expect, it } from 'vitest'
import { MS, SECOND, MINUTE, HOUR, DAY, TROPICAL_YEAR, simTime, type SimTime } from '../src/index.ts'

describe('integer simulation time', () => {
  it('T-ms: period constants are exact integer milliseconds, including the sourced tropical year', () => {
    const periods: SimTime[] = [MS, SECOND, MINUTE, HOUR, DAY, TROPICAL_YEAR]
    expect(periods).toEqual([1, 1_000, 60_000, 3_600_000, 86_400_000, 31_556_925_216])
    expect(periods.every(Number.isSafeInteger)).toBe(true)
    expect(TROPICAL_YEAR / DAY).toBe(365.24219)
  })

  it('T-safe: times are non-negative safe integers without float rounding', () => {
    for (const value of [0, 1, DAY, Number.MAX_SAFE_INTEGER]) expect(simTime(value)).toBe(value)
    for (const value of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => simTime(value)).toThrow('non-negative safe integer')
    }
  })
})
