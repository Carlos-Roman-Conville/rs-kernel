// fixture constants, arbitrary test numbers, not world values
import { describe, expect, it } from 'vitest'
import { Scheduler, type Process } from '../src/scheduler.ts'

const a = 0.3 // s^-1
const b = 0.1 // s^-1
const x0 = 1
const y0 = 0
const total = x0 + y0
const horizon = 10_000 // ms
const periods = [1000, 500, 250, 125] // ms
const equilibrium = b * total / (a + b)
const exact = equilibrium + (x0 - equilibrium) * Math.exp(-(a + b) * horizon / 1000)

function globalError(period: number, reverse: boolean): number {
  let x = x0
  let y = y0
  const calls = { A: 0, B: 0 }
  const scheduler = new Scheduler({
    order: { phases: ['exchange'], order: { exchange: 'insertion' } },
  })
  const processes: Process[] = [
    {
      id: 'A', mechanisms: [], period, phase: 'exchange',
      run({ dt }) {
        expect(dt).toBe(period)
        const m = x * (1 - Math.exp(-a * dt / 1000))
        x -= m
        y += m
        calls.A++
        expect(Math.abs(x + y - total)).toBeLessThanOrEqual(1e-12)
      },
    },
    {
      id: 'B', mechanisms: [], period, phase: 'exchange',
      run({ dt }) {
        expect(dt).toBe(period)
        const m = y * (1 - Math.exp(-b * dt / 1000))
        y -= m
        x += m
        calls.B++
        expect(Math.abs(x + y - total)).toBeLessThanOrEqual(1e-12)
      },
    },
  ]
  for (const process of reverse ? processes.reverse() : processes) scheduler.register(process)
  scheduler.runUntil(horizon)
  expect(calls).toEqual({ A: horizon / period, B: horizon / period })
  return Math.abs(x - exact)
}

describe('PLAN V-6: Lie splitting (numerical verification, fixture only)', () => {
  it('has first-order global error in both orders, conserves total, and depends on order', () => {
    const forward = periods.map(period => globalError(period, false))
    const reverse = periods.map(period => globalError(period, true))

    for (const errors of [forward, reverse]) {
      for (let i = 0; i < errors.length - 1; i++) {
        const ratio = errors[i] / errors[i + 1]
        expect(ratio).toBeGreaterThanOrEqual(1.8)
        expect(ratio).toBeLessThanOrEqual(2.2)
      }
    }
    for (let i = 0; i < periods.length; i++) {
      expect(Math.abs(forward[i] - reverse[i])).toBeGreaterThan(1e-12)
    }
  })
})
