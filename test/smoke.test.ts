import { describe, expect, it } from 'vitest'
import * as kernel from '../src/index.ts'

describe('kernel barrel', () => {
  it('loads', () => {
    expect(kernel).toBeDefined()
  })
})
