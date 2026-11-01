import { describe, expect, it, vi } from 'vitest'
import {
  Scheduler, SECOND, HOUR, DAY, streams, defaultOrder,
  type Process, type ProcessContext, type ProcessOrder, type ScheduledEmission,
} from '../src/index.ts'

const insertion: ProcessOrder = { phases: ['fast'], order: { fast: 'insertion' } }
const process = (id: string, period: number, run: Process['run'] = () => {}): Process =>
  ({ id, mechanisms: [], period, phase: 'fast', run })

describe('simulation scheduler', () => {
  it('P-readonly: record observers run last without creating streams or changing normal draws and emissions', () => {
    const run = (attached: boolean) => {
      const random = streams(42)
      const get = vi.spyOn(random, 'get')
      const events: ScheduledEmission[] = []
      const calls: string[] = []
      const clock = new Scheduler({ rng: random, emit: event => { events.push(event) }, order: {
        phases: defaultOrder.phases,
        order: { ...defaultOrder.order, aggregate: ['aggregate'], record: ['observer'] },
      } })
      if (attached) clock.register({
        ...process('observer', SECOND, ctx => {
          calls.push(`${ctx.t}:record`)
          const before = random.state()
          const accesses = get.mock.calls.length
          for (const id of ['shared', 'observer.only', 'undeclared']) {
            expect(() => ctx.rng(id)).toThrow(new Error('read-only process observer may not use rng'))
          }
          expect(() => ctx.emit('forbidden', {})).toThrow(new Error('read-only process observer may not emit'))
          expect(random.state()).toEqual(before)
          expect(get).toHaveBeenCalledTimes(accesses)
        }),
        phase: 'record', readonly: true, mechanisms: ['shared', 'observer.only'],
      })
      expect(random.state()).toEqual({})
      expect(get).not.toHaveBeenCalled()
      clock.register({ ...process('aggregate', SECOND, ctx => {
        calls.push(`${ctx.t}:aggregate`)
      }), phase: 'aggregate' })
      clock.register({ ...process('realism.step', SECOND, ctx => {
        calls.push(`${ctx.t}:fast`)
        ctx.emit('draw', ctx.rng('shared')(), 'command.1')
      }), mechanisms: ['shared'] })
      clock.runUntil(3 * SECOND)
      get.mockRestore()
      return { events, calls, state: random.state() }
    }
    const detached = run(false)
    const attached = run(true)
    expect(attached.calls).toEqual([1, 2, 3].flatMap(t =>
      ['fast', 'aggregate', 'record'].map(phase => `${t * SECOND}:${phase}`)))
    expect(attached.events).toEqual(detached.events)
    expect(attached.state).toEqual(detached.state)
    const reference = streams(42).get('shared')
    expect(attached.events).toEqual([1, 2, 3].map(t => ({
      t: t * SECOND, source: 'realism.step', phase: 0, position: 0,
      type: 'draw', payload: reference(), cause: 'command.1',
    })))
  })

  it('P-cognition: shared instants run fast before cognition before host before daily processes', () => {
    const clock = new Scheduler({ order: {
      phases: defaultOrder.phases,
      order: { ...defaultOrder.order, cognition: ['cognition.step'], host: ['host.resolve'] },
    } })
    const calls: string[] = []
    for (const [id, phase] of [
      ['economy.tick', 'day.economy'], ['settlement.tick', 'day.settlement'],
      ['host.resolve', 'host'], ['cognition.step', 'cognition'], ['realism.step', 'fast'],
    ]) clock.register({ ...process(id, SECOND, () => { calls.push(id) }), phase })
    clock.runUntil(SECOND)
    expect(calls).toEqual(['realism.step', 'cognition.step', 'host.resolve', 'settlement.tick', 'economy.tick'])
  })

  it('P-default: default JSON puts the finished realism interval before settlement and economy', () => {
    const clock = new Scheduler()
    const calls: string[] = []
    for (const [id, phase] of [
      ['economy.tick', 'day.economy'], ['settlement.tick', 'day.settlement'], ['realism.step', 'fast'],
    ]) clock.register({ ...process(id, DAY, () => { calls.push(id) }), phase })
    clock.runUntil(DAY)
    expect(calls).toEqual(['realism.step', 'settlement.tick', 'economy.tick'])
  })

  it('P-midnight: two days close seconds before hours before days with exact per-process dt', () => {
    const order = {
      phases: ['fast', 'day'], order: { fast: ['second', 'hour'], day: ['daily'] },
    }
    const clock = new Scheduler({ order })
    const midnights: string[][] = [[], []]
    const counts = { second: 0, hour: 0, daily: 0 }
    let badDt = false
    let badOrder = false
    let lastSecond = 0, lastHour = 0
    const run = (id: keyof typeof counts, period: number) => ({ t, dt }: ProcessContext) => {
      counts[id]++
      if (dt !== period || clock.t !== t) badDt = true
      if (id === 'second') lastSecond = t
      if (id === 'hour') { if (lastSecond !== t) badOrder = true; lastHour = t }
      if (id === 'daily' && lastHour !== t) badOrder = true
      if (t % DAY === 0) midnights[t / DAY - 1].push(id)
    }
    clock.register({ ...process('daily', DAY, run('daily', DAY)), phase: 'day' })
    clock.register(process('hour', HOUR, run('hour', HOUR)))
    clock.register(process('second', SECOND, run('second', SECOND)))
    clock.runUntil(2 * DAY)
    expect(midnights).toEqual([['second', 'hour', 'daily'], ['second', 'hour', 'daily']])
    expect(counts).toEqual({ second: 172_800, hour: 48, daily: 2 })
    expect(badDt).toBe(false)
    expect(badOrder).toBe(false)
    expect(clock.t).toBe(2 * DAY)
  })

  it('P-order: phase then position governs simultaneous processes across every period bucket', () => {
    const clock = new Scheduler({
      order: { phases: ['z', 'a'], order: { z: ['first', 'second'], a: ['third', 'fourth'] } },
    })
    const calls: string[] = []
    for (const [id, phase, period] of [
      ['fourth', 'a', 1], ['second', 'z', 2], ['third', 'a', 2], ['first', 'z', 1],
    ] as const) clock.register({ ...process(id, period, ({ t }) => { if (t === 2) calls.push(id) }), phase })
    clock.runUntil(2)
    expect(calls).toEqual(['first', 'second', 'third', 'fourth'])
  })

  it('P-registration: missing order entries and duplicate ids throw during registration', () => {
    const clock = new Scheduler()
    expect(() => clock.register(process('unknown', 1))).toThrow('absent from order')
    clock.register(process('realism.step', 1))
    expect(() => clock.register(process('realism.step', 1))).toThrow('duplicate process id')
    expect(() => clock.register({ ...process('other', 1), phase: 'missing' })).toThrow('unknown phase')
  })

  it('P-insertion: engine processes retain the order added within an insertion phase', () => {
    const clock = new Scheduler({ order: insertion })
    const calls: string[] = []
    for (const [id, period] of [['z', 2], ['a', 1], ['m', 2]] as const) {
      clock.register(process(id, period, () => { calls.push(id) }))
    }
    clock.runUntil(2)
    expect(calls).toEqual(['a', 'z', 'a', 'm'])
  })

  it('P-endpoint: runUntil stops exactly at T, includes due work, and resumes without skipped or repeated runs', () => {
    const clock = new Scheduler({ order: insertion })
    const calls: number[][] = []
    clock.register(process('p', 10, ({ t, dt }) => { calls.push([t, dt]) }))
    for (const target of [0, 7, 10, 10, 24, 30]) {
      clock.runUntil(target)
      expect(clock.t).toBe(target)
    }
    expect(calls).toEqual([[10, 10], [20, 10], [30, 10]])
    const empty = new Scheduler()
    empty.runUntil(17)
    expect(empty.t).toBe(17)
  })

  it('P-offset: offsets align due instants, defer activation, and first dt starts at registration', () => {
    const clock = new Scheduler({ order: insertion, start: 3 })
    const calls: Record<string, number[][]> = { early: [], late: [], added: [] }
    for (const [id, offset] of [['early', 5], ['late', 25]] as const) {
      clock.register({ ...process(id, 10, ({ t, dt }) => { calls[id].push([t, dt]) }), offset })
    }
    clock.runUntil(22)
    clock.register({ ...process('added', 10, ({ t, dt }) => { calls.added.push([t, dt]) }), offset: 5 })
    clock.runUntil(35)
    expect(calls).toEqual({ early: [[5, 2], [15, 10], [25, 10], [35, 10]], late: [[25, 22], [35, 10]], added: [[25, 3], [35, 10]] })
  })

  it('P-buckets: many offset groups match a simple integer reference ordered by phase and position', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `p${i}`)
    const order = { phases: ['first', 'last'], order: { first: ids.slice(0, 60), last: ids.slice(60) } }
    const clock = new Scheduler({ order })
    const definitions = ids.map((id, i) => ({ id, period: [7, 13, 19][i % 3], offset: i % 37, phase: i < 60 ? 'first' : 'last' }))
    const actual: string[] = []
    for (const definition of [...definitions].reverse()) {
      clock.register({ ...definition, mechanisms: [], run: ({ t }) => { actual.push(`${t}:${definition.id}`) } })
    }
    const expected: string[] = []
    for (let t = 1; t <= 300; t++) {
      for (const p of definitions) if (t >= p.offset && (t - p.offset) % p.period === 0) expected.push(`${t}:${p.id}`)
    }
    clock.runUntil(147)
    clock.runUntil(300)
    expect(actual).toEqual(expected)
  })

  it('P-safe: invalid times, nonpositive periods and backwards targets are rejected', () => {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new Scheduler({ start: value })).toThrow()
      const clock = new Scheduler({ order: insertion })
      expect(() => clock.register(process('p', value))).toThrow()
      expect(() => clock.register({ ...process('p', 1), offset: value })).toThrow()
      expect(() => clock.runUntil(value)).toThrow()
      expect(clock.t).toBe(0)
    }
    const clock = new Scheduler({ order: insertion })
    expect(() => clock.register(process('p', 0))).toThrow('positive')
    clock.runUntil(10)
    expect(() => clock.runUntil(9)).toThrow('precede')
  })

  it('P-safe-end: reaching MAX_SAFE_INTEGER never schedules rounded or overflowing instants', () => {
    const max = Number.MAX_SAFE_INTEGER
    const clock = new Scheduler({ order: insertion, start: max - 3 })
    const times: number[] = []
    clock.register({ ...process('p', 2, ({ t }) => { times.push(t) }), offset: max - 1 })
    clock.runUntil(max)
    clock.runUntil(max)
    expect(times).toEqual([max - 1])
    expect(clock.t).toBe(max)
  })

  it('P-wall-clock: scheduling reads neither Date.now nor performance.now nor Math.random', () => {
    const fail = () => { throw new Error('nondeterministic clock or random read') }
    const spies = [vi.spyOn(Date, 'now').mockImplementation(fail), vi.spyOn(performance, 'now').mockImplementation(fail), vi.spyOn(Math, 'random').mockImplementation(fail)]
    let t: number
    try {
      const clock = new Scheduler({ order: insertion })
      clock.register(process('p', 1))
      clock.runUntil(10)
      t = clock.t
    } finally { for (const spy of spies) spy.mockRestore() }
    expect(t!).toBe(10)
  })

  it('P-context: declared mechanism RNG streams and event sink carry deterministic process metadata', () => {
    const events: ScheduledEmission[] = []
    const random = streams(42)
    const reference = streams(42).get('engine.mechanism')
    const clock = new Scheduler({ order: insertion, rng: random, emit: event => { events.push(event) } })
    clock.register({ ...process('p', 10, ctx => {
      expect(ctx.rng('engine.mechanism')()).toBe(reference())
      expect(() => ctx.rng('unknown')).toThrow('undeclared mechanism')
      ctx.emit('tick', ctx.dt, 'command.1')
    }), mechanisms: ['engine.mechanism'] })
    clock.runUntil(20)
    expect(events).toEqual([10, 20].map(t => ({ t, source: 'p', phase: 0, position: 0, type: 'tick', payload: 10, cause: 'command.1' })))
  })

  it('P-failure: callback failure propagates and cannot silently replay partially completed work', () => {
    const clock = new Scheduler({ order: insertion })
    clock.register(process('p', 1, () => { throw new Error('host failure') }))
    expect(() => clock.runUntil(2)).toThrow('host failure')
    expect(clock.t).toBe(1)
    expect(() => clock.runUntil(2)).toThrow('after failure')
    expect(() => clock.register(process('other', 1))).toThrow('after failure')
  })

  it('P-emission: emitting without a host sink throws instead of silently losing events', () => {
    const clock = new Scheduler({ order: insertion })
    clock.register(process('p', 1, ctx => ctx.emit('tick', {})))
    expect(() => clock.runUntil(1)).toThrow('requires an event sink')
  })

  it('P-reentrancy: callbacks cannot register or advance time within an active instant', () => {
    const clock = new Scheduler({ order: insertion })
    clock.register(process('p', 1, () => {
      expect(() => clock.register(process('other', 1))).toThrow('while running')
      expect(() => clock.runUntil(3)).toThrow('recursively')
    }))
    clock.runUntil(1)
  })

  it('P-perf: 2 592 000 instants with three periods and no-op processes finish under 2 seconds', () => {
    const clock = new Scheduler({ order: insertion })
    clock.register(process('second', SECOND)).register(process('hour', HOUR)).register(process('day', DAY))
    const start = performance.now()
    clock.runUntil(30 * DAY)
    const elapsed = performance.now() - start
    expect(clock.t).toBe(30 * DAY)
    expect(elapsed).toBeLessThan(2_000)
  })
})
