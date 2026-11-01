// P0 acceptance adapters. Engine examples own all circumstances, recipes and trading decisions.
import { DAY, SECOND, transaction, type Participant, type ProcessContext, Scheduler } from '../src/index.ts'
import { Scheduler as RealismScheduler } from '../../realism/src/scheduler.ts'
import type { World } from '../../realism/src/world.ts'
import type { Runner as SettlementRunner } from '@rex/settlement'
import { Runner as EconomyRunner } from '@rex/economy'

/** Reducers replace state and append logs/events; snapshots also cover publication cursors. */
export function runnerAdapter<S, C, E extends { type: string }>(
  id: string, runner: { state: S; log: C[]; events: E[] },
) {
  let cursor = runner.events.length // Fixture-loading events have already happened.
  interface Saved { state: S; log: number; events: number; cursor: number }
  const participant: Participant = {
    id,
    snapshot: (): Saved => ({ state: structuredClone(runner.state), log: runner.log.length, events: runner.events.length, cursor }),
    restore(value) {
      const saved = value as Saved
      runner.state = saved.state
      runner.log.length = saved.log
      runner.events.length = saved.events
      cursor = saved.cursor
    },
  }
  return {
    participant,
    publish(ctx: ProcessContext) {
      for (; cursor < runner.events.length; cursor++) {
        const event = runner.events[cursor]
        const cause = 'cause' in event ? event.cause : undefined
        ctx.emit(event.type, event, typeof cause === 'string' && cause.length > 0 ? cause : undefined)
      }
    },
  }
}

export function assertDay(t: number, engine: string, day: number): void {
  const expected = Math.floor(t / DAY)
  if (day !== expected) throw new Error(`${engine}.day ${day} != floor(T / DAY) ${expected} at ${t}`)
}

export function assertWorldTime(world: World, t: number): void {
  if (world.t !== t / SECOND) throw new Error(`world.t ${world.t} != T / 1000 ${t / SECOND}`)
}

export function dailyProcesses(clock: Scheduler, settlement: SettlementRunner, economy: EconomyRunner, options: {
  beforeEconomy?: (day: number) => void
  afterDay?: (t: number) => void
  record?: (t: number, id: string) => void
} = {}) {
  const s = runnerAdapter('settlement', settlement), e = runnerAdapter('economy', economy)
  const participants = [s.participant, e.participant]
  // Deliberately register in reverse: declared phases, never registration, determine execution.
  clock.register({ id: 'economy.tick', mechanisms: [], period: DAY, phase: 'day.economy', run(ctx) {
    options.beforeEconomy?.(economy.state.day)
    economy.run({ type: 'tick' })
    assertDay(ctx.t, 'economy', economy.state.day)
    assertDay(ctx.t, 'settlement', settlement.state.settlement.day)
    options.record?.(ctx.t, 'economy.tick')
    e.publish(ctx)
    options.afterDay?.(ctx.t)
  } })
  clock.register({ id: 'settlement.tick', mechanisms: [], period: DAY, phase: 'day.settlement', run(ctx) {
    transaction(participants, () => {
      settlement.tick()
      assertDay(ctx.t, 'settlement', settlement.state.settlement.day)
    })
    options.record?.(ctx.t, 'settlement.tick')
    // Publish only after commit; failed provider calls cannot leak events to the bus.
    s.publish(ctx)
    e.publish(ctx)
  } })
  return { settlement: s, economy: e, participants }
}

/**
 * The horse example owns its audit cursor and moves it after Trace.compact. Keep its
 * original loop and hook just the step boundary: the kernel invokes the actual step
 * with clock time, then runs any daily processes. Always restore the synchronous hook.
 * This harness bridge must not be used by concurrent tests in the same worker.
 */
export function withKernelSteps<T>(clock: Scheduler, example: () => T, afterStep?: (world: World, t: number) => void): T {
  const original = RealismScheduler.prototype.stepOnce
  let registered: RealismScheduler | undefined
  RealismScheduler.prototype.stepOnce = function (world, dt) {
    if (!registered) {
      registered = this
      const inner = this
      clock.register({ id: 'realism.step', mechanisms: [], period: dt * SECOND, phase: 'fast', run(ctx) {
        original.call(inner, world, ctx.dt / SECOND, ctx.t / SECOND)
        assertWorldTime(world, ctx.t)
        afterStep?.(world, ctx.t)
      } })
    }
    if (registered !== this) throw new Error('one realism scheduler per example bridge')
    clock.runUntil(clock.t + dt * SECOND)
  }
  try { return example() } finally { RealismScheduler.prototype.stepOnce = original }
}
