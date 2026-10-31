/** The legacy realism mulberry32 generator, preserved exactly for adoption. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** FNV-1a over UTF-8 bytes, returning an unsigned 32-bit integer. */
export function fnv1a32(id: string): number {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(id)) hash = Math.imul(hash ^ byte, 0x01000193)
  return hash >>> 0
}

/** XOR the two words, then apply the MurmurHash3 32-bit finaliser. */
export function mix32(seed: number, hash: number): number {
  let h = seed ^ hash
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

export type RandomStream = () => number
export type StreamsState = Record<string, number>
export interface RandomStreams {
  get(mechanismId: string, entityId?: string): RandomStream
  state(): StreamsState
  restore(state: StreamsState): void
}

/** Independent mechanism and entity streams. Restore uses the same run seed as the snapshot. */
export function streams(runSeed: number): RandomStreams {
  const entries = new Map<string, { seed: number; value: number; draw: RandomStream }>()
  const initial = (id: string) => mix32(runSeed, fnv1a32(id))
  function get(mechanismId: string, entityId?: string): RandomStream {
    const id = entityId === undefined ? mechanismId : `${mechanismId}@${entityId}`
    let entry = entries.get(id)
    if (!entry) {
      const seed = entityId === undefined ? initial(mechanismId) : mix32(initial(mechanismId), fnv1a32(entityId))
      const created = {
        seed,
        value: seed,
        draw: () => {
          // Keep stream state bounded to 32 bits, including across long runs.
          created.value = (created.value + 0x6D2B79F5) >>> 0
          let t = created.value
          t = Math.imul(t ^ (t >>> 15), t | 1)
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        },
      }
      entry = created
      entries.set(id, entry)
    }
    return entry.draw
  }
  return {
    get,
    state: () => Object.fromEntries([...entries.keys()].sort().map(id => [id, entries.get(id)!.value])),
    restore(state) {
      const ids = Object.keys(state).sort()
      for (const id of ids) {
        if (!Number.isInteger(state[id]) || state[id] < 0 || state[id] > 0xffffffff) {
          throw new Error(`invalid RNG state: ${id}`)
        }
      }
      // Existing handles survive restore; streams absent from the snapshot rewind to their seed.
      for (const [id, entry] of entries) entry.value = Object.hasOwn(state, id) ? state[id] : entry.seed
      for (const id of ids) {
        if (!entries.has(id)) {
          const separator = id.indexOf('@')
          if (separator < 0) get(id)
          else get(id.slice(0, separator), id.slice(separator + 1))
        }
        entries.get(id)!.value = state[id]
      }
    },
  }
}
