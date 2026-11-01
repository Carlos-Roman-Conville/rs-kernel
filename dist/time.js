export const MS = 1;
export const SECOND = 1_000 * MS;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
// IERS / Astronomical Almanac mean tropical year: 365.24219 days (DESIGN.md §2.1).
export const TROPICAL_YEAR = 31_556_925_216;
export function simTime(value, what = 'time') {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${what} must be a non-negative safe integer in milliseconds`);
    }
    return value;
}
