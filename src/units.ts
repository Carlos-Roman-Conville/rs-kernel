import data from '../data/units.json' with { type: 'json' }
import prefixes from '../data/unit-prefixes.json' with { type: 'json' }

/** Exponents in the order m, kg, s, K, mol, A, cd, money, count. */
export type Dimension = readonly [number, number, number, number, number, number, number, number, number]
export interface Unit {
  readonly dim: Dimension
  readonly scale: number
  /** SI value = value * scale + offset; only temperature points are affine. */
  readonly offset?: number
}
export interface UnitRow extends Unit { readonly source: string }
export type UnitTable = Readonly<Record<string, UnitRow>>

export const defaultUnits: UnitTable = Object.freeze(Object.fromEntries(
  Object.entries(data).map(([symbol, row]) => [symbol, Object.freeze({
    ...row, dim: Object.freeze([...row.dim]) as unknown as Dimension,
  })]),
))

function dimensions(values: number[]): Dimension {
  if (!values.every(Number.isSafeInteger)) throw new Error('unit dimension exponent must be a safe integer')
  return values.map(value => value === 0 ? 0 : value) as unknown as Dimension
}

function linear(unit: Unit): void {
  if (unit.offset) throw new Error('affine units are only valid as standalone temperature points')
}

/** Products and quotients associate left to right; parentheses group denominators. */
export function parse(expression: string, table: UnitTable = defaultUnits): Unit {
  let at = 0
  const skip = () => { while (/\s/.test(expression[at] ?? '') && at < expression.length) at++ }
  const fail = (): never => { throw new Error(`invalid unit expression ${JSON.stringify(expression)} at ${at}`) }
  const checked = (unit: Unit): Unit => {
    if (!Number.isFinite(unit.scale) || unit.scale <= 0) throw new Error('unit scale must be finite and positive')
    if (unit.dim.length !== 9) throw new Error('unit dimension must have nine exponents')
    dimensions([...unit.dim])
    if (unit.offset !== undefined && (!Number.isFinite(unit.offset) ||
      (unit.offset !== 0 && !unit.dim.every((value, i) => value === (i === 3 ? 1 : 0))))) {
      throw new Error('affine offset must be finite and only applies to temperature points')
    }
    return unit
  }
  const factor = (): Unit => {
    skip()
    let unit: Unit
    if (expression[at] === '(') {
      at++
      unit = product()
      if (expression[at] !== ')') fail()
      at++
    } else {
      const symbol = /^[A-Za-z°%]+\d*|^1/.exec(expression.slice(at))?.[0]
      if (!symbol) return fail()
      at += symbol.length
      // Exact table symbols take precedence over shorthand powers (e.g. m3).
      let name = symbol
      if (!Object.hasOwn(table, name)) {
        const suffix = /\d+$/.exec(name)?.[0]
        if (suffix && name !== '1') { name = name.slice(0, -suffix.length); at -= suffix.length }
      }
      let multiplier = 1
      if (!Object.hasOwn(table, name)) {
        const prefix = name[0] as keyof typeof prefixes.scales
        const base = name.slice(1)
        if (!Object.hasOwn(prefixes.scales, prefix) || !prefixes.symbols.includes(base) || !Object.hasOwn(table, base)) {
          throw new Error(`unknown unit symbol: ${name}`)
        }
        multiplier = prefixes.scales[prefix]
        name = base
      }
      const row = checked(table[name])
      if (multiplier !== 1) linear(row)
      unit = checked({ dim: [...row.dim] as unknown as Dimension, scale: row.scale * multiplier, ...(row.offset === undefined ? {} : { offset: row.offset }) })
    }
    const power = /^(?:\^([+-]?\d+)|([+-]?\d+))/.exec(expression.slice(at))
    if (power) {
      linear(unit)
      at += power[0].length
      const exponent = Number(power[1] ?? power[2])
      if (!Number.isSafeInteger(exponent)) fail()
      unit = { dim: dimensions(unit.dim.map(value => value * exponent)), scale: unit.scale ** exponent }
    }
    return checked(unit)
  }
  const product = (): Unit => {
    let result = factor()
    while (true) {
      const end = at
      skip()
      if (at === expression.length || expression[at] === ')') return result
      let sign = 1
      if (expression[at] === '*' || expression[at] === '/') {
        if (expression[at] === '/') sign = -1
        at++
      } else if (at === end) return fail()
      const right = factor()
      linear(result)
      linear(right)
      result = checked({
        dim: dimensions(result.dim.map((value, i) => value + sign * right.dim[i])),
        scale: sign === 1 ? result.scale * right.scale : result.scale / right.scale,
      })
    }
  }
  const result = product()
  if (at !== expression.length) fail()
  return result
}

export function dim(unit: string | Unit, table: UnitTable = defaultUnits): Dimension {
  return typeof unit === 'string' ? parse(unit, table).dim : unit.dim
}

export function sameDimension(a: string | Unit, b: string | Unit, table: UnitTable = defaultUnits): boolean {
  const left = dim(a, table)
  const right = dim(b, table)
  return left.every((value, i) => value === right[i])
}

export function convert(value: number, from: string, to: string, table: UnitTable = defaultUnits): number {
  const source = parse(from, table)
  const target = parse(to, table)
  if (!sameDimension(source, target)) throw new Error(`unit dimension mismatch: ${from} and ${to}`)
  return (value * source.scale + (source.offset ?? 0) - (target.offset ?? 0)) / target.scale
}
