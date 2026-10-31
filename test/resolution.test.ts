import { describe, expect, it } from 'vitest'
import {
  ResolutionService, Scheduler, streams, switchTo, transaction,
  type Participant, type Process, type Resolution,
} from '../src/index.ts'

interface Village { people: number; grainKg: number; label?: string }
interface Person { grainKg: number; draw: number }

const village: Resolution<Village, Person[]> = {
  id: 'village',
  conserved: [
    { quantity: 'population.count', unit: 'person', tolerance: 0 },
    { quantity: 'stores.mass', unit: 'kg', tolerance: 0.001 },
  ],
  coarsen: individuals => ({
    people: individuals.length,
    grainKg: individuals.reduce((sum, person) => sum + person.grainKg, 0),
    label: 'coarsened',
  }),
  refine: (aggregate, rng) => Array.from({ length: aggregate.people }, () => ({
    grainKg: aggregate.grainKg / aggregate.people, draw: rng(),
  })),
}

function fixture(resolution = village, participants: readonly Participant[] = []) {
  const rng = streams(42)
  const scheduler = new Scheduler({
    order: { phases: ['simulation'], order: { simulation: ['coarse', 'fine', 'fine.later', 'other'] } }, rng,
  })
  const service = new ResolutionService({
    resolution, scheduler, rng, mechanismId: 'village.refine', participants,
    initial: { mode: 'coarse', aggregate: { people: 4, grainKg: 20, label: 'original' } },
    // Registry ids need not be property names; the fixture owns the mapping.
    quantity: (a, quantity) => quantity === 'population.count' ? a.people : a.grainKg,
  })
  const calls: { id: string; t: number; dt: number }[] = []
  const process = (id: string, period: number, run?: Process['run']): Process => ({
    id, period, phase: 'simulation', mechanisms: [],
    run: ctx => { calls.push({ id, t: ctx.t, dt: ctx.dt }); run?.(ctx) },
  })
  service.register('coarse', process('coarse', 10))
  service.register('fine', process('fine', 4))
  return { service, scheduler, rng, calls, process }
}

describe('resolution hand-off rules', () => {
  it('R-refine: owner-defined count and mass survive refinement within each declared tolerance', () => {
    const { service, scheduler } = fixture()
    scheduler.runUntil(10)
    const result = switchTo(service, 'fine', 10)
    expect(result.mode).toBe('fine')
    if (result.mode !== 'fine') throw new Error('expected fine')
    expect(result.individuals).toHaveLength(4)
    expect(village.coarsen(result.individuals)).toEqual({ people: 4, grainKg: 20, label: 'coarsened' })
    expect(result.individuals.map(p => p.draw)).toEqual(
      Array.from({ length: 4 }, streams(42).get('village.refine')),
    )
  })

  it('R-boundary: old processes close T; only the new set runs after T with dt since activation', () => {
    const { service, scheduler, calls, process } = fixture()
    service.register('fine', { ...process('fine.later', 6), offset: 1 })
    scheduler.register(process('other', 10))
    scheduler.runUntil(10)
    service.switchTo('fine', 10)
    scheduler.runUntil(20)
    service.switchTo('coarse', 20)
    scheduler.runUntil(30)
    expect(calls).toEqual([
      { id: 'coarse', t: 10, dt: 10 }, { id: 'other', t: 10, dt: 10 },
      { id: 'fine', t: 12, dt: 2 }, { id: 'fine.later', t: 13, dt: 3 },
      { id: 'fine', t: 16, dt: 4 }, { id: 'fine.later', t: 19, dt: 6 },
      { id: 'fine', t: 20, dt: 4 }, { id: 'other', t: 20, dt: 10 },
      { id: 'coarse', t: 30, dt: 10 }, { id: 'other', t: 30, dt: 10 },
    ])
  })

  it('R-coarsen: the entire aggregate equals coarsen(individuals) exactly, including nonconserved fields', () => {
    const { service } = fixture()
    const fine = service.switchTo('fine', 0)
    if (fine.mode !== 'fine') throw new Error('expected fine')
    fine.individuals[0].grainKg = 7.123456789
    fine.individuals.push({ grainKg: 1, draw: 0 })
    const expected = village.coarsen(fine.individuals)
    expect(service.switchTo('coarse', 0)).toEqual({ mode: 'coarse', aggregate: expected })
  })

  it('R-loss: a refine dropping one person throws, restores state and RNG, and leaves coarse processes active', () => {
    let drop = true
    const { service, scheduler, calls, rng } = fixture({
      ...village,
      refine(a, random) {
        const people = village.refine(a, random)
        if (drop) people.pop()
        return people
      },
    })
    scheduler.runUntil(10)
    const before = service.snapshot()
    expect(() => service.switchTo('fine', 10)).toThrow('population.count')
    expect(service.snapshot()).toEqual(before)
    scheduler.runUntil(20)
    expect(calls.map(call => call.id)).toEqual(['coarse', 'coarse'])
    drop = false
    service.switchTo('fine', 20)
    const reference = fixture()
    reference.service.switchTo('fine', 0)
    expect(service.state).toEqual(reference.service.state)
    expect(rng.state()).toEqual(reference.rng.state())
  })

  it.each([0.5, -0.5])('R-tolerance: an absolute error of %s at the tolerance boundary is allowed', delta => {
    const { service } = fixture({
      ...village,
      conserved: village.conserved.map(row => ({ ...row, tolerance: row.unit === 'kg' ? 0.5 : 0 })),
      refine: (a, rng) => village.refine({ ...a, grainKg: a.grainKg + delta }, rng),
    })
    expect(() => service.switchTo('fine', 0)).not.toThrow()
  })

  it('R-every-quantity: conserved count alone cannot hide mass outside its own tolerance', () => {
    const { service } = fixture({
      ...village, refine: (a, rng) => village.refine({ ...a, grainKg: a.grainKg + 0.01 }, rng),
    })
    expect(() => service.switchTo('fine', 0)).toThrow('stores.mass')
    expect(service.mode).toBe('coarse')
  })

  it.each([NaN, Infinity, -Infinity])('R-finite: nonfinite conserved values (%s) cannot bypass the check', grainKg => {
    const { service } = fixture({ ...village, coarsen: i => ({ ...village.coarsen(i), grainKg }) })
    expect(() => service.switchTo('fine', 0)).toThrow('quantity stores.mass')
    expect(service.mode).toBe('coarse')
  })

  it.each([-1, NaN, Infinity])('R-declaration: invalid tolerance %s is rejected before registration', tolerance => {
    expect(() => fixture({ ...village, conserved: [{ quantity: 'q', unit: 'kg', tolerance }] }))
      .toThrow('conserved tolerance')
  })

  it('R-isolation: mutating converters cannot corrupt the baseline or the successful fine state', () => {
    const bad = fixture({
      ...village,
      refine(a, rng) { a.people--; return village.refine(a, rng) },
    })
    expect(() => bad.service.switchTo('fine', 0)).toThrow('population.count')
    expect(bad.service.state).toEqual({ mode: 'coarse', aggregate: { people: 4, grainKg: 20, label: 'original' } })
    const good = fixture({
      ...village,
      coarsen(i) { const a = village.coarsen(i); i.pop(); return a },
    })
    const fine = good.service.switchTo('fine', 0)
    expect(fine.mode === 'fine' && fine.individuals.length).toBe(4)
  })

  it('R-transaction: converter exceptions restore enlisted external state and events', () => {
    const events = ['before']
    const participant: Participant = {
      id: 'events', snapshot: () => [...events],
      restore: saved => { events.splice(0, events.length, ...saved as string[]) },
    }
    const { service } = fixture({
      ...village,
      refine(a, rng) { village.refine(a, rng); events.push('refine'); throw new Error('owner failed') },
    }, [participant])
    const before = service.snapshot()
    expect(() => service.switchTo('fine', 0)).toThrow('owner failed')
    expect(service.snapshot()).toEqual(before)
    expect(events).toEqual(['before'])
  })

  it('R-coarsen-rollback: a throwing coarsener restores individuals and keeps fine processes active', () => {
    let fail = false
    const { service, scheduler, calls } = fixture({
      ...village,
      coarsen(i) { if (fail) { i.pop(); throw new Error('cannot coarsen') }; return village.coarsen(i) },
    })
    service.switchTo('fine', 0)
    scheduler.runUntil(5)
    const before = service.snapshot()
    fail = true
    expect(() => service.switchTo('coarse', 5)).toThrow('cannot coarsen')
    expect(service.snapshot()).toEqual(before)
    scheduler.runUntil(12)
    expect(calls).toEqual([4, 8, 12].map(t => ({ id: 'fine', t, dt: 4 })))
  })

  it('R-outer-transaction: a later failure restores the representation, RNG and active-process dt', () => {
    const { service, scheduler, calls } = fixture()
    scheduler.runUntil(10)
    const before = service.snapshot()
    expect(() => transaction([service], () => {
      service.switchTo('fine', 10)
      throw new Error('later failure')
    })).toThrow('later failure')
    expect(service.snapshot()).toEqual(before)
    scheduler.runUntil(20)
    expect(calls).toEqual([10, 20].map(t => ({ id: 'coarse', t, dt: 10 })))
  })

  it('R-instant: even unrelated callbacks cannot switch modes midway through an instant', () => {
    const { service, scheduler, calls, process } = fixture()
    scheduler.register(process('other', 10, ({ t }) => {
      expect(() => service.switchTo('fine', t)).toThrow('recursively')
    }))
    scheduler.runUntil(20)
    expect(service.mode).toBe('coarse')
    expect(calls.map(c => c.id)).toEqual(['coarse', 'other', 'coarse', 'other'])
  })

  it('R-time: past, future and invalid switch times are rejected without advancing the scheduler', () => {
    const { service, scheduler } = fixture()
    scheduler.runUntil(5)
    for (const t of [0, 6, -1, 0.5, NaN, Infinity]) {
      expect(() => service.switchTo('fine', t)).toThrow()
      expect(scheduler.t).toBe(5)
      expect(service.mode).toBe('coarse')
    }
    service.switchTo('fine', 5)
  })

  it('R-noop: switching to the active mode never reconverts data or resets process dt', () => {
    const { service, scheduler, calls } = fixture()
    scheduler.runUntil(5)
    const before = service.snapshot()
    expect(service.switchTo('coarse', 5)).toBe(service.state)
    expect(service.snapshot()).toEqual(before)
    scheduler.runUntil(10)
    expect(calls).toEqual([{ id: 'coarse', t: 10, dt: 10 }])
  })
})
