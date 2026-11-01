import { parse } from '../src/units.ts'
import type { EventContract, PayloadField } from '../src/events.ts'

export type { EventContract, PayloadField }
export interface EventContracts { events: EventContract[] }

export interface MechanismRow {
  id: string
  kind?: string
  status?: string
  writes?: string[]
  reads?: string[]
  rate_limiter?: string | null
  failure_mode?: string | null
  vv?: {
    implemented?: boolean
    integrated?: boolean | string
    validated?: string
    record?: {
      integration_tested_with?: string[]
      integration_tests?: string[]
      numerical?: {
        stability?: string | null
        coupled_update_consistency?: string | null
        sensitivity?: string | null
      }
    }
  }
  aggregates?: { of?: string, by?: string, interface?: string, test?: string } | null
}
export type QuantityKind = 'quantity' | 'categorical' | 'record' | 'text'
export interface Quantity { id: string, kind?: QuantityKind, status?: string, unit: string | null, writer: string | null, written_by?: string | null }
export interface Alias { old: string, new: string }
export interface Declaration {
  /** Label used in failure lines, usually the kernel.json path. */
  file: string
  engine?: string
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

function isHostInput(quantity: Quantity): boolean {
  return quantity.written_by?.trim().toLowerCase().startsWith('host') ?? false
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

function registryIndex(registry: RegistryData, failures: string[] = []) {
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
  return { resolve, rows, quantities }
}

/** Returns one line per failure; empty when the declarations agree with the registry. */
export function checkRegistry(registry: RegistryData, declarations: Declaration[], options: { all?: boolean } = {}): string[] {
  const failures: string[] = []
  const { resolve, rows, quantities } = registryIndex(registry, failures)
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
    const checkRead = (q: string) => {
      if (d.engine !== 'history' && q.startsWith('history.')) {
        failures.push(`${where}: ${d.engine ?? 'undeclared engine'} reads ${q}; only History may read history.*`)
      }
    }
    const checkWrite = (q: string) => {
      if (d.engine === 'history' && !q.startsWith('history.')) {
        failures.push(`${where}: history writes ${q}; History may write only history.*`)
      }
    }
    const checkMechanism = (id: string, what: string) => {
      if (!hasMechanism(id)) failures.push(`${where}: ${what} names mechanism ${id} with no built row`)
    }
    for (const p of d.processes ?? []) {
      const mechanisms = p.mechanisms.map(resolve)
      for (const m of p.mechanisms) checkMechanism(m, `process ${p.id}`)
      for (const raw of p.reads ?? []) {
        checkRead(resolve(raw))
        used.add(resolve(raw))
        if (!quantities.has(resolve(raw))) failures.push(`${where}: process ${p.id} reads quantity ${raw} absent from quantities.json`)
      }
      for (const raw of p.writes ?? []) {
        const q = resolve(raw)
        used.add(q)
        recordWrite(q, d)
        checkWrite(q)
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
      if (port.direction !== undefined && !['in', 'input', 'out', 'output', 'call'].includes(port.direction)) {
        failures.push(`${where}: port ${port.mechanism}/${q} has unknown direction ${JSON.stringify(port.direction)}`)
      }
      if (port.direction === 'out' || port.direction === 'output') {
        checkWrite(q)
        recordWrite(q, d)
        const quantity = quantities.get(q)
        if (quantity && resolve(port.mechanism) !== (quantity.writer === null ? null : resolve(quantity.writer))) {
          failures.push(`${where}: port ${port.mechanism}/${q} writes but its writer is ${quantity.writer ?? 'null'}`)
        }
      }
      if (port.direction === undefined || ['in', 'input', 'call'].includes(port.direction)) checkRead(q)
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
    if (!options.all && (quantity.writer === null || !hasMechanism(quantity.writer)) && !isHostInput(quantity)) {
      failures.push(`${q}: writer ${quantity.writer ?? 'null'} has no built row`)
    }
    const error = valueError(quantity)
    if (error) failures.push(`${q}: unit ${JSON.stringify(quantity.unit)}: ${error}`)
  }
  return failures
}

/** Advisory V&V gaps; these never contribute to registry failures. */
export function checkWarnings(registry: RegistryData, declarations: Declaration[], options: { all?: boolean } = {}): string[] {
  const { resolve, rows, quantities } = registryIndex(registry)
  const warnings = new Set<string>()
  const named = new Set<string>()
  const used = new Set<string>()
  const wired = new Map<string, Set<string>>()
  const writers = new Map<string, Set<string>>()
  const readers = new Map<string, Set<string>>()
  const connect = (index: Map<string, Set<string>>, quantity: string, mechanism: string) => {
    const m = resolve(mechanism)
    if (!rows.has(m)) return
    const q = resolve(quantity)
    if (!index.has(q)) index.set(q, new Set())
    index.get(q)!.add(m)
  }
  for (const [q, row] of quantities) {
    if (row.writer !== null) connect(writers, q, row.writer)
  }
  for (const [m, row] of rows) {
    if (options.all) for (const q of [...(row.reads ?? []), ...(row.writes ?? [])]) used.add(resolve(q))
    for (const q of row.writes ?? []) connect(writers, q, m)
    for (const q of row.reads ?? []) connect(readers, q, m)
  }
  for (const d of declarations) {
    for (const p of d.processes ?? []) {
      for (const q of [...(p.reads ?? []), ...(p.writes ?? [])]) used.add(resolve(q))
      for (const m of p.mechanisms) {
        named.add(resolve(m))
        for (const q of p.writes ?? []) connect(writers, q, m)
        for (const q of p.reads ?? []) connect(readers, q, m)
      }
    }
    for (const m of d.streams ?? []) named.add(resolve(m))
    if (!wired.has(d.file)) wired.set(d.file, new Set())
    for (const p of d.ports ?? []) {
      const m = resolve(p.mechanism)
      const q = resolve(p.quantity)
      used.add(q)
      named.add(m)
      connect(p.direction === 'out' || p.direction === 'output' ? writers : readers, q, m)
      const row = rows.get(m)
      if (!row || wired.get(d.file)!.has(m)) continue
      wired.get(d.file)!.add(m)
      const integrated = row.vv?.integrated ?? ''
      if (integrated === true || (typeof integrated === 'string' && integrated.trim().toLowerCase().startsWith('yes'))) continue
      warnings.add(`warning: ${d.file}: port ${m}/${q} is wired but ${m} is not marked integrated (vv.integrated: ${JSON.stringify(integrated)})`)
    }
  }
  for (const q of used) {
    const quantity = quantities.get(q)
    if (quantity && isHostInput(quantity) && (quantity.writer === null || !rows.has(resolve(quantity.writer)))) {
      warnings.add(`warning: ${q}: host input, no built writer (written_by: ${JSON.stringify(quantity.written_by)})`)
    }
  }
  const covers = (a: string, b: string) => {
    const record = rows.get(a)!.vv?.record
    return !!record?.integration_tests?.length && (record.integration_tested_with ?? []).some(m => resolve(m) === b)
  }
  const pairs = new Map<string, Map<string, Set<string>>>()
  for (const [q, sources] of writers) {
    for (const a of sources) for (const b of readers.get(q) ?? []) {
      if (a === b || (!options.all && !named.has(a) && !named.has(b)) || covers(a, b) || covers(b, a)) continue
      if (!pairs.has(a)) pairs.set(a, new Map())
      const targets = pairs.get(a)!
      if (!targets.has(b)) targets.set(b, new Set())
      targets.get(b)!.add(q)
    }
  }
  for (const [a, targets] of pairs) for (const [b, qs] of targets) {
    warnings.add(`warning: ${a} -> ${b} via ${[...qs].sort().join(',')}: connected with no named integration test`)
  }
  return [...warnings].sort()
}

/** Advisory schema 4 field gaps; these never contribute to registry failures. */
export function checkFieldWarnings(registry: RegistryData, declarations: Declaration[], options: { all?: boolean } = {}): string[] {
  const { resolve, rows } = registryIndex(registry)
  const warnings = new Set<string>()
  const named = new Set<string>()
  for (const d of declarations) {
    for (const p of d.processes ?? []) for (const m of p.mechanisms) named.add(resolve(m))
    for (const p of d.ports ?? []) named.add(resolve(p.mechanism))
    for (const m of d.streams ?? []) named.add(resolve(m))
  }
  const empty = (value: string | null | undefined) => value == null || value.trim() === ''
  for (const [id, row] of rows) {
    if (!options.all && !named.has(id)) continue
    if (empty(row.rate_limiter)) warnings.add(`warning: ${id}: has no rate_limiter`)
    if (empty(row.failure_mode)) warnings.add(`warning: ${id}: has no failure_mode`)
    const record = row.vv?.record
    if (record?.integration_tests?.length && empty(record.numerical?.stability)) {
      warnings.add(`warning: ${id}: has an integration test but no numerical.stability`)
    }
  }
  return [...warnings].sort()
}

/** Advisory event vocabulary checks; contracts never contribute to failures. */
export function checkEventContracts(registry: RegistryData, events: EventContracts): string[] {
  const kinds = new Set(['number', 'integer', 'string', 'boolean', 'id', 'list', 'record'])
  const { resolve, quantities } = registryIndex(registry)
  const mechanisms = new Set(registry.mechanisms.filter(row => row.kind === 'mechanism').map(row => resolve(row.id)))
  const warnings: string[] = []
  const seen = new Set<string>()
  for (const event of events.events) {
    const warn = (message: string) => warnings.push(`warning: ${event.type}: ${message}`)
    if (seen.has(event.type)) warn('duplicate event type')
    seen.add(event.type)
    if (!mechanisms.has(resolve(event.producer))) warn(`producer ${event.producer} is not a mechanism row`)
    for (const consumer of event.consumers) {
      if (!mechanisms.has(resolve(consumer))) warn(`consumer ${consumer} is not a mechanism row`)
    }
    for (const [name, field] of Object.entries(event.payload)) {
      if (!kinds.has(field.kind)) warn(`field ${name} has unknown kind ${field.kind}`)
      if (field.of !== undefined && !kinds.has(field.of)) warn(`field ${name} has unknown kind ${field.of}`)
      if (field.nullable !== undefined && typeof field.nullable !== 'boolean') warn(`field ${name} nullable must be a boolean`)
      const quantity = field.quantity === undefined ? undefined : quantities.get(resolve(field.quantity))
      if (field.quantity !== undefined && !quantity) warn(`field ${name} quantity ${field.quantity} absent from quantities.json`)
      if (field.unit !== undefined) {
        let dimension: string | undefined
        try { dimension = parse(field.unit).dim.join(',') } catch { warn(`field ${name} unit ${JSON.stringify(field.unit)} does not parse`) }
        const want = quantity && dimensionOf(quantity.unit)
        if (dimension !== undefined && want && dimension !== want) {
          warn(`field ${name} unit ${field.unit} differs in dimension from the quantity unit ${quantity!.unit}`)
        }
      }
      if (field.kind === 'list' && field.of === undefined) warn(`field ${name} list has no of`)
    }
  }
  return warnings.sort()
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
  for (const line of checkWarnings(registry, declarations, { all })) console.log(line)
  for (const line of checkFieldWarnings(registry, declarations, { all })) console.log(line)
  const events = load('events.json') as EventContracts | null
  if (events) for (const line of checkEventContracts(registry, events)) console.log(line)
  process.exit(failures.length ? 1 : 0)
}
