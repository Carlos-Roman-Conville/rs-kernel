export function must<T>(table: Record<string, T>, id: string, what: string): T {
  if (!Object.hasOwn(table, id)) throw new Error(`unknown ${what}: ${id}`)
  return table[id]
}

export function nonempty(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${what} must be a non-empty string`)
  return value
}

export function finite(value: unknown, what: string, min = Number.NEGATIVE_INFINITY): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) throw new Error(`${what} must be a number >= ${min}`)
  return value
}

export function integer(value: unknown, what: string, min: number): number {
  finite(value, what, min)
  if (!Number.isInteger(value)) throw new Error(`${what} must be an integer`)
  return value as number
}
