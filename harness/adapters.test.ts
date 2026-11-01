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

test('adapters re-exports match adapters module', () => {
  expect(fromThirtyDaysRunnerAdapter).toBe(fromAdaptersRunnerAdapter)
  expect(fromThirtyDaysAssertDay).toBe(fromAdaptersAssertDay)
  expect(fromThirtyDaysAssertWorldTime).toBe(fromAdaptersAssertWorldTime)
  expect(fromThirtyDaysDailyProcesses).toBe(fromAdaptersDailyProcesses)
  expect(fromThirtyDaysWithKernelSteps).toBe(fromAdaptersWithKernelSteps)
})
