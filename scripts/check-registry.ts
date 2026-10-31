import { parse } from '../src/units.ts'

export interface MechanismRow {
  id: string
  kind?: string
  status?: string
  writes?: string[]
  reads?: string[]
  aggregates?: { of?: string, by?: string, interface?: string, test?: string } | null
}
export type QuantityKind = 'quantity' | 'categorical' | 'record' | 'text'
export interface Quantity { id: string, kind?: QuantityKind, status?: string, unit: string | null, writer: string | null }
export interface Alias { old: string, new: string }
export interface Declaration {
  /** Label used in failure lines, usually the kernel.json path. */
  file: string
  processes?: { id: string, mechanisms: string[], writes?: string[], reads?: string[] }[]
  ports?: { mechanism: string, quantity: string, kind?: QuantityKind, unit: string | null, direction?: string }[]
  streams?: string[]
}
export interface RegistryData {
  mechanisms: MechanismRow[]
  quantities?: Quantity[]
  aliases?: Alias[]
}

function kindOf(row: { kind?: QuantityKind }): QuantityKind {
  return row.kind === undefined ? 'quantity' : row.kind
}

function valueError(row: { kind?: QuantityKind, unit: string | null }): string | null {
  const kind = kindOf(row)
  if (!['quantity', 'categorical', 'record', 'text'].includes(kind)) return `unknown quantity kind: ${JSON.stringify(kind)}`
  if (kind !== 'quantity') return row.unit === null ? null : `${kind} kind requires unit: null`
  return unitError(row.unit)
}

/** `unitless` is free text for the dimensionless unit `1`. */
function unitError(unit: string | null | undefined): string | null {
  if (unit === null || unit === undefined || unit === '') return 'has no unit'
  try { parse(unit === 'unitless' ? '1' : unit) } catch (e) { return (e as Error).message }
  return null
}

function dimensionOf(unit: string | null | undefined): string | null {
  if (unitError(unit)) return null
  return parse(unit === 'unitless' ? '1' : unit as string).dim.join(',')
}

/** Returns one line per failure; empty when the declarations agree with the registry. */
export function checkRegistry(registry: RegistryData, declarations: Declaration[], options: { all?: boolean } = {}): string[] {
  const failures: string[] = []
  const aliasOf = new Map((registry.aliases ?? []).map(a => [a.old, a.new]))
  const resolve = (id: string): string => {
    const seen = new Set<string>()
    while (aliasOf.has(id) && !seen.has(id)) { seen.add(id); id = aliasOf.get(id) as string }
    return id
  }
  const index = <T extends { id: string, status?: string }>(entries: T[], kind: string): Map<string, T> => {
    const result = new Map<string, T>()
    for (const row of entries) {
      if (row.status === 'retired') continue
      const id = resolve(row.id)
      const previous = result.get(id)
      if (previous) {
        failures.push(`${id}: registry conflict: ${kind} rows ${previous.id} and ${row.id} resolve to the same id`)
      } else result.set(id, row)
    }
    return result
  }
  const rows = index(registry.mechanisms.filter(row => row.kind === 'mechanism' && row.status === 'built'), 'mechanism')
  const quantities = index(registry.quantities ?? [], 'quantity')
  const hasMechanism = (id: string) => rows.has(resolve(id))
  const used = new Set<string>()
  const named = new Set<string>()
  for (const d of declarations) {
    for (const p of d.processes ?? []) for (const m of p.mechanisms) named.add(resolve(m))
    for (const p of d.ports ?? []) named.add(resolve(p.mechanism))
    for (const m of d.streams ?? []) named.add(resolve(m))
  }
  const declaredWriters = new Map<string, Set<Declaration>>()
  const recordWrite = (q: string, d: Declaration) => {
    if (!declaredWriters.has(q)) declaredWriters.set(q, new Set())
    declaredWriters.get(q)!.add(d)
  }

  // Which built mechanisms write each quantity, from the registry rows.
  const writers = new Map<string, Set<string>>()
  for (const [id, row] of rows) {
    for (const q of row.writes ?? []) {
      const key = resolve(q)
      if (!writers.has(key)) writers.set(key, new Set())
      writers.get(key)?.add(id)
      if (options.all) used.add(key)
    }
    if (options.all) for (const q of row.reads ?? []) used.add(resolve(q))
    const agg = row.aggregates
    if (agg && (options.all || named.has(id))) {
      const known = (id: string | undefined) => !!id && (hasMechanism(id) || quantities.has(resolve(id)))
      if (!known(agg.of)) failures.push(`${id}: aggregates.of ${JSON.stringify(agg.of)} names no mechanism or quantity`)
      if (!known(agg.by)) failures.push(`${id}: aggregates.by ${JSON.stringify(agg.by)} names no mechanism or quantity`)
      if (!agg.interface?.trim()) failures.push(`${id}: aggregates.interface is empty`)
      if (!agg.test?.trim()) failures.push(`${id}: aggregates.test is empty`)
    }
  }

  for (const d of declarations) {
    const where = d.file
    const checkMechanism = (id: string, what: string) => {
      if (!hasMechanism(id)) failures.push(`${where}: ${what} names mechanism ${id} with no built row`)
    }
    for (const p of d.processes ?? []) {
      const mechanisms = p.mechanisms.map(resolve)
      for (const m of p.mechanisms) checkMechanism(m, `process ${p.id}`)
      for (const raw of p.reads ?? []) {
        used.add(resolve(raw))
        if (!quantities.has(resolve(raw))) failures.push(`${where}: process ${p.id} reads quantity ${raw} absent from quantities.json`)
      }
      for (const raw of p.writes ?? []) {
        const q = resolve(raw)
        used.add(q)
        recordWrite(q, d)
        const quantity = quantities.get(q)
        if (!quantity) { failures.push(`${where}: process ${p.id} writes quantity ${raw} absent from quantities.json`); continue }
        const writer = quantity.writer === null ? null : resolve(quantity.writer)
        if (writer !== null && !mechanisms.includes(writer)) {
          failures.push(`${where}: process ${p.id} writes ${q} but its writer is ${writer}, not one of the process mechanisms`)
        }
      }
    }
    for (const port of d.ports ?? []) {
      const q = resolve(port.quantity)
      used.add(q)
      if (port.direction === 'out' || port.direction === 'output') {
        recordWrite(q, d)
        const quantity = quantities.get(q)
        if (quantity && resolve(port.mechanism) !== (quantity.writer === null ? null : resolve(quantity.writer))) {
          failures.push(`${where}: port ${port.mechanism}/${q} writes but its writer is ${quantity.writer ?? 'null'}`)
        }
      }
      checkMechanism(port.mechanism, `port ${port.quantity}`)
      const error = valueError(port)
      if (error) { failures.push(`${where}: port ${port.mechanism}/${q} unit ${JSON.stringify(port.unit)}: ${error}`); continue }
      const quantity = quantities.get(q)
      if (!quantity) { failures.push(`${where}: port ${port.mechanism} uses quantity ${port.quantity} absent from quantities.json`); continue }
      if (kindOf(port) !== kindOf(quantity)) {
        failures.push(`${where}: port ${port.mechanism}/${q} kind ${kindOf(port)} differs from the quantity kind ${kindOf(quantity)}`)
        continue
      }
      if (kindOf(quantity) !== 'quantity') continue
      const want = dimensionOf(quantity.unit)
      if (want !== null && want !== dimensionOf(port.unit)) {
        failures.push(`${where}: port ${port.mechanism}/${q} unit ${port.unit} differs in dimension from the quantity unit ${quantity.unit}`)
      }
    }
    for (const stream of d.streams ?? []) checkMechanism(stream, 'stream')
  }

  for (const [q, set] of writers) {
    if (!options.all && !used.has(q)) continue
    const quantity = quantities.get(q)
    if (!quantity) { failures.push(`${q}: written by ${[...set].join(', ')} but absent from quantities.json`); continue }
    if (set.size > 1) failures.push(`${q}: written by two mechanisms: ${[...set].sort().join(', ')}`)
    const writer = quantity.writer === null ? null : resolve(quantity.writer)
    for (const m of [...set].sort()) {
      if (m !== writer) failures.push(`${q}: written by ${m} but its writer is ${writer ?? 'null'}`)
    }
  }

  for (const [q, set] of declaredWriters) {
    if (set.size > 1) failures.push(`${q}: written by multiple declarations: ${[...set].map(d => d.file).sort().join(', ')}`)
  }

  for (const q of [...used].sort()) {
    const quantity = quantities.get(q)
    if (!quantity) continue
    if (!options.all && (quantity.writer === null || !hasMechanism(quantity.writer))) {
      failures.push(`${q}: writer ${quantity.writer ?? 'null'} has no built row`)
    }
    const error = valueError(quantity)
    if (error) failures.push(`${q}: unit ${JSON.stringify(quantity.unit)}: ${error}`)
  }
  return failures
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('check-registry.ts')) {
  const { readFileSync, existsSync } = await import('node:fs')
  const args = process.argv.slice(2)
  const all = args.includes('--all')
  const [dir, ...files] = args.filter(arg => arg !== '--all')
  if (!dir || files.length === 0) {
    console.error('usage: check-registry.ts [--all] <registry dir> <kernel.json…>')
    process.exit(2)
  }
  const load = (name: string): any => {
    const path = `${dir}/${name}`
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
  }
  const registry: RegistryData = {
    mechanisms: load('mechanisms.json').mechanisms,
    quantities: load('quantities.json')?.quantities ?? [],
    aliases: load('aliases.json')?.aliases ?? [],
  }
  const declarations = files.map(file => ({ file, ...JSON.parse(readFileSync(file, 'utf8')) }) as Declaration)
  const failures = checkRegistry(registry, declarations, { all })
  for (const line of failures) console.log(line)
  process.exit(failures.length ? 1 : 0)
}
