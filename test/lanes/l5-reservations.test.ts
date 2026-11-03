// Test doubles only: arbitrary bounds and shares; no Life or Cognition semantics.
import { describe, expect, it } from 'vitest'
import {
  canonical, MINUTE, ReservationLedger, Scheduler, transaction, type Bound,
} from '../../src/index.ts'

const fixtureBound: Bound = { kind: 'series', steps: [{ from: 0, value: 1 }] }
const fixtureUnbounded: Bound = { kind: 'unbounded', evidence: 'fixture' }

function ledger(bound: Bound | undefined = fixtureBound) {
  return new ReservationLedger({ bound: () => bound })
}

function req(
  id: string,
  start: number,
  end: number,
  share = 1,
  actor = 'actor.fixture',
) {
  return { id, actor, cause: `cause:${id}`, start, end, share }
}

describe('L5 time reservations (PLAN §7a)', () => {
  it('admits a reservation within the bound and overlapping shares up to B_p(t)', () => {
    const book = ledger()
    expect(book.reserve(0, req('a', 10, 30, 0.5))).toMatchObject({ status: 'reserved', share: 0.5 })
    expect(book.reserve(0, req('b', 20, 40, 0.5))).toMatchObject({ status: 'reserved', share: 0.5 })
    expect(book.active('actor.fixture', 25).map(r => r.id).sort()).toEqual(['a', 'b'])
  })

  it('refuses one share over the bound with canonical state unchanged', () => {
    const book = ledger()
    book.reserve(0, req('held', 10, 30, 0.75))
    const before = canonical(book.snapshot())
    expect(() => book.reserve(0, req('excess', 15, 25, 0.26)))
      .toThrow('bound exceeded for actor.fixture')
    expect(canonical(book.snapshot())).toBe(before)
  })

  it('refuses a reservation starting before now', () => {
    const book = ledger()
    expect(() => book.reserve(11, req('past', 10, 30))).toThrow('past')
    expect(book.records()).toEqual([])
  })

  it('release mid-interval frees only [now, end) and records elapsed share time', () => {
    const book = ledger()
    book.reserve(0, req('r1', 10, 30))
    expect(book.release(20, 'r1')).toMatchObject({
      status: 'released', fulfilledMs: 10, releasedAt: 20,
    })
    book.reserve(20, req('replacement', 20, 30))
    expect(book.active('actor.fixture', 20).map(r => r.id)).toEqual(['replacement'])
    expect(book.active('actor.fixture', 25).map(r => r.id)).toEqual(['replacement'])
    expect(book.active('actor.fixture', 30)).toEqual([])
  })

  it('fulfil records exactly the elapsed interval', () => {
    const book = ledger()
    book.reserve(0, req('r1', 10, 30))
    expect(book.fulfil(30, 'r1')).toMatchObject({ status: 'fulfilled', fulfilledMs: 20 })
    expect(book.records().at(-1)).toMatchObject({ operation: 'fulfil', fulfilledMs: 20 })
  })

  it('drops a reservation made inside a rolled-back transaction', () => {
    const book = ledger()
    book.reserve(0, req('kept', 10, 30))
    const before = book.snapshot()
    expect(() => transaction([book], () => {
      book.reserve(0, req('temporary', 30, 40))
      throw new Error('rollback')
    })).toThrow('rollback')
    expect(book.snapshot()).toEqual(before)
    expect(book.active('actor.fixture', 15).map(r => r.id)).toEqual(['kept'])
  })

  it('refuses a missing bound by name and admits an explicit unbounded fixture', () => {
    const missing = new ReservationLedger({ bound: () => undefined })
    expect(() => missing.reserve(0, req('x', 0, 10))).toThrow('missing bound for actor.fixture')
    expect(missing.snapshot()).toEqual({ reservations: [], records: [] })
    const open = ledger(fixtureUnbounded)
    expect(open.reserve(0, req('large', 0, 100, 1000)).share).toBe(1000)
  })

  it('replays the same operation sequence to canonical-equal records', () => {
    const run = () => {
      const book = ledger()
      book.reserve(0, req('r1', 10, 30))
      book.release(20, 'r1')
      book.reserve(20, req('r2', 20, 40))
      book.fulfil(40, 'r2')
      return book.records()
    }
    expect(canonical(run())).toBe(canonical(run()))
  })

  it('under Scheduler: 60 s process reserves the next minute; overlap within bound passes, over fails', () => {
    const book = new ReservationLedger({
      bound: () => ({ kind: 'series', steps: [{ from: 0, value: 1 }] }),
    })
    const laneOrder = { phases: ['lane'], order: { lane: ['lane.periodic', 'lane.contender'] } } as const
    const clock = new Scheduler({ order: laneOrder })
    let overlapAdmitted = false
    let overlapRefused = false

    clock.register({
      id: 'lane.periodic', mechanisms: [], period: MINUTE, phase: 'lane',
      run: ({ t }) => {
        book.reserve(t, req(`period-${t}`, t, t + MINUTE, 0.5, 'actor.periodic'))
      },
    })
    clock.register({
      id: 'lane.contender', mechanisms: [], period: MINUTE, phase: 'lane',
      run: ({ t }) => {
        const overlapStart = t
        const overlapEnd = t + MINUTE
        book.reserve(t, req(`contender-base-${t}`, overlapStart, overlapEnd, 0.5, 'actor.contender'))
        book.reserve(t, req(`contender-overlap-${t}`, overlapStart, overlapEnd, 0.5, 'actor.contender'))
        overlapAdmitted = true
        const before = canonical(book.snapshot())
        expect(() => book.reserve(
          t, req(`contender-excess-${t}`, overlapStart, overlapEnd, 0.01, 'actor.contender'),
        )).toThrow('bound exceeded for actor.contender')
        expect(canonical(book.snapshot())).toBe(before)
        overlapRefused = true
      },
    })

    clock.runUntil(3 * MINUTE)

    expect(overlapAdmitted).toBe(true)
    expect(overlapRefused).toBe(true)
    expect(book.records().filter(r => r.operation === 'reserve' && r.actor === 'actor.periodic').length)
      .toBeGreaterThanOrEqual(2)
  })
})
