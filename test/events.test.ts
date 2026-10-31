import { describe, expect, it, vi } from 'vitest'
import { EventBus, Scheduler, type ScheduledEmission } from '../src/index.ts'

const emission = (overrides: Partial<ScheduledEmission> = {}): ScheduledEmission => ({
  t: 10, phase: 0, position: 0, source: 'first', type: 'changed', payload: { value: 1 }, ...overrides,
})

describe('events: DESIGN 2.3', () => {
  it('events carry explicit causality and counter-minted evt.NNNNNN ids', () => {
    const bus = new EventBus()
    const first = bus.emit(emission({ cause: 'command.1' }))
    expect(first).toEqual({ id: 'evt.000001', t: 10, source: 'first', type: 'changed', payload: { value: 1 }, cause: 'command.1' })
    expect(bus.emit(emission({ cause: first.id })).cause).toBe(first.id)
    expect(bus.emit(emission())).toEqual({ id: 'evt.000003', t: 10, source: 'first', type: 'changed', payload: { value: 1 } })
  })

  it('total order is time, phase index, process position, then emission sequence', () => {
    const bus = new EventBus()
    const inputs = [
      emission(), emission(), emission({ position: 1 }),
      emission({ phase: 1 }), emission({ t: 11 }),
    ]
    const events = inputs.map(bus.emit)
    expect(bus.since(0)).toEqual(events)
    expect(bus.state().records.map(r => [r.event.t, r.phase, r.position, r.sequence])).toEqual([
      [10, 0, 0, 1], [10, 0, 0, 2], [10, 0, 1, 3], [10, 1, 0, 4], [11, 0, 0, 5],
    ])
    expect(() => bus.emit(emission())).toThrow('scheduler order')
    const sameTime = new EventBus()
    sameTime.emit(emission({ phase: 1, position: 2 }))
    expect(() => sameTime.emit(emission({ phase: 0, position: 9 }))).toThrow('scheduler order')
    expect(() => sameTime.emit(emission({ phase: 1, position: 1 }))).toThrow('scheduler order')
  })

  it('later-phase events are hidden from earlier processes at T and visible at T+1', () => {
    const bus = new EventBus()
    const early = bus.emit(emission())
    const late = bus.emit(emission({ phase: 1, position: 1 }))
    expect(bus.since(0, { t: 10, phase: 0, position: 0 })).toEqual([early])
    expect(bus.since(1, { t: 10, phase: 1, position: 0 })).toEqual([])
    expect(bus.since(1, { t: 10, phase: 2, position: 0 })).toEqual([late])
    expect(bus.since(1, { t: 11, phase: 0, position: 0 })).toEqual([late])
    expect(bus.since(0, { t: 9, phase: 9, position: 9 })).toEqual([])
  })

  it('since(cursor) returns an ordered unread suffix without consuming or skipping hidden events', () => {
    const bus = new EventBus()
    bus.emit(emission())
    bus.emit(emission({ phase: 1 }))
    let cursor = 0
    cursor += bus.since(cursor, { t: 10, phase: 0, position: 0 }).length
    expect(cursor).toBe(1)
    expect(bus.since(cursor)).toEqual(bus.since(cursor))
    cursor += bus.since(cursor, { t: 11, phase: 0, position: 0 }).length
    expect(bus.since(cursor)).toEqual([])
  })

  it('scheduler publication invokes no subscribers; later processes explicitly read the queue', () => {
    const bus = new EventBus()
    const read = vi.fn()
    const scheduler = new Scheduler({ emit: bus.emit, order: { phases: ['a', 'b'], order: { a: ['first'], b: ['second'] } } })
    scheduler.register({ id: 'second', phase: 'b', period: 1, mechanisms: [], run: ctx => read(bus.since(0, { t: ctx.t, phase: 1, position: 0 })) })
    scheduler.register({ id: 'first', phase: 'a', period: 1, mechanisms: [], run: ctx => {
      ctx.emit('changed', 42)
      expect(read).not.toHaveBeenCalled()
    } })
    scheduler.runUntil(1)
    expect(read).toHaveBeenCalledExactlyOnceWith([{ id: 'evt.000001', t: 1, source: 'first', type: 'changed', payload: 42 }])
    expect('subscribe' in bus).toBe(false)
  })

  it('state/restore preserves queue, order, counter and subsequent ids across JSON round trips', () => {
    const bus = new EventBus()
    bus.emit(emission())
    const snapshot = JSON.parse(JSON.stringify(bus.state()))
    const restored = new EventBus()
    restored.restore(snapshot)
    expect(restored.state()).toEqual(bus.state())
    expect(restored.emit(emission())).toEqual(bus.emit(emission()))
    expect(restored.since(1)[0].id).toBe('evt.000002')
    restored.restore(snapshot)
    expect(restored.since()).toHaveLength(1)
    expect(restored.emit(emission()).id).toBe('evt.000002')
  })

  it('payloads and snapshots are detached at publication, read and restore boundaries', () => {
    const bus = new EventBus()
    const payload = { value: 1 }
    const event = bus.emit(emission({ payload }))
    payload.value = 2
    ;(event.payload as typeof payload).value = 3
    const read = bus.since()
    ;(read[0].payload as typeof payload).value = 4
    const snapshot = bus.state()
    bus.restore(snapshot)
    ;(snapshot.records[0].event.payload as typeof payload).value = 5
    expect(bus.since()[0].payload).toEqual({ value: 1 })
  })

  it('invalid emissions, cursors and snapshots fail without consuming ids or changing state', () => {
    const bus = new EventBus()
    bus.emit(emission())
    const before = bus.state()
    for (const input of [emission({ t: 0.5 }), emission({ phase: -1 }), emission({ position: Infinity }), emission({ source: '' }), emission({ payload: () => 1 })]) {
      expect(() => bus.emit(input)).toThrow()
      expect(bus.state()).toEqual(before)
    }
    for (const cursor of [-1, 0.5, 2, NaN]) expect(() => bus.since(cursor)).toThrow()
    expect(() => bus.restore({ ...before, counter: 2 })).toThrow()
    expect(() => bus.restore({ counter: 1, records: [{ ...before.records[0], sequence: 2 }] })).toThrow()
    expect(bus.state()).toEqual(before)
    expect(bus.emit(emission()).id).toBe('evt.000002')
  })
})
