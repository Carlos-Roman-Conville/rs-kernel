import { describe, expect, it } from 'vitest'
import { Compactor, type CompactorOptions } from '../src/index.ts'

interface Row { t: number; from: string; to: string; amount: number; flagged?: boolean }
const options: CompactorOptions<Row, string> = {
  time: row => row.t,
  key: row => ({ in: row.to, out: row.from }),
  amount: row => row.amount,
  keep: row => row.flagged === true,
}
const fixture = (): Row[] => [
  { t: 0, from: 'a', to: 'b', amount: 10 },
  { t: 1, from: 'b', to: 'a', amount: 3, flagged: true },
  { t: 2, from: 'a', to: 'c', amount: 7 },
  { t: 3, from: 'c', to: 'b', amount: 2 },
  { t: 4, from: 'b', to: 'a', amount: 1 },
]

describe('compaction (DESIGN section 10)', () => {
  it('C-totals: repeated compaction and appends equal full-list per-key in/out totals', () => {
    const full = fixture()
    const rows = [...full]
    const compact = new Compactor(rows, options)
    const check = () => {
      for (const key of ['a', 'b', 'c', 'missing']) {
        expect(compact.into(key)).toBe(full.filter(r => r.to === key).reduce((n, r) => n + r.amount, 0))
        expect(compact.outOf(key)).toBe(full.filter(r => r.from === key).reduce((n, r) => n + r.amount, 0))
      }
    }
    check()
    expect(compact.compact(3)).toBe(2)
    check()
    const next = { t: 5, from: 'a', to: 'c', amount: 11 }
    full.push(next)
    rows.push(next)
    expect(compact.compact(5)).toBe(2)
    check()
    expect(compact.compact(5)).toBe(0)
    check()
  })

  it('C-cursors: absolute cursors still locate the same surviving records across holes and appends', () => {
    const full = fixture()
    const rows = [...full]
    const compact = new Compactor(rows, options)
    const cursor = compact.end
    compact.compact(3)
    expect(compact.baseOffset).toBe(1)
    for (let i = 0; i <= full.length; i++) {
      expect(compact.since(i)).toEqual(full.slice(i).filter(r => r.flagged || r.t >= 3))
    }
    expect(rows[compact.index(3)]).toBe(full[3])
    const next = { t: 5, from: 'a', to: 'b', amount: 5 }
    rows.push(next)
    expect(compact.since(cursor)).toEqual([next])
    compact.compact(5)
    expect(compact.since(cursor)).toEqual([next])
    expect(compact.end).toBe(6)
  })

  it('C-keep: flagged records remain in the original array even before repeated horizons', () => {
    const rows = fixture()
    const kept = rows[1]
    const compact = new Compactor(rows, options)
    compact.compact(100)
    compact.compact(200)
    expect(rows).toEqual([kept])
    expect(rows[0]).toBe(kept)
    expect(compact.into('a')).toBe(4)
    expect(compact.end).toBe(5)
  })

  it('C-horizon: only strictly earlier rows are removed, with no timestamp ordering requirement', () => {
    const rows = fixture().reverse()
    const compact = new Compactor(rows, { ...options, keep: undefined })
    expect(compact.compact(2)).toBe(2)
    expect(rows.map(r => r.t)).toEqual([4, 3, 2])
    expect(compact.compact(0)).toBe(0)
  })

  it('C-order: sums preserve full-list floating-point addition order around kept rows', () => {
    const rows = [1e16, -1e16, 1].map((amount, t) => ({ t, amount, from: 'a', to: 'b', flagged: t === 1 }))
    const compact = new Compactor(rows, options)
    compact.compact(3)
    expect(compact.into('b')).toBe(1)
    expect(compact.outOf('a')).toBe(1)
    compact.compact(4)
    expect(compact.into('b')).toBe(1)
  })

  it('C-empty: complete removal preserves end and the next appended absolute position', () => {
    const rows: Row[] = []
    const compact = new Compactor(rows, options)
    expect(compact.compact(10)).toBe(0)
    expect(compact.baseOffset).toBe(0)
    rows.push(fixture()[0])
    expect(compact.compact(10)).toBe(1)
    expect(compact.baseOffset).toBe(1)
    rows.push(fixture()[2])
    expect(compact.index(1)).toBe(0)
    expect(compact.end).toBe(2)
    expect(compact.into('b')).toBe(10)
  })

  it('C-validation: invalid cursors and horizons throw without removing records', () => {
    const rows = fixture()
    const compact = new Compactor(rows, options)
    for (const cursor of [-1, 0.5, 6, NaN, Infinity]) expect(() => compact.since(cursor)).toThrow('cursor')
    for (const horizon of [NaN, Infinity, -Infinity]) expect(() => compact.compact(horizon)).toThrow('horizon')
    expect(rows).toEqual(fixture())
  })
})
