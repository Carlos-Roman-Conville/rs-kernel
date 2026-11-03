import { describe, expect, it } from 'vitest'
import { defaultOrder, Order, type ProcessOrder } from '../src/index.ts'

describe('declared process order', () => {
  it('O-default: default data orders fast, cognition, host, settlement, economy, aggregate, record and names engine processes', () => {
    expect(defaultOrder.phases).toEqual(['fast', 'cognition', 'host', 'day.settlement', 'day.economy', 'aggregate', 'record', 'check'])
    expect(defaultOrder.order.check).toEqual(['kernel.reconcile'])
    expect(defaultOrder.order.record).toEqual([])
    expect(defaultOrder.order.cognition).toEqual([])
    expect(defaultOrder.order.host).toEqual([])
    const order = new Order()
    expect(order.register('check', 'kernel.reconcile')).toEqual({ phase: 7, position: 0 })
    expect(order.register('fast', 'realism.step')).toEqual({ phase: 0, position: 0 })
    expect(order.register('day.settlement', 'settlement.tick')).toEqual({ phase: 3, position: 0 })
    expect(order.register('day.economy', 'economy.tick')).toEqual({ phase: 4, position: 0 })
    expect(() => order.register('aggregate', 'village')).toThrow('absent from order')
  })

  it('O-declared: explicit positions ignore registration order and missing phases/orders reject processes', () => {
    const order = new Order({ phases: ['later', 'earlier', 'empty'], order: { later: ['b', 'a'] } })
    expect(order.register('later', 'a')).toEqual({ phase: 0, position: 1 })
    expect(order.register('later', 'b')).toEqual({ phase: 0, position: 0 })
    expect(() => order.register('missing', 'a')).toThrow('unknown phase')
    expect(() => order.register('earlier', 'a')).toThrow('absent from order')
    expect(() => order.register('empty', 'a')).toThrow('absent from order')
  })

  it('O-insertion: only an explicitly insertion-ordered phase assigns positions in registration order', () => {
    const order = new Order({ phases: ['fast'], order: { fast: 'insertion' } })
    expect(order.register('fast', 'z')).toEqual({ phase: 0, position: 0 })
    expect(order.register('fast', 'a')).toEqual({ phase: 0, position: 1 })
  })

  it('O-stable: compiled order is detached from mutable host data and defaults are frozen', () => {
    const data = { phases: ['fast'], order: { fast: ['a', 'b'] } }
    const order = new Order(data)
    data.phases.reverse()
    data.order.fast.reverse()
    expect(order.register('fast', 'a').position).toBe(0)
    expect(Object.isFrozen(defaultOrder)).toBe(true)
    expect(Object.isFrozen(defaultOrder.phases)).toBe(true)
    expect(Object.isFrozen(defaultOrder.order.fast)).toBe(true)
  })

  it('O-unambiguous: duplicate phases/processes and undeclared order phases are rejected', () => {
    const invalid: ProcessOrder[] = [
      { phases: ['a', 'a'], order: {} },
      { phases: ['a'], order: { a: ['p', 'p'] } },
      { phases: ['a', 'b'], order: { a: ['p'], b: ['p'] } },
      { phases: ['a'], order: { b: [] } },
      { phases: [''], order: {} },
    ]
    for (const order of invalid) expect(() => new Order(order)).toThrow()
  })
})
