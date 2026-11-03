import { parse } from '../src/index.ts'

export type EvidenceClass = 'researched' | 'estimate' | 'fiction' | 'fixture' | 'assumption'
export interface Parameter {
  id: string
  owner: string
  value: number | 'unbounded' | null
  unit: string
  evidence: EvidenceClass
  source: string
}
export interface Requirement { id: string; owner: string; unit: string; allowUnbounded?: boolean }
export interface Reference { kind: string; id: string }

export class ConfigurationError extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    super(problems.join('\n'))
    this.name = 'ConfigurationError'
    this.problems = [...problems]
  }
}

const evidenceClasses = new Set<EvidenceClass>(['researched', 'estimate', 'fiction', 'fixture', 'assumption'])

/** Validate owner declarations before scheduling; no values or domain rules are supplied here. */
export function loadCheck(input: {
  parameters: Parameter[]
  requirements: Requirement[]
  references?: Reference[]
  resolve?: (ref: Reference) => boolean
}): ReadonlyMap<string, Parameter> {
  const problems: string[] = []
  const parameters = new Map<string, Parameter>()
  const checkUnit = (unit: string, label: string) => {
    try { parse(unit) } catch { problems.push(`invalid unit ${unit} for ${label}`) }
  }

  for (const parameter of input.parameters) {
    const { id, value, unit, evidence, source } = parameter
    if (parameters.has(id)) problems.push(`duplicate parameter ${id}`)
    else parameters.set(id, Object.freeze({ ...parameter }))
    if (value === null) problems.push(`unknown ${id}`)
    else if (value !== 'unbounded' && !Number.isFinite(value)) problems.push(`non-finite ${id}`)
    checkUnit(unit, id)
    if (!evidenceClasses.has(evidence)) problems.push(`invalid evidence ${id}`)
    if (!source.trim()) problems.push(`empty source ${id}`)
  }

  for (const requirement of input.requirements) {
    const { id, owner, unit, allowUnbounded } = requirement
    checkUnit(unit, `requirement ${id}`)
    if (!parameters.has(id)) problems.push(`missing ${id} (${owner})`)
    // Check every duplicate too, so a bad declaration cannot hide behind a valid one.
    for (const parameter of input.parameters.filter(parameter => parameter.id === id)) {
      if (parameter.value === 'unbounded' && !allowUnbounded) problems.push(`${id} may not be unbounded`)
      if (parameter.unit !== unit) problems.push(`unit mismatch ${id}: ${parameter.unit} expected ${unit}`)
    }
  }

  for (const ref of input.references ?? []) {
    if (!input.resolve || !input.resolve(ref)) problems.push(`unresolved ${ref.kind} ${ref.id}`)
  }
  if (problems.length) throw new ConfigurationError(problems)

  // Freezing a Map alone leaves set/delete/clear usable. Keep it private instead.
  const result: ReadonlyMap<string, Parameter> = Object.freeze({
    size: parameters.size,
    get: (id: string) => parameters.get(id),
    has: (id: string) => parameters.has(id),
    entries: () => parameters.entries(),
    keys: () => parameters.keys(),
    values: () => parameters.values(),
    [Symbol.iterator]: () => parameters[Symbol.iterator](),
    forEach(callback: (value: Parameter, key: string, map: ReadonlyMap<string, Parameter>) => void, thisArg?: unknown) {
      parameters.forEach((value, key) => callback.call(thisArg, value, key, result))
    },
  })
  return result
}
