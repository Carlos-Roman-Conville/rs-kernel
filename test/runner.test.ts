import { describe, expect, it } from 'vitest'
import { Runner } from '../src/index.ts'

interface State { counter: number; history: number[] }
interface Command { amount: number; details?: { label: string }; fail?: boolean }
interface Event { value: number }
interface Result { state: State; events: Event[]; minted: string; taken: number }
const initial = (): State => ({ counter: 0, history: [] })

function reduce(state: State, command: Command): Result {
  state.counter += command.amount
  state.history.push(state.counter)
  if (command.fail) throw new Error('command failed')
  return { state, events: [{ value: state.counter }], minted: `counter.${state.counter}`, taken: command.amount }
}

interface Config { multiplier: number }
interface Providers { adjust(amount: number): number }
class Counter extends Runner<State, Command, Result, Event> {
  config: Config
  providers: Providers
  constructor(state = initial(), config: Config = { multiplier: 1 },
    providers: Providers = { adjust: amount => amount }) {
    super(state, (current, command) => reduce(current, {
      ...command, amount: providers.adjust(command.amount) * config.multiplier,
    }))
    this.config = config
    this.providers = providers
  }
  increment(): Result { return this.run({ amount: 1 }) }
}

describe('Runner reducer and replay rules', () => {
  it('run keeps a structuredClone of each command and collects ordered events', () => {
    const state = initial()
    const runner = new Runner<State, Command, Result, Event>(state, reduce)
    const command = { amount: 2, details: { label: 'first' } }
    runner.run(command)
    command.details.label = 'changed'
    command.amount = 99
    runner.run({ amount: 3 })
    expect(runner.log).toEqual([{ amount: 2, details: { label: 'first' } }, { amount: 3 }])
    expect(runner.events).toEqual([{ value: 2 }, { value: 5 }])
    expect(state).toEqual(initial())
  })

  it('a reducer throwing after mutation leaves state, log and events untouched', () => {
    const runner = new Counter()
    runner.increment()
    const state = runner.state
    const before = structuredClone({ state, log: runner.log, events: runner.events })
    expect(() => runner.run({ amount: 10, fail: true })).toThrow('command failed')
    expect(runner.state).toBe(state)
    expect({ state: runner.state, log: runner.log, events: runner.events }).toEqual(before)
  })

  it('an uncloneable command fails before reducing or publishing state', () => {
    const runner = new Counter()
    const command = { amount: 1, callback: () => {} }
    expect(() => runner.run(command)).toThrow()
    expect(runner.state).toEqual(initial())
    expect(runner.log).toEqual([])
    expect(runner.events).toEqual([])
  })

  it('Runner.replay folds the log to a JSON.stringify-identical state', () => {
    const runner = new Runner<State, Command, Result, Event>(initial(), reduce)
    runner.run({ amount: 2 })
    runner.run({ amount: -1 })
    const replayed = Runner.replay(runner.log, reduce, undefined, initial())
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(runner.state))
    expect(replayed.events).toEqual(runner.events)
  })

  it('a subclass keeps its constructor and methods and run returns the whole reduce result', () => {
    const runner = new Counter(initial(), { multiplier: 2 }, { adjust: amount => amount + 1 })
    const result = runner.increment()
    expect(result.minted).toBe('counter.4')
    expect(result.taken).toBe(4)
    expect(result.state).toBe(runner.state)
    expect(result.events).toEqual(runner.events)
  })

  it('subclass replay(log) uses constructor defaults and returns the subclass', () => {
    const runner = new Counter()
    runner.increment()
    runner.run({ amount: 8 })
    const replayed = Counter.replay(runner.log)
    expect(replayed).toBeInstanceOf(Counter)
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(runner.state))
    expect(replayed.increment().taken).toBe(1)
  })

  it('replay(log, config, providers, from) preserves from and exact provider command order', () => {
    const from: State = { counter: 10, history: [10] }
    const config = { multiplier: 3 }
    const providers = { adjust: (amount: number) => amount + 1 }
    const runner = new Counter(from, config, providers)
    runner.run({ amount: 2 })
    const providerCall = () => runner.run({ amount: -4 })
    providerCall()
    runner.run({ amount: 1 })
    expect(runner.log.map(command => command.amount)).toEqual([2, -4, 1])
    const replayed = Counter.replay(runner.log, config, providers, from)
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(runner.state))
    expect(replayed.log).toEqual(runner.log)
    expect(replayed.events).toEqual(runner.events)
    expect(from).toEqual({ counter: 10, history: [10] })
    expect(replayed.state).not.toBe(from)
  })
})
