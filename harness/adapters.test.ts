import {
  runnerAdapter as fromAdaptersRunnerAdapter,
  assertDay as fromAdaptersAssertDay,
  assertWorldTime as fromAdaptersAssertWorldTime,
  dailyProcesses as fromAdaptersDailyProcesses,
  withKernelSteps as fromAdaptersWithKernelSteps,
} from './adapters.ts'
import {
  runnerAdapter as fromThirtyDaysRunnerAdapter,
  assertDay as fromThirtyDaysAssertDay,
  assertWorldTime as fromThirtyDaysAssertWorldTime,
  dailyProcesses as fromThirtyDaysDailyProcesses,
  withKernelSteps as fromThirtyDaysWithKernelSteps,
} from './thirty-days.ts'
import { expect, test } from 'vitest'
import { EventBus, Scheduler } from '../src/index.ts'

test('adapters re-exports match adapters module', () => {
  expect(fromThirtyDaysRunnerAdapter).toBe(fromAdaptersRunnerAdapter)
  expect(fromThirtyDaysAssertDay).toBe(fromAdaptersAssertDay)
  expect(fromThirtyDaysAssertWorldTime).toBe(fromAdaptersAssertWorldTime)
  expect(fromThirtyDaysDailyProcesses).toBe(fromAdaptersDailyProcesses)
  expect(fromThirtyDaysWithKernelSteps).toBe(fromAdaptersWithKernelSteps)
})

test.each([
  { label: 'string cause', fields: { cause: 'evt-1' }, expectedCause: 'evt-1' },
  { label: 'missing cause', fields: {}, expectedCause: undefined },
  { label: 'empty cause', fields: { cause: '' }, expectedCause: undefined },
  { label: 'numeric cause', fields: { cause: 1 }, expectedCause: undefined },
  { label: 'null cause', fields: { cause: null }, expectedCause: undefined },
  { label: 'object cause', fields: { cause: { id: 'evt-1' } }, expectedCause: undefined },
])('runnerAdapter publishes $label without changing the payload', ({ fields, expectedCause }) => {
  const event = { type: 'shared.action.outcome', action: 'work', ...fields }
  const original = structuredClone(event)
  const runner = { state: {}, log: [], events: [] as typeof event[] }
  const adapter = fromAdaptersRunnerAdapter('settlement', runner)
  const bus = new EventBus()
  const clock = new Scheduler({ emit: bus.emit })
  clock.register({ id: 'settlement.tick', mechanisms: [], period: 1, phase: 'day.settlement', run(ctx) {
    runner.events.push(event)
    adapter.publish(ctx)
  } })

  clock.runUntil(1)

  const records = bus.recordsSince()
  expect(records).toHaveLength(1)
  expect(records[0].event.cause).toBe(expectedCause)
  if (expectedCause === undefined) expect(records[0].event).not.toHaveProperty('cause')
  expect(records[0].event.payload).toStrictEqual(original)
  expect(event).toStrictEqual(original)
})
