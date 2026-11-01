import type { StreamsState } from './rng.ts'
import type { SimTime } from './time.ts'
import type { Participant } from './transaction.ts'

export interface Snapshot {
  kernel: {
    version: number
    t: SimTime
    epoch: number | null
    epochLabel?: string
    catalogue_hash: string | null
    seed: number
    eventCounter: number
    rng: StreamsState
  }
  engines: Record<string, unknown>
}

/** Validate host-supplied epoch and catalogue metadata without interpreting it. */
export function checkKernelBlock(block: unknown): void {
  if (block === null || typeof block !== 'object' || Array.isArray(block)) {
    throw new Error('snapshot kernel block must be an object')
  }
  const value = block as Record<string, unknown>
  if (value.version !== 2) throw new Error('snapshot kernel version must be 2')
  if (value.epoch !== null && (typeof value.epoch !== 'number' || !Number.isFinite(value.epoch))) {
    throw new Error('snapshot kernel epoch must be null or a finite number')
  }
  if ('epochLabel' in value && typeof value.epochLabel !== 'string') {
    throw new Error('snapshot kernel epochLabel must be absent or a string')
  }
  if (value.catalogue_hash !== null &&
      (typeof value.catalogue_hash !== 'string' || !/^[0-9a-f]{64}$/.test(value.catalogue_hash))) {
    throw new Error('snapshot kernel catalogue_hash must be null or 64 lowercase hex characters')
  }
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
  checkKernelBlock(snapshot.kernel)
  validateParticipants(participants)
  for (const { id } of participants) {
    if (!Object.hasOwn(snapshot.engines, id)) throw new Error(`missing snapshot participant: ${id}`)
  }
  const saved = structuredClone(snapshot)
  for (const participant of participants) participant.restore(saved.engines[participant.id])
  return saved.kernel
}
