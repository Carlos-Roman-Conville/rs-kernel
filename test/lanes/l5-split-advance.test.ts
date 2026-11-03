// Test doubles only: arbitrary periods and offsets; exercises split runUntil vs one shot to the same horizon.
import { describe, expect, it } from 'vitest'
import { canonical, DAY, Scheduler, SECOND, type ProcessOrder } from '../../src/index.ts'

const horizon = 2 * DAY
const dailyOffset = 3600

type RunRecord = { id: string; t: number; dt: number }

const laneOrder: ProcessOrder = {
  phases: ['lane'],
  order: { lane: ['lane.1s', 'lane.60s', 'lane.1d'] },
}

const processes = {
  'lane.1s': { period: SECOND },
  'lane.60s': { period: 60 * SECOND },
  'lane.1d': { period: DAY, offset: dailyOffset },
} as const

type ProcessId = keyof typeof processes

function registerProcesses(
  clock: Scheduler, ids: readonly ProcessId[], trace: RunRecord[],
): void {
  for (const id of ids) {
    const spec = processes[id]
    clock.register({
      id, mechanisms: [], period: spec.period, phase: 'lane',
      ...( 'offset' in spec ? { offset: spec.offset } : {} ),
      run: ({ t, dt }) => { trace.push({ id, t, dt }) },
    })
  }
}

function runToHorizon(ids: readonly ProcessId[]): RunRecord[] {
  const trace: RunRecord[] = []
  const clock = new Scheduler({ order: laneOrder })
  registerProcesses(clock, ids, trace)
  clock.runUntil(horizon)
  return trace
}

function runSplit(ids: readonly ProcessId[], endpoints: readonly number[]): RunRecord[] {
  const trace: RunRecord[] = []
  const clock = new Scheduler({ order: laneOrder })
  registerProcesses(clock, ids, trace)
  for (const target of endpoints) clock.runUntil(target)
  return trace
}

/** Uneven split targets; one index pinned to a due instant shared by all three periods. */
function splitEndpoints(callCount: number, dueInstant: number): number[] {
  const alpha = 1.37
  const pin = Math.floor(callCount / 2)
  const out: number[] = []
  let prev = 0
  for (let i = 1; i <= callCount; i++) {
    let t = i === pin ? dueInstant : Math.floor(horizon * (i / callCount) ** alpha)
    t = Math.max(t, prev + 1)
    if (t > horizon) t = horizon
    prev = t
    out.push(t)
  }
  out[out.length - 1] = horizon
  for (let i = out.length - 2; i >= 0 && out[i] >= horizon; i--) {
    out[i] = horizon - (out.length - i)
  }
  out[out.length - 1] = horizon
  return out
}

const dueInstant = dailyOffset + DAY
const registrationOrders: readonly (readonly ProcessId[])[] = [
  ['lane.1s', 'lane.60s', 'lane.1d'],
  ['lane.1d', 'lane.1s', 'lane.60s'],
  ['lane.60s', 'lane.1d', 'lane.1s'],
]

describe('L5 split advance (PLAN §7a)', () => {
  const reference = canonical(runToHorizon(registrationOrders[0]))

  for (const callCount of [2, 7, 1000] as const) {
    const endpoints = splitEndpoints(callCount, dueInstant)

    it(`splitting runUntil into ${callCount} uneven calls matches one shot (due instant ${dueInstant})`, () => {
      expect(endpoints).toHaveLength(callCount)
      expect(endpoints[callCount - 1]).toBe(horizon)
      expect(endpoints).toContain(dueInstant)
      for (const ids of registrationOrders) {
        expect(canonical(runSplit(ids, endpoints)), ids.join(',')).toBe(reference)
      }
    })
  }
})
