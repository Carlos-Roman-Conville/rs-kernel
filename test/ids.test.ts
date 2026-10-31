import { describe, expect, it } from 'vitest'
import { mint, qualify, unqualify, type Counters } from '../src/index.ts'

describe('identifiers', () => {
  it('mint starts at 0001 and returns new counters without mutating the old', () => {
    const original = Object.freeze({})
    const first = mint(original, 'bldg')
    expect(first).toEqual({ id: 'bldg.0001', counters: { bldg: 1 } })
    expect(first.counters).not.toBe(original)
    expect(original).toEqual({})
    Object.freeze(first.counters)
    const second = mint(first.counters, 'bldg')
    expect(second).toEqual({ id: 'bldg.0002', counters: { bldg: 2 } })
    expect(first.counters).toEqual({ bldg: 1 })
    expect(mint(second.counters, 'org')).toEqual({ id: 'org.0001', counters: { bldg: 2, org: 1 } })
  })

  it('mint widens past four digits so the 10 000th id is x.10000', () => {
    let counters: Counters = {}
    let id = ''
    for (let n = 0; n < 10_000; n++) ({ id, counters } = mint(counters, 'x'))
    expect(id).toBe('x.10000')
    expect(counters).toEqual({ x: 10_000 })
  })

  it('qualify and unqualify round-trip minted and opaque local ids', () => {
    expect(qualify('settlement', 'bldg.0001')).toBe('settlement/bldg.0001')
    for (const id of ['bldg.0001', 'pool.workers', 'body', ' host id ']) {
      expect(unqualify(qualify('settlement', id))).toEqual({ engine: 'settlement', id })
    }
  })

  it('qualify refuses slash-containing local ids at the boundary', () => {
    expect(() => qualify('settlement', 'pool/workers')).toThrow('local id must be non-empty and contain no /')
  })

  it('qualification refuses empty components and ambiguous engine names', () => {
    for (const engine of ['', 'a/b']) expect(() => qualify(engine, 'body')).toThrow()
    expect(() => qualify('realism', '')).toThrow()
  })

  it('unqualify refuses missing, empty, or multiple separator components', () => {
    for (const id of ['', 'body', '/body', 'realism/', 'realism/body/part']) {
      expect(() => unqualify(id)).toThrow('qualified id must have the form engine/local id')
    }
  })
})
