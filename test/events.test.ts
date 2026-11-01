import { describe, expect, it, vi } from 'vitest'
import { EventBus, Scheduler, type ScheduledEmission, type EventContract, type PayloadField } from '../src/index.ts'

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

  it('recordsSince returns the unread state records including scheduler metadata', () => {
    const bus = new EventBus()
    expect(bus.recordsSince()).toEqual([])
    ;[emission(), emission(), emission({ position: 1 }), emission({ phase: 1 }), emission({ t: 11 })].forEach(bus.emit)
    const records = bus.state().records
    expect(bus.recordsSince()).toEqual(records)
    for (let cursor = 0; cursor <= records.length; cursor++) {
      expect(bus.recordsSince(cursor)).toEqual(records.slice(cursor))
      for (const reader of [
        { t: 9, phase: 9, position: 9 }, { t: 10, phase: 0, position: 0 },
        { t: 10, phase: 0, position: 1 }, { t: 10, phase: 1, position: 0 },
        { t: 11, phase: 0, position: 0 },
      ]) {
        expect(bus.recordsSince(cursor, reader).map(record => record.event)).toEqual(bus.since(cursor, reader))
      }
    }
  })

  it('recordsSince detaches records, events and nested payloads from the queue', () => {
    const bus = new EventBus()
    bus.emit(emission())
    const before = bus.state().records
    const records = bus.recordsSince()
    Object.assign(records[0], { phase: 9, position: 9, sequence: 9 })
    Object.assign(records[0].event, { source: 'mutated' })
    ;(records[0].event.payload as { value: number }).value = 9
    records.pop()
    expect(bus.recordsSince(0)).toEqual(before)
  })

  it('recordsSince rejects invalid cursors and readers including cursors beyond the queue', () => {
    const bus = new EventBus()
    bus.emit(emission())
    expect(() => bus.recordsSince(2)).toThrow('event cursor is beyond the queue')
    for (const cursor of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => bus.recordsSince(cursor)).toThrow('event cursor must be a non-negative safe integer')
    }
    for (const reader of [
      { t: 0.5, phase: 0, position: 0 }, { t: 10, phase: -1, position: 0 },
      { t: 10, phase: 0, position: Infinity },
    ]) expect(() => bus.recordsSince(0, reader)).toThrow()
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

describe('advisory event contracts', () => {
  const contract = (payload: Record<string, PayloadField> = {}): EventContract => ({
    type: 'changed', producer: 'first', consumers: [], cause: 'optional', payload,
  })
  const setup = (row = contract()) => {
    const onViolation = vi.fn()
    const bus = new EventBus({ contracts: new Map([[row.type, row]]), onViolation })
    return { bus, onViolation }
  }

  it('reports unknown types and still emits unchanged events', () => {
    const { bus, onViolation } = setup()
    const event = bus.emit(emission({ type: 'unknown' }))
    expect(onViolation).toHaveBeenCalledExactlyOnceWith('warning: unknown: unknown event type', event)
    expect(bus.since()).toEqual([event])
  })

  it.each([null, {}, { value: undefined }])('reports required fields missing from %s', payload => {
    const { bus, onViolation } = setup(contract({ value: { kind: 'number', required: true } }))
    const event = bus.emit(emission({ payload }))
    expect(onViolation).toHaveBeenCalledExactlyOnceWith('warning: changed: missing required field value', event)
    expect(event.payload).toEqual(payload)
  })

  it.each([
    ['number', 1.5, '1'], ['number', 0, Infinity], ['number', -1, NaN],
    ['integer', 2, 1.5], ['string', '', 1], ['boolean', false, 0],
    ['id', 'entity.1', '  '], ['id', 'entity.1', 1],
    ['list', [], {}],
    ['record', { nested: { arbitrary: [1, null] } }, []], ['record', {}, null],
    ['record', {}, 'record'],
  ] as [PayloadField['kind'], unknown, unknown][])('checks %s values without rejecting delivery', (kind, valid, invalid) => {
    const { bus, onViolation } = setup(contract({ value: { kind, required: true } }))
    bus.emit(emission({ payload: { value: valid } }))
    expect(onViolation).not.toHaveBeenCalled()
    const event = bus.emit(emission({ payload: { value: invalid } }))
    expect(onViolation).toHaveBeenCalledExactlyOnceWith(
      `warning: changed: field value has wrong kind (expected ${kind})`, event)
    expect(bus.since()).toHaveLength(2)
  })

  it('checks list elements and accepts absent optional fields and extra fields', () => {
    const { bus, onViolation } = setup(contract({ ids: { kind: 'list', of: 'id', required: false } }))
    for (const payload of [{}, { extra: true }, { ids: [] }, { ids: ['a'] }]) bus.emit(emission({ payload }))
    expect(onViolation).not.toHaveBeenCalled()
    bus.emit(emission({ payload: { ids: ['a', 3] } }))
    expect(onViolation).toHaveBeenCalledOnce()
  })

  it.each([null, [], 1, 'record'])('warns for non-record list element %s', invalid => {
    const { bus, onViolation } = setup(contract({ value: { kind: 'list', of: 'record', required: true } }))
    for (const value of [[], [{}, { arbitrary: [null, 1] }]]) bus.emit(emission({ payload: { value } }))
    expect(onViolation).not.toHaveBeenCalled()
    const event = bus.emit(emission({ payload: { value: [{}, invalid] } }))
    expect(onViolation).toHaveBeenCalledExactlyOnceWith('warning: changed: field value has wrong kind (expected list)', event)
  })

  it.each(['number', 'integer', 'string', 'boolean', 'id', 'list', 'record'] as const)('accepts nullable null for %s', kind => {
    const { bus, onViolation } = setup(contract({ value: { kind, nullable: true, required: true } }))
    bus.emit(emission({ payload: { value: null } }))
    expect(onViolation).not.toHaveBeenCalled()
  })

  it.each([undefined, false])('warns for null when nullable is %s', nullable => {
    const { bus, onViolation } = setup(contract({ value: { kind: 'number', nullable, required: true } }))
    const event = bus.emit(emission({ payload: { value: null } }))
    expect(onViolation).toHaveBeenCalledExactlyOnceWith('warning: changed: field value has wrong kind (expected number)', event)
  })

  it.each([{}, { value: undefined }])('requires nullable fields in %s', payload => {
    const { bus, onViolation } = setup(contract({ value: { kind: 'record', nullable: true, required: true } }))
    const event = bus.emit(emission({ payload }))
    expect(onViolation).toHaveBeenCalledExactlyOnceWith('warning: changed: missing required field value', event)
  })

  it('still checks non-null values of nullable fields', () => {
    const { bus, onViolation } = setup(contract({ value: { kind: 'record', nullable: true, required: true } }))
    const event = bus.emit(emission({ payload: { value: [] } }))
    expect(onViolation).toHaveBeenCalledExactlyOnceWith('warning: changed: field value has wrong kind (expected record)', event)
  })

  it('reports missing required cause but accepts an explicit cause', () => {
    const { bus, onViolation } = setup({ ...contract(), cause: 'required' })
    const event = bus.emit(emission())
    expect(onViolation).toHaveBeenCalledExactlyOnceWith('warning: changed: missing required cause', event)
    bus.emit(emission({ cause: event.id }))
    expect(onViolation).toHaveBeenCalledOnce()
  })

  it('keeps no-contract behaviour and defaults the diagnostic hook to a no-op', () => {
    const onViolation = vi.fn()
    const input = emission({ type: 'arbitrary', payload: null })
    const baseline = new EventBus().emit(input)
    expect(new EventBus({ onViolation }).emit(input)).toEqual(baseline)
    expect(onViolation).not.toHaveBeenCalled()
    expect(new EventBus({ contracts: new Map() }).emit(input)).toEqual(baseline)
  })

  it('isolates hook mutations and exceptions from stored and returned events', () => {
    const bus = new EventBus({ contracts: new Map(), onViolation: (_message, event) => {
      (event.payload as { value: number }).value = 99
      throw new Error('host hook')
    } })
    const event = bus.emit(emission())
    expect(event.payload).toEqual({ value: 1 })
    expect(bus.since()).toEqual([event])
  })

  it('restore does not call the hook and subsequent emissions still check contracts', () => {
    const original = new EventBus()
    original.emit(emission({ type: 'unknown' }))
    const { bus, onViolation } = setup()
    bus.restore(original.state())
    expect(onViolation).not.toHaveBeenCalled()
    expect(bus.state()).toEqual(original.state())
    expect(bus.emit(emission({ type: 'unknown' })).id).toBe('evt.000002')
    expect(onViolation).toHaveBeenCalledOnce()
  })
})
