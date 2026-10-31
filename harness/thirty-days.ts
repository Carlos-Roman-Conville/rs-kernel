// P0 acceptance adapters. Engine examples own all circumstances, recipes and trading decisions.
import { DAY, HOUR, SECOND, EventBus, Scheduler, transaction, type Participant, type ProcessContext } from '@rex/kernel'
import { Scheduler as RealismScheduler } from '../../realism/src/scheduler.ts'
import type { World } from '../../realism/src/world.ts'
import { runHorseStable } from '../../realism/examples/horse-stable.ts'
import { buildHamlet } from '../../settlement/examples/hamlet.ts'
import type { Runner as SettlementRunner } from '@rex/settlement'
import { Runner as EconomyRunner, StubLedger, totalUnits } from '@rex/economy'
import { simulate } from '../../economy/examples/three-ports.ts'

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
        ctx.emit(event.type, event)
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

/**
 * simulate exposes a command log, not a fixture builder or a single-day policy.
 * Capture its zero-day runner (including its real providers), then use the native
 * example's daily policy commands as host inputs. No trading policy is copied here.
 * The tick commands themselves are executed only by the kernel's daily process.
 */
export function threePorts(days: number) {
  const original = EconomyRunner.prototype.run
  let runner: EconomyRunner | undefined
  EconomyRunner.prototype.run = function (command) {
    runner = this
    return original.call(this, command)
  }
  try { simulate(0) } finally { EconomyRunner.prototype.run = original }
  if (!runner) throw new Error('three-ports did not build a runner')
  const economy = runner
  const direct = simulate(days)
  const commands = direct.log.slice(economy.log.length) as EconomyRunner['log']
  const daily: EconomyRunner['log'][] = []
  let pending: EconomyRunner['log'] = []
  for (const command of commands) {
    if (command.type === 'tick') { daily.push(pending); pending = [] }
    else pending.push(command)
  }
  if (pending.length || daily.length !== days) throw new Error('three-ports log must end each day with one tick')
  const ledger = economy.providers.ledger
  if (!(ledger instanceof StubLedger)) throw new Error('three-ports fixture must expose its ledger')
  return {
    economy, direct, ledger,
    beforeEconomy(day: number) {
      ledger.day = day
      for (const command of daily[day]) economy.run(command)
    },
  }
}

export interface Midnight {
  t: number
  order: string[]
  tickTrace: string[]
  settlementDay: number
  economyDay: number
  worldTime: number
  money: number
  goods: Record<string, { total: number; produced: number; consumed: number }>
  cells: { price: number | null; stock: number }[]
}

export function runThirtyDays() {
  const ports = threePorts(30)
  const hamlet = buildHamlet()
  // buildHamlet ticks twice to finish construction. This run's epoch is the prepared
  // hamlet: explicitly rebase only its counter. The equivalence test does not rebase.
  hamlet.r.state.settlement.day = 0
  const seedEvents = { settlement: hamlet.r.events.length, economy: ports.economy.events.length }
  const bus = new EventBus(), clock = new Scheduler({ emit: bus.emit })
  const midnights: Midnight[] = []
  let order: string[] = [], world: World | undefined
  let checked = 0, hours = 0, maxTransfers = 0
  const initialGoods = Object.fromEntries(Object.keys(ports.economy.state.goods).map(id => [id, totalUnits(ports.economy.state, id)]))
  const initialMoney = Object.values(ports.ledger.balances).reduce((sum, value) => sum + value, 0)
  dailyProcesses(clock, hamlet.r, ports.economy, {
    beforeEconomy: ports.beforeEconomy,
    record: (_t, id) => order.push(id),
    afterDay(t) {
      const state = ports.economy.state
      midnights.push({
        t, order, tickTrace: [...hamlet.r.state.tickTrace], settlementDay: hamlet.r.state.settlement.day,
        economyDay: state.day, worldTime: world!.t,
        money: Object.values(ports.ledger.balances).reduce((sum, value) => sum + value, 0),
        goods: Object.fromEntries(Object.keys(state.goods).map(id => [id, {
          total: totalUnits(state, id),
          produced: Object.values(state.markets).reduce((sum, market) => sum + market.goods[id].producedLast, 0),
          consumed: Object.values(state.markets).reduce((sum, market) => sum + market.goods[id].consumedLast, 0),
        }])),
        cells: Object.values(state.markets).flatMap(market => Object.entries(market.goods).map(([id, good]) => ({
          price: good.price, stock: state.inventories[market.inventory].stock[id] ?? 0,
        }))),
      })
      order = []
    },
  })
  const horse = withKernelSteps(clock, () => runHorseStable(30, { stepS: SECOND / SECOND, compactEveryS: HOUR / SECOND }), (w, t) => {
    world = w
    if (t % DAY === 0) order.push('realism.step')
    if (t % HOUR === 0) {
      hours++
      maxTransfers = Math.max(maxTransfers, w.trace.transfers.length)
      // Trace.compact deliberately retains checks. Validate every hourly batch before
      // discarding successes, so 30 days does not retain tens of millions of objects.
      checked += w.trace.checks.length
      const failed = w.trace.failed()
      if (failed.length) throw new Error(`realism conservation failed at ${t}: ${JSON.stringify(failed[0])}`)
      w.trace.checks.length = 0
    }
  })
  return { clock, bus, horse, hamlet, ports, midnights, initialGoods, initialMoney, seedEvents, checked, hours, maxTransfers }
}
