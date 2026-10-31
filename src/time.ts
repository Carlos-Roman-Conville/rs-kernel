/** Integer milliseconds since the run's epoch; validated at scheduler boundaries. */
export type SimTime = number

export const MS: SimTime = 1
export const SECOND: SimTime = 1_000 * MS
export const MINUTE: SimTime = 60 * SECOND
export const HOUR: SimTime = 60 * MINUTE
export const DAY: SimTime = 24 * HOUR
// IERS / Astronomical Almanac mean tropical year: 365.24219 days (DESIGN.md §2.1).
export const TROPICAL_YEAR: SimTime = 31_556_925_216

export function simTime(value: number, what = 'time'): SimTime {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${what} must be a non-negative safe integer in milliseconds`)
  }
  return value
}
