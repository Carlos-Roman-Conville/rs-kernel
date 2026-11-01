import { describe, expect, it } from 'vitest'
import { canonical, DAY, HOUR, SECOND, EventBus, Scheduler, streams, take, restore, type Snapshot } from '../src/index.ts'
import { buildHamlet } from '../../settlement/examples/hamlet.ts'
import { runHorseStable } from '../../realism/examples/horse-stable.ts'
import { Scheduler as RealismScheduler } from '../../realism/src/scheduler.ts'
import { controlProcess } from '../../realism/src/process.ts'
import { snapshotWorld } from '../../realism/src/snapshot.ts'
import { dailyProcesses, threePorts, withKernelSteps } from './thirty-days.ts'

const mechanism = 'realism.infra.operator_control'
type Command = ReturnType<typeof threePorts>['economy']['log'][number]
interface Input { t: number; commands: Command[] }
interface Recording { initial: Snapshot; inputs: Input[]; days: number }

// Keep only external policy commands. Daily ticks and provider commands are regenerated
// by the shared adapters, never replayed from an engine's audit log.
function hostInputs(ports: ReturnType<typeof threePorts>, days: number): Input[] {
  const inputs: Input[] = []
  let commands: Command[] = []
  for (const command of ports.direct.log.slice(ports.economy.log.length) as Command[]) {
    if (command.type === 'tick') {
      inputs.push({ t: (inputs.length + 1) * DAY, commands })
      commands = []
    } else commands.push(structuredClone(command))
  }
  expect(commands).toEqual([])
  expect(inputs).toHaveLength(days)
  return inputs
}

function run(days: number, seed: number, recording?: Recording) {
  const hamlet = buildHamlet(), ports = threePorts(recording ? 0 : days)
  hamlet.r.state.settlement.day = 0 // Same prepared-hamlet epoch as runThirtyDays.
  const inputs = structuredClone(recording?.inputs ?? hostInputs(ports, days))
  const random = streams(seed), bus = new EventBus()
  const clock = new Scheduler({ rng: random, emit: bus.emit })
  const adapters = dailyProcesses(clock, hamlet.r, ports.economy, {
    beforeEconomy(day) {
      const input = inputs[day]
      expect(clock.t).toBe(input.t)
      ports.ledger.day = day
      for (const command of input.commands) ports.economy.run(structuredClone(command))
    },
  })
  const kernel = (): Snapshot['kernel'] => ({
    version: 2, t: clock.t, epoch: null, epochLabel: 'prepared-hamlet', catalogue_hash: null, seed,
    eventCounter: bus.state().counter, rng: random.state(),
  })
  // Providers and process closures are rebuilt by their owning fixture constructors.
  // P0 explicitly supports initial-state replay, not mid-run realism restoration.
  const initial = take(adapters.participants, kernel())
  if (recording) {
    expect(recording.days).toBe(days)
    expect(canonical(initial.kernel)).toBe(canonical(recording.initial.kernel))
    expect(canonical(initial.engines)).toBe(canonical({
      settlement: recording.initial.engines.settlement, economy: recording.initial.engines.economy,
    }))
    const saved = restore(adapters.participants, recording.initial)
    random.restore(saved.rng)
  }

  const original = RealismScheduler.prototype.stepOnce
  let initialized = false
  RealismScheduler.prototype.stepOnce = function (world, dt, tAfter) {
    if (!initialized) {
      initialized = true
      // An isolated controller: no combustion process consumes this feed setting.
      // Its formula belongs to realism; the harness supplies only fixture inputs.
      world.registry.addComponent({
        id: 'replay-controller', kind: 'heater', material: 'air_mass', mass: 0,
        temperatureC: 20, contents: [], ports: [], props: {},
        condition: { capability: 1, control: 1, accuracy: 1 },
      })
      this.add(controlProcess('replay-controller', 1, 50, random.get(mechanism)))
      initial.engines.realism = snapshotWorld(world, this)
      if (recording) {
        expect(canonical(initial.engines.realism)).toBe(canonical(recording.initial.engines.realism))
      }
    }
    original.call(this, world, dt, tAfter)
  }
  let horse: ReturnType<typeof runHorseStable>
  try {
    horse = withKernelSteps(clock, () => runHorseStable(days, {
      stepS: SECOND / SECOND, compactEveryS: HOUR / SECOND,
    }), (world, t) => {
      // Match the thirty-day harness: check each hourly batch before dropping
      // successful checks, and let the example compact its trace and audit cursor.
      if (t % HOUR === 0) {
        expect(world.trace.failed()).toEqual([])
        world.trace.checks.length = 0
      }
    })
  } finally {
    RealismScheduler.prototype.stepOnce = original
  }
  expect(initialized).toBe(true)
  expect(clock.t).toBe(days * DAY)
  expect(horse.sch.stepCount).toBe(days * DAY / SECOND)
  expect(horse.w.t).toBe(clock.t / SECOND)
  expect(hamlet.r.state.settlement.day).toBe(days)
  expect(ports.economy.state.day).toBe(days)
  expect(horse.w.trace.failed()).toEqual([])
  const final = take(adapters.participants, kernel())
  final.engines.realism = snapshotWorld(horse.w, horse.sch)
  // Include provider-owned mutable state and full audit streams in the comparison.
  const audit = canonical({
    bus: bus.state(), settlementLog: hamlet.r.log, settlementEvents: hamlet.r.events,
    materials: hamlet.providers.materials.stock, labour: hamlet.providers.labour.grants,
    economyLog: ports.economy.log, economyEvents: ports.economy.events, balances: ports.ledger.balances,
  })
  return { recording: { initial, inputs, days }, final, audit }
}

// The example bridge temporarily replaces a prototype method; these runs are synchronous.
describe('P0 replay from the initial state and seed', () => {
  it('reruns 30 days with the same recorded inputs and seed to canonical-equal kernel and all three engine snapshots', () => {
    const first = run(30, 42)
    const saved = canonical(first.recording)
    const replay = run(30, 42, first.recording)
    expect(canonical(replay.final)).toBe(canonical(first.final))
    expect(replay.audit).toBe(first.audit)
    expect(canonical(first.recording)).toBe(saved)
    expect(Object.keys(replay.final.kernel.rng)).toEqual([mechanism])
    expect(replay.final.kernel.eventCounter).toBeGreaterThan(0)
  }, 7_200_000) // Two full 1 s runs need twice the harness's single-run timeout.

  it('over 3 days, a second seed changes realism stochastic state while settlement and economy stay canonical-equal', () => {
    const first = run(3, 42)
    const second = run(3, 43, {
      ...first.recording,
      initial: { ...first.recording.initial, kernel: { ...first.recording.initial.kernel, seed: 43 } },
    })
    expect(canonical(second.final.engines.realism)).not.toBe(canonical(first.final.engines.realism))
    for (const engine of ['settlement', 'economy']) {
      expect(canonical(second.final.engines[engine])).toBe(canonical(first.final.engines[engine]))
    }
    expect(second.audit).toBe(first.audit)
    expect(second.final.kernel.rng[mechanism]).not.toBe(first.final.kernel.rng[mechanism])
  })
})
