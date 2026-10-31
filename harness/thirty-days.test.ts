import { describe, expect, it } from 'vitest'
import { DAY, HOUR, SECOND, EventBus, Scheduler } from '@rex/kernel'
import { Runner as EconomyRunner, materialProvider } from '@rex/economy'
import { TICK_ORDER } from '@rex/settlement'
import { Scheduler as RealismScheduler } from '../../realism/src/scheduler.ts'
import { runHorseStable, STABLE } from '../../realism/examples/horse-stable.ts'
import { runWoundVariant, WOUND_FIXTURE, WOUND_ID } from '../../realism/examples/human-wound.ts'
import { buildHamlet } from '../../settlement/examples/hamlet.ts'
import { assertDay, assertWorldTime, dailyProcesses, runThirtyDays, threePorts, withKernelSteps } from './thirty-days.ts'

// Chunking avoids allocating one giant string; every byte of every row is compared,
// including transfer/check timestamps, with no hashes, rounding or omitted fields.
function sameJsonRows(a: unknown[], b: unknown[]) {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i += 1000) {
    expect(JSON.stringify(a.slice(i, i + 1000)), `rows ${i}..${i + 999}`).toBe(JSON.stringify(b.slice(i, i + 1000)))
  }
}

describe('equivalence before the shared thirty-day run', () => {
  it('horse-stable at its own 60 s step has byte-identical transfers, time and checks to direct Scheduler.run for 30 days', () => {
    const direct = runHorseStable()
    const clock = new Scheduler()
    const scheduled = withKernelSteps(clock, () => runHorseStable())
    expect(STABLE.stepS).toBe(60)
    expect(scheduled.sch.stepCount).toBe(30 * DAY / (STABLE.stepS * SECOND))
    expect(JSON.stringify(scheduled.w.t)).toBe(JSON.stringify(direct.w.t))
    sameJsonRows(scheduled.w.trace.transfers, direct.w.trace.transfers)
    sameJsonRows(scheduled.w.trace.checks, direct.w.trace.checks)
    expect(JSON.stringify(scheduled.days)).toBe(JSON.stringify(direct.days))
    expect(scheduled.w.trace.failed()).toEqual([])
  })

  it('human-wound at 1 s fires once at exactly woundAtS, with clock time assigned after each step', () => {
    const clock = new Scheduler()
    const original = RealismScheduler.prototype.run
    // The example exposes no duration/dt argument. Override only its synchronous
    // driver, keeping all wound/physiology processes and their equality trigger intact.
    RealismScheduler.prototype.run = function (world) {
      withKernelSteps(clock, () => original.call(this, world, WOUND_FIXTURE.woundAtS + 1, 1), (w, t) => {
        if (t % HOUR === 0) {
          expect(w.trace.failed()).toEqual([])
          w.trace.checks.length = 0
        }
      })
    }
    try {
      const run = runWoundVariant('bound-at-once')
      const wounds = run.week.w.trace.notes.filter(note => note.text.startsWith(`${WOUND_ID}: left hand`))
      expect(wounds.map(note => note.t)).toEqual([WOUND_FIXTURE.woundAtS])
      expect(run.medicine.wounds).toHaveLength(1)
      expect(run.week.w.t).toBe(WOUND_FIXTURE.woundAtS + 1)
      expect(clock.t).toBe((WOUND_FIXTURE.woundAtS + 1) * SECOND)
      expect(run.week.w.trace.failed()).toEqual([])
    } finally { RealismScheduler.prototype.run = original }
  })

  it('the unmodified hamlet gives the same state JSON as 30 direct ticks, including its two setup days', () => {
    const direct = buildHamlet(), scheduled = buildHamlet()
    direct.r.tick(30)
    const start = scheduled.r.state.settlement.day * DAY
    expect(start).toBe(2 * DAY)
    const clock = new Scheduler({ start })
    clock.register({ id: 'settlement.tick', mechanisms: [], period: DAY, phase: 'day.settlement', run(ctx) {
      scheduled.r.tick()
      assertDay(ctx.t, 'settlement', scheduled.r.state.settlement.day)
      expect(scheduled.r.state.tickTrace).toEqual(TICK_ORDER)
    } })
    clock.runUntil(start + 30 * DAY)
    expect(JSON.stringify(scheduled.r.state)).toBe(JSON.stringify(direct.r.state))
    expect(JSON.stringify(scheduled.r.events)).toBe(JSON.stringify(direct.r.events))
  })

  it('three-ports under the kernel gives the same state JSON, log and balances as simulate(30)', () => {
    const ports = threePorts(30), clock = new Scheduler()
    clock.register({ id: 'economy.tick', mechanisms: [], period: DAY, phase: 'day.economy', run(ctx) {
      ports.beforeEconomy(ports.economy.state.day)
      ports.economy.run({ type: 'tick' })
      assertDay(ctx.t, 'economy', ports.economy.state.day)
    } })
    clock.runUntil(30 * DAY)
    expect(JSON.stringify(ports.economy.state)).toBe(JSON.stringify(ports.direct.state))
    expect(JSON.stringify(ports.economy.log)).toBe(JSON.stringify(ports.direct.log))
    expect(ports.ledger.balances).toEqual(ports.direct.balances)
  })
})

describe('P0 one clock for thirty days', () => {
  it('runs 2,592,000 exact 1 s steps, compacts hourly, orders every midnight, conserves goods/money and publishes only new events', () => {
    const run = runThirtyDays()
    expect(run.clock.t).toBe(30 * DAY)
    expect(run.horse.sch.stepCount).toBe(30 * DAY / SECOND)
    expect(run.horse.w.t).toBe(run.clock.t / SECOND)
    expect(run.horse.days).toHaveLength(30)
    expect(run.horse.w.trace.failed()).toEqual([])
    expect(run.hours).toBe(30 * DAY / HOUR)
    expect(run.checked).toBeGreaterThan(run.horse.sch.stepCount)
    expect(run.maxTransfers).toBeGreaterThan(0)
    expect(run.horse.w.trace.transfers).toHaveLength(0) // final hourly compaction really ran
    expect(run.midnights).toHaveLength(30)
    const previousGoods = { ...run.initialGoods }
    for (const [i, midnight] of run.midnights.entries()) {
      expect(midnight.t).toBe((i + 1) * DAY)
      expect(midnight.order).toEqual(['realism.step', 'settlement.tick', 'economy.tick'])
      expect(midnight.tickTrace).toEqual(['decay', 'projects', 'staffing', 'production', 'wages', 'publicWorks', 'expiry'])
      expect(midnight.settlementDay).toBe(Math.floor(midnight.t / DAY))
      expect(midnight.economyDay).toBe(Math.floor(midnight.t / DAY))
      expect(midnight.worldTime).toBe(midnight.t / SECOND)
      // E14's money, prices and nonnegative stocks, plus its stated no-spoilage
      // goods balance checked daily using the engine's observed production/consumption.
      expect(midnight.money).toBeCloseTo(run.initialMoney)
      for (const cell of midnight.cells) {
        expect(Number.isFinite(cell.price)).toBe(true)
        expect(cell.stock).toBeGreaterThanOrEqual(0)
      }
      for (const id of ['timber', 'cloth']) {
        const good = midnight.goods[id]
        expect(good.total).toBeCloseTo(previousGoods[id] + good.produced - good.consumed, 8)
        previousGoods[id] = good.total
      }
    }
    expect(run.initialMoney).toBe(1000)
    expect(previousGoods.timber).toBeGreaterThan(0)
    expect(run.ports.economy.log.map(command => command.type)).toEqual(expect.arrayContaining(['ship', 'sell']))
    expect(JSON.stringify(run.ports.economy.state)).toBe(JSON.stringify(run.ports.direct.state))
    const events = run.bus.since()
    expect(run.seedEvents.settlement).toBeGreaterThan(0)
    expect(run.seedEvents.economy).toBeGreaterThan(0)
    expect(events.filter(event => event.source === 'settlement.tick').map(event => event.payload))
      .toEqual(run.hamlet.r.events.slice(run.seedEvents.settlement))
    expect(events.filter(event => event.source === 'economy.tick').map(event => event.payload))
      .toEqual(run.ports.economy.events.slice(run.seedEvents.economy))
    expect(events.every(event => event.t >= DAY)).toBe(true)
    expect(events.map(event => event.type)).not.toContain('goodDefined')
  })

  for (const engine of ['settlement', 'economy'] as const) {
    for (const ticks of [0, 2]) {
      it(`rejects a ${ticks === 0 ? 'skipped' : 'doubled'} ${engine} day at the first midnight`, () => {
        const hamlet = buildHamlet(), economy = new EconomyRunner()
        hamlet.r.state.settlement.day = 0
        const clock = new Scheduler({ emit: new EventBus().emit })
        dailyProcesses(clock, hamlet.r, economy)
        if (engine === 'settlement') {
          const tick = hamlet.r.tick.bind(hamlet.r)
          hamlet.r.tick = () => tick(ticks)
        } else {
          const run = economy.run.bind(economy)
          economy.run = command => {
            if (command.type !== 'tick') return run(command)
            for (let i = 0; i < ticks; i++) run(command)
            return { state: economy.state, events: [], minted: null, taken: null }
          }
        }
        expect(() => clock.runUntil(DAY)).toThrow(`${engine}.day ${ticks} != floor(T / DAY) 1`)
      })
    }
  }

  it('rejects a clock that jumps over a day, and detects even a fractional second of world-time drift', () => {
    expect(() => assertDay(2 * DAY, 'settlement', 1)).toThrow('floor(T / DAY) 2')
    expect(() => assertDay(DAY, 'economy', 2)).toThrow('floor(T / DAY) 1')
    const { w } = runHorseStable(0)
    w.t = DAY / SECOND + 0.000001
    expect(() => assertWorldTime(w, DAY)).toThrow('world.t')
  })
})

/** Use Economy's actual MaterialProvider, seeded with the hamlet's own recipe data. */
function coupledHamlet() {
  const hamlet = buildHamlet(), economy = new EconomyRunner()
  hamlet.r.state.settlement.day = 0
  hamlet.providers.labour.grants.length = 0 // build-time project hours were drawn on days 0-1; the rewound clock starts fresh
  for (const id of ['log', 'plank', 'timber']) {
    economy.run({ type: 'defineGood', good: { id, type: null, weight: null, spoilagePerDay: null, legal: null } })
  }
  economy.run({ type: 'openMarket', id: 'hamlet', mode: 'settlement' })
  const inventory = economy.run({ type: 'openInventory', holder: hamlet.ids.biz, market: 'hamlet' }).minted!
  const recipe = hamlet.providers.materials.recipes.plank
  economy.run({ type: 'defineRecipe', recipe: {
    id: 'plank', output: recipe.output, yield: recipe.yield, inputs: recipe.inputs, inputsAny: [], byproducts: [],
    equipment: ['saw-pit'], skill: null, band: null, minLevel: null, knowledge: null,
    rates: { unitsPerFixtureDay: recipe.unitsPerFixtureDay, labourHoursPerUnit: recipe.labourHoursPerUnit },
  } })
  economy.run({ type: 'addStock', inventory, good: 'log', units: hamlet.providers.materials.have('inv.sawyer', 'log') })
  economy.run({ type: 'addStock', inventory, good: 'timber', units: 10 })
  hamlet.r.state.businesses[hamlet.ids.biz].inventory = inventory
  hamlet.r.providers.materials = materialProvider(economy)
  const bus = new EventBus(), clock = new Scheduler({ emit: bus.emit })
  dailyProcesses(clock, hamlet.r, economy)
  return { ...hamlet, economy, inventory, bus, clock }
}

const runnerSnapshot = (runner: { state: unknown; log: unknown[]; events: unknown[] }) =>
  structuredClone({ state: runner.state, log: runner.log, events: runner.events })

describe('cross-engine tick transaction', () => {
  for (const failure of ['wages after produce', 'projects after take'] as const) {
    it(`restores both runners, logs, events and bus on ${failure}`, () => {
      const run = coupledHamlet()
      const materials = run.r.providers.materials
      let mutated: ReturnType<typeof runnerSnapshot> | undefined
      if (failure === 'wages after produce') {
        const produce = materials.produce.bind(materials)
        materials.produce = (...args) => { produce(...args); mutated = runnerSnapshot(run.economy) }
        // Wages has no provider hook. Invalid wage fixture throws in its real pay()
        // after production has already committed an Economy produce command.
        run.r.state.posts[run.ids.post].wage = Number.POSITIVE_INFINITY
      } else {
        run.r.run({ type: 'startProject', kind: 'renovate', target: run.ids.shopId,
          account: 'alder', inventory: run.inventory, labourHours: 0,
          materials: [{ material: 'timber', units: 5 }], plan: {} })
        const take = materials.take.bind(materials)
        materials.take = (...args) => {
          take(...args)
          mutated = runnerSnapshot(run.economy)
          throw new Error('injected projects failure after take')
        }
      }
      const settlementBefore = runnerSnapshot(run.r), economyBefore = runnerSnapshot(run.economy)
      const busBefore = run.bus.state()
      expect(() => run.clock.runUntil(DAY)).toThrow(failure === 'wages after produce' ? 'amount must be a number >= 0' : 'injected projects failure after take')
      expect(mutated).toBeDefined()
      expect(mutated!.state).not.toEqual(economyBefore.state)
      expect(mutated!.log.length).toBe(economyBefore.log.length + 1)
      expect(mutated!.events.length).toBeGreaterThan(economyBefore.events.length)
      expect(runnerSnapshot(run.economy)).toEqual(economyBefore)
      expect(runnerSnapshot(run.r)).toEqual(settlementBefore)
      expect(run.bus.state()).toEqual(busBefore)
      expect(run.bus.since()).toEqual([])
    })
  }

  it('commits a successful provider call and publishes its new events once with the settlement tick', () => {
    const run = coupledHamlet()
    const seed = { settlement: run.r.events.length, economy: run.economy.events.length }
    run.clock.runUntil(DAY)
    expect(run.r.state.tickTrace).toEqual(TICK_ORDER)
    expect(run.economy.log.map(command => command.type)).toContain('produce')
    const published = run.bus.since()
    expect(published.map(event => event.payload)).toEqual([
      ...run.r.events.slice(seed.settlement), ...run.economy.events.slice(seed.economy),
    ])
    const length = published.length
    run.clock.runUntil(DAY)
    expect(run.bus.since(length)).toEqual([])
  })
})
