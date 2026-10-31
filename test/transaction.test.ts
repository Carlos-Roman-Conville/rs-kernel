import { describe, expect, it } from 'vitest'
import { Runner, transaction, type Participant } from '../src/index.ts'

function counter(id: string) {
  const runner = new Runner<{ value: number }, number, { state: { value: number }; events: number[] }, number>(
    { value: 0 }, (state, amount) => ({ state: { value: state.value + amount }, events: [amount] }),
  )
  interface Snapshot { state: { value: number }; log: number; events: number }
  const participant: Participant = {
    id,
    snapshot: (): Snapshot => ({ state: structuredClone(runner.state), log: runner.log.length, events: runner.events.length }),
    restore(snapshot) {
      const saved = snapshot as Snapshot
      runner.state = saved.state
      runner.log.length = saved.log
      runner.events.length = saved.events
    },
  }
  return { runner, participant }
}

describe('transaction all-or-nothing rules', () => {
  it('a throw restores both participants and drops only transaction logs and events, then rethrows', () => {
    const a = counter('a'), b = counter('b')
    a.runner.run(1)
    b.runner.run(2)
    const failure = new Error('provider failed')
    expect(() => transaction([a.participant, b.participant], () => {
      a.runner.run(10)
      b.runner.run(20)
      throw failure
    })).toThrow(failure)
    expect(a.runner.state).toEqual({ value: 1 })
    expect(b.runner.state).toEqual({ value: 2 })
    expect(a.runner.log).toEqual([1])
    expect(b.runner.log).toEqual([2])
    expect(a.runner.events).toEqual([1])
    expect(b.runner.events).toEqual([2])
  })

  it('a return keeps both participants, logs and events and returns the callback value', () => {
    const a = counter('a'), b = counter('b')
    const result = { done: true }
    expect(transaction([a.participant, b.participant], () => {
      a.runner.run(3)
      b.runner.run(4)
      return result
    })).toBe(result)
    expect(a.runner.state).toEqual({ value: 3 })
    expect(b.runner.state).toEqual({ value: 4 })
    expect(a.runner.log).toEqual([3])
    expect(b.runner.log).toEqual([4])
    expect(a.runner.events).toEqual([3])
    expect(b.runner.events).toEqual([4])
  })

  it('all snapshots are taken before fn and a snapshot failure never starts fn', () => {
    const order: string[] = []
    const participant = (id: string): Participant => ({
      id, snapshot() { order.push(id) }, restore() {},
    })
    transaction([participant('a'), participant('b')], () => order.push('fn'))
    expect(order).toEqual(['a', 'b', 'fn'])
    expect(() => transaction([{
      id: 'bad', snapshot() { throw new Error('snapshot failed') }, restore() {},
    }], () => order.push('unexpected'))).toThrow('snapshot failed')
    expect(order).toEqual(['a', 'b', 'fn'])
  })
})
