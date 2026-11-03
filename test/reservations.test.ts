import { describe, expect, it } from 'vitest'
import { canonical, ReservationLedger, transaction, type Bound } from '../src/index.ts'

// Test doubles only: production bounds belong to Life and Cognition.
const fixtureBound: Bound = { kind: 'series', steps: [{ from: 0, value: 1 }] }
const fixtureUnbounded: Bound = { kind: 'unbounded', evidence: 'fixture' }
const ledger = (bound: Bound | undefined = fixtureBound) => new ReservationLedger({ bound: () => bound })
const request = (id = 'r1', start = 10, end = 30, share = 1, actor = 'actor') =>
  ({ id, actor, cause: `cause:${id}`, start, end, share })

describe('time reservation ledger', () => {
  it('admits within the bound and uses half-open intervals and actor isolation', () => {
    const book = ledger()
    expect(book.id).toBe('kernel.reservations')
    expect(book.reserve(10, request())).toMatchObject({ status: 'reserved', fulfilledMs: 0 })
    book.reserve(10, request('other', 10, 30, 1, 'other'))
    book.reserve(10, request('adjacent', 30, 40))
    expect(book.active('actor', 9)).toEqual([])
    expect(book.active('actor', 10).map(r => r.id)).toEqual(['r1'])
    expect(book.active('actor', 30).map(r => r.id)).toEqual(['adjacent'])
    expect(book.active('actor', 40)).toEqual([])
  })

  it('admits overlap equal to the bound and refuses excess atomically', () => {
    const book = ledger()
    book.reserve(0, request('first', 10, 30, 0.5))
    book.reserve(0, request('second', 20, 40, 0.5))
    const before = book.snapshot()
    expect(() => book.reserve(0, request('excess', 15, 25, 0.25)))
      .toThrow('bound exceeded for actor at 20')
    expect(book.snapshot()).toEqual(before)
  })

  it('rejects starts before now', () => {
    const book = ledger()
    expect(() => book.reserve(11, request())).toThrow('past')
    expect(book.records()).toEqual([])
  })

  it('distinguishes missing, zero and explicitly unbounded fixture bounds', () => {
    const missing = new ReservationLedger({ bound: () => undefined })
    expect(() => missing.reserve(0, request())).toThrow('missing bound for actor')
    expect(missing.snapshot()).toEqual({ reservations: [], records: [] })
    expect(() => ledger({ kind: 'series', steps: [{ from: 0, value: 0 }] })
      .reserve(0, request())).toThrow('bound exceeded')
    expect(ledger(fixtureUnbounded).reserve(0, request('large', 0, 100, 1000)).share).toBe(1000)
  })

  it('keeps elapsed milliseconds on release and frees the remaining interval', () => {
    const book = ledger()
    book.reserve(0, request())
    expect(book.release(20, 'r1')).toMatchObject({ status: 'released', fulfilledMs: 10, releasedAt: 20 })
    book.reserve(20, request('replacement', 20, 30))
    expect(book.active('actor', 20).map(r => r.id)).toEqual(['replacement'])
    expect(book.records()[1]).toMatchObject({ cause: 'cause:r1', fulfilledMs: 10, operation: 'release', t: 20 })
  })

  it.each([0, 10])('release at %i before or at start fulfils no time', now => {
    const book = ledger()
    book.reserve(0, request())
    expect(book.release(now, 'r1')).toMatchObject({ status: 'released', fulfilledMs: 0 })
    expect(book.active('actor', 10)).toEqual([])
  })

  it.each([30, 40])('refuses release at or after end (%i), then fulfils exactly the duration', now => {
    const book = ledger()
    book.reserve(0, request())
    const before = book.snapshot()
    expect(() => book.release(now, 'r1')).toThrow('already elapsed')
    expect(() => book.fulfil(29, 'r1')).toThrow('has not ended')
    expect(book.snapshot()).toEqual(before)
    expect(book.fulfil(now, 'r1')).toMatchObject({ status: 'fulfilled', fulfilledMs: 20 })
    expect(book.records()[1]).toMatchObject({ operation: 'fulfil', cause: 'cause:r1', fulfilledMs: 20 })
  })

  it('rolls back reservations, state transitions and records at one instant', () => {
    const book = ledger()
    book.reserve(0, request())
    const before = book.snapshot()
    expect(() => transaction([book], () => {
      book.release(20, 'r1')
      book.reserve(20, request('temporary', 20, 30))
      throw new Error('abort')
    })).toThrow('abort')
    expect(book.snapshot()).toEqual(before)
    expect(book.active('actor', 20).map(r => r.id)).toEqual(['r1'])
  })

  it('checks bound drops inside the interval but excludes the end', () => {
    const book = ledger({ kind: 'series', steps: [{ from: 0, value: 1 }, { from: 20, value: 0.5 }] })
    expect(() => book.reserve(0, request())).toThrow('bound exceeded for actor at 20')
    expect(book.records()).toEqual([])
    book.reserve(0, request('before', 10, 20))
    book.reserve(0, request('after', 20, 30, 0.5))
  })

  it('checks reservation ends along with changes to the bound', () => {
    const book = ledger({ kind: 'series', steps: [{ from: 0, value: 1 }, { from: 20, value: 0.5 }] })
    book.reserve(0, request('early', 10, 20, 0.5))
    book.reserve(0, request('spanning', 10, 30, 0.5))
    expect(book.active('actor', 20).map(r => r.id)).toEqual(['spanning'])
  })

  it('returns detached state and records, and restores without retaining snapshot references', () => {
    const book = ledger()
    const result = book.reserve(0, request())
    result.share = 99
    book.active('actor', 10)[0].share = 99
    book.records()[0].cause = 'changed'
    const saved = book.snapshot()
    book.release(20, 'r1')
    book.restore(saved)
    saved.reservations[0].share = 99
    saved.records[0].cause = 'changed'
    expect(book.active('actor', 10)[0].share).toBe(1)
    expect(book.records()[0].cause).toBe('cause:r1')
    const detached = book.snapshot()
    detached.reservations[0].share = 100
    expect(book.active('actor', 10)[0].share).toBe(1)
  })

  it('rejects duplicate ids, unknown ids and repeated terminal operations without changing state', () => {
    const book = ledger()
    book.reserve(0, request())
    expect(() => book.reserve(0, request())).toThrow('duplicate')
    expect(() => book.release(0, 'unknown')).toThrow('unknown')
    book.release(20, 'r1')
    const before = book.snapshot()
    expect(() => book.release(20, 'r1')).toThrow('already released')
    expect(() => book.fulfil(30, 'r1')).toThrow('already released')
    expect(book.snapshot()).toEqual(before)
  })

  it.each([
    { start: 1.5 }, { end: Infinity }, { start: 30 }, { share: 0 },
    { share: -1 }, { share: NaN }, { share: Infinity }, { cause: '' },
  ])('rejects invalid request fields %j atomically', fields => {
    const book = ledger()
    expect(() => book.reserve(0, { ...request(), ...fields })).toThrow()
    expect(book.records()).toEqual([])
  })

  it.each<Bound>([
    { kind: 'series', steps: [] },
    { kind: 'series', steps: [{ from: 11, value: 1 }] },
    { kind: 'series', steps: [{ from: 0, value: 1 }, { from: 0, value: 2 }] },
    { kind: 'series', steps: [{ from: 0, value: NaN }] },
  ])('refuses malformed or uncovered bound series %j', bound => {
    const book = ledger(bound)
    expect(() => book.reserve(0, request())).toThrow()
    expect(book.records()).toEqual([])
  })

  it('replays canonical-equal records in operation order with causes', () => {
    const run = () => {
      const book = ledger()
      book.reserve(0, request())
      book.release(20, 'r1')
      book.reserve(20, request('replacement', 20, 30))
      book.fulfil(30, 'replacement')
      return book.records()
    }
    const records = run()
    expect(canonical(records)).toBe(canonical(run()))
    expect(records.map(r => [r.operation, r.cause])).toEqual([
      ['reserve', 'cause:r1'], ['release', 'cause:r1'],
      ['reserve', 'cause:replacement'], ['fulfil', 'cause:replacement'],
    ])
  })
})
