import { describe, expect, it } from 'vitest'
import { buildHamlet, runHorseStable } from './examples.ts'

describe('harness examples export', () => {
  it('exposes the example builders', () => {
    expect(typeof buildHamlet).toBe('function')
    expect(typeof runHorseStable).toBe('function')
    expect(buildHamlet()).toHaveProperty('r')
  })
})
