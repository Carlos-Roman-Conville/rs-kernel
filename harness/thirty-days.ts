// P0 acceptance adapters. Engine examples own all circumstances, recipes and trading decisions.
import { DAY, HOUR, SECOND, EventBus, Scheduler } from '../src/index.ts'
import type { World } from '../../realism/src/world.ts'
import { runHorseStable } from '../../realism/examples/horse-stable.ts'
import { buildHamlet } from '../../settlement/examples/hamlet.ts'
import { Runner as EconomyRunner, StubLedger, totalUnits } from '@rex/economy'
import { simulate } from '../../economy/examples/three-ports.ts'
import { dailyProcesses, withKernelSteps } from './adapters.ts'

export { runnerAdapter, assertDay, assertWorldTime, dailyProcesses, withKernelSteps } from './adapters.ts'

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
