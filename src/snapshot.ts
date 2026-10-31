import type { StreamsState } from './rng.ts'
import type { SimTime } from './time.ts'
import type { Participant } from './transaction.ts'

export interface Snapshot {
  kernel: {
    version: number
    t: SimTime
    epoch: string
    seed: number
    eventCounter: number
    rng: StreamsState
  }
  engines: Record<string, unknown>
}

/** Plain JSON comparison only: undefined properties/elements are dropped, not reordered. */
export function canonical(value: unknown): string {
  const ancestors = new Set<object>()
  function write(value: unknown): string {
    if (value === null) return 'null'
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('canonical requires finite numbers')
      return JSON.stringify(value)
    }
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
    if (typeof value !== 'object') throw new Error('canonical requires plain JSON values')
    if (ancestors.has(value)) throw new Error('canonical rejects circular references')
    ancestors.add(value)
    try {
      if (Array.isArray(value)) {
        return `[${value.filter(item => item !== undefined).map(write).join(',')}]`
      }
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error('canonical requires plain JSON objects')
      }
      const object = value as Record<string, unknown>
      return `{${Object.keys(object).sort().filter(key => object[key] !== undefined)
        .map(key => `${JSON.stringify(key)}:${write(object[key])}`).join(',')}}`
    } finally {
      ancestors.delete(value)
    }
  }
  // A root undefined has no JSON representation and is rejected like other non-JSON values.
  return write(value)
}

/** FNV-1a over UTF-8 bytes, as a zero-padded lowercase 64-bit hex label. */
export function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(value)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

function validateParticipants(participants: readonly Participant[]): void {
  const ids = new Set<string>()
  for (const { id } of participants) {
    if (!id.trim()) throw new Error('participant id must be non-empty')
    if (ids.has(id)) throw new Error(`duplicate participant: ${id}`)
    ids.add(id)
  }
}

/** Capture detached parts without canonicalizing: engine insertion order must survive. */
export function take(participants: readonly Participant[], kernelPart: Snapshot['kernel']): Snapshot {
  validateParticipants(participants)
  return structuredClone({
    kernel: kernelPart,
    engines: Object.fromEntries(participants.map(participant => [participant.id, participant.snapshot()])),
  })
}

/** Restore requested adapters; return detached kernel state for the host to apply. */
export function restore(participants: readonly Participant[], snapshot: Snapshot): Snapshot['kernel'] {
  validateParticipants(participants)
  for (const { id } of participants) {
    if (!Object.hasOwn(snapshot.engines, id)) throw new Error(`missing snapshot participant: ${id}`)
  }
  const saved = structuredClone(snapshot)
  for (const participant of participants) participant.restore(saved.engines[participant.id])
  return saved.kernel
}
