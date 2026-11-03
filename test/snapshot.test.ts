// @ts-expect-error The repo omits Node typings; node:crypto is provided by the test runtime.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonical, comparable, fnv1a64, take, restore, checkKernelBlock, simTime, type Participant, type Snapshot } from '../src/index.ts'

const kernel = (): Snapshot['kernel'] => ({
  version: 2, t: simTime(1000), epoch: 1690.0, epochLabel: '1690-01-01', catalogue_hash: null,
  seed: 42, eventCounter: 3, rng: { mechanism: 123 },
})

describe('snapshot version 2 kernel rules', () => {
  const hash = createHash('sha256').update('fixture').digest('hex')

  it('accepts a fixture sha256 or null catalogue hash and finite or null epochs', () => {
    for (const catalogue_hash of [hash, null]) {
      for (const epoch of [1690.0, 0, -0.5, null]) {
        expect(() => checkKernelBlock({ ...kernel(), epoch, catalogue_hash })).not.toThrow()
      }
    }
    const block = kernel()
    delete block.epochLabel
    expect(() => checkKernelBlock(block)).not.toThrow()
  })

  it.each([hash.toUpperCase(), hash.slice(1), '', undefined, 42])('rejects invalid catalogue hash %s', catalogue_hash => {
    expect(() => checkKernelBlock({ ...kernel(), catalogue_hash })).toThrow('catalogue_hash')
  })

  it.each(['1690-01-01', NaN, Infinity, -Infinity, undefined])('rejects invalid epoch %s', epoch => {
    expect(() => checkKernelBlock({ ...kernel(), epoch })).toThrow('epoch')
  })

  it('rejects version 1, non-string labels, and missing blocks', () => {
    expect(() => checkKernelBlock({ ...kernel(), version: 1 })).toThrow('version')
    for (const epochLabel of [null, 42, undefined]) {
      expect(() => checkKernelBlock({ ...kernel(), epochLabel })).toThrow('epochLabel')
    }
    for (const block of [null, undefined, [], 2]) {
      expect(() => checkKernelBlock(block)).toThrow('block')
    }
  })

  it('canonical round-trips a version 2 kernel block', () => {
    const block = { ...kernel(), catalogue_hash: hash }
    const restored = JSON.parse(canonical(block))
    checkKernelBlock(restored)
    expect(restored).toEqual(block)
    expect(canonical(restored)).toBe(canonical(block))
  })

  it('restore rejects invalid kernel metadata before mutating participants', () => {
    const a = engine('a', 1)
    const snapshot = take([a.participant], kernel())
    snapshot.kernel.version = 1
    a.participant.restore(2)
    expect(() => restore([a.participant], snapshot)).toThrow('version')
    expect(a.state()).toBe(2)
  })
})

function engine(id: string, initial: unknown) {
  let state = initial
  const participant: Participant = {
    id, snapshot: () => state, restore: saved => { state = saved },
  }
  return { participant, state: () => state }
}

describe('snapshot code versions', () => {
  it('round-trips detached versions through take and restore', () => {
    const versions = { kernel: 'abc123', economy: '1.2.3' }
    const snapshot = take([], { ...kernel(), versions })
    versions.kernel = 'changed'
    const restored = restore([], snapshot)
    expect(restored.versions).toEqual({ kernel: 'abc123', economy: '1.2.3' })
    restored.versions!.kernel = 'changed again'
    expect(snapshot.kernel.versions!.kernel).toBe('abc123')
    expect(snapshot.kernel.version).toBe(2)
  })

  it.each([undefined, null, [], 'abc', 42, { kernel: '' }, { kernel: 42 }, new Date()])(
    'rejects malformed versions %s', versions => {
      const block = { ...kernel(), versions } as Snapshot['kernel']
      expect(() => checkKernelBlock(block)).toThrow('versions')
      expect(() => restore([], { kernel: block, engines: {} })).toThrow('versions')
    },
  )

  it('compares equal versions regardless of key order, including empty records', () => {
    const a = take([], { ...kernel(), versions: { kernel: 'abc', economy: '1' } })
    const b = take([], { ...kernel(), versions: { economy: '1', kernel: 'abc' } })
    expect(comparable(a, b)).toEqual({ ok: true, differences: [] })
    const empty = take([], { ...kernel(), versions: {} })
    expect(comparable(empty, empty)).toEqual({ ok: true, differences: [] })
  })

  it('names every changed or missing key in either direction', () => {
    const a = take([], { ...kernel(), versions: { kernel: 'abc', economy: '1', stable: '1' } })
    const b = take([], { ...kernel(), versions: { kernel: 'def', reality: '2', stable: '1' } })
    const expected = { ok: false, differences: ['economy', 'kernel', 'reality'] }
    expect(comparable(a, b)).toEqual(expected)
    expect(comparable(b, a)).toEqual(expected)
  })

  it('refuses comparison when either snapshot has no versions', () => {
    const legacy = take([], kernel())
    const recorded = take([], { ...kernel(), versions: { kernel: 'abc' } })
    const expected = { ok: false, differences: ['versions not recorded'] }
    expect(comparable(legacy, recorded)).toEqual(expected)
    expect(comparable(recorded, legacy)).toEqual(expected)
    expect(comparable(legacy, legacy)).toEqual(expected)
  })
})

describe('snapshot canonical comparison rules', () => {
  it('canonical sorts keys at every depth, including numeric keys lexically', () => {
    expect(canonical({ z: [{ b: 2, a: 1 }], a: { 2: 'two', 10: 'ten' } }))
      .toBe('{"a":{"10":"ten","2":"two"},"z":[{"a":1,"b":2}]}')
    expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }))
  })

  it('canonical drops undefined at every depth and keeps remaining array order', () => {
    expect(canonical({ absent: undefined, list: [3, undefined, { b: undefined, a: 1 }, 2] }))
      .toBe('{"list":[3,{"a":1},2]}')
  })

  it('canonical writes negative zero as zero and preserves JSON scalar encoding', () => {
    expect(canonical([-0, 0.1, null, true, 'quote"\n'])).toBe(JSON.stringify([0, 0.1, null, true, 'quote"\n']))
  })

  it.each([NaN, Infinity, -Infinity])('canonical rejects nonfinite number %s even when nested', value => {
    expect(() => canonical({ nested: [value] })).toThrow('finite')
  })

  it('canonical rejects cycles and non-JSON data but permits repeated references', () => {
    const shared = { b: 2, a: 1 }
    expect(canonical([shared, shared])).toBe('[{"a":1,"b":2},{"a":1,"b":2}]')
    const cycle: unknown[] = []
    cycle.push(cycle)
    expect(() => canonical(cycle)).toThrow('circular')
    for (const value of [undefined, 1n, new Map(), new Date(), () => 1, Symbol('x')]) {
      expect(() => canonical(value)).toThrow('plain JSON')
    }
  })

  it('fnv1a64 matches UTF-8 FNV-1a vectors with exactly 16 lowercase hex digits', () => {
    for (const [input, expected] of [
      ['', 'cbf29ce484222325'], ['a', 'af63dc4c8601ec8c'], ['foobar', '85944171f73967e8'],
      ['hello', 'a430d84680aabd0b'], ['\u00e9', '0ac21707b7181e01'],
    ]) {
      expect(fnv1a64(input)).toBe(expected)
      expect(fnv1a64(input)).toMatch(/^[0-9a-f]{16}$/)
    }
  })
})

describe('snapshot participant rules', () => {
  it('take builds kernel and engines with detached data and preserved engine key order', () => {
    const state = { z: 1, a: { second: 2, first: 1 } }
    const part = kernel()
    const snapshot = take([engine('economy', state).participant], part)
    expect(snapshot).toEqual({ kernel: part, engines: { economy: state } })
    expect(Object.keys(snapshot.engines.economy as object)).toEqual(['z', 'a'])
    state.a.first = 99
    part.rng.mechanism = 99
    expect(snapshot.kernel.rng.mechanism).toBe(123)
    expect(snapshot.engines.economy).toEqual({ z: 1, a: { second: 2, first: 1 } })
  })

  it('restore routes each part by id and a nested state round-trips canonical-equal', () => {
    const a = engine('a', { z: [3, { two: 2, one: 1 }], a: -0 })
    const b = engine('__proto__', { log: ['first', 'second'] })
    const participants = [a.participant, b.participant]
    const snapshot = take(participants, kernel())
    a.participant.restore({ changed: true })
    b.participant.restore(null)
    const restoredKernel = restore([...participants].reverse(), snapshot)
    expect(canonical(take(participants, restoredKernel))).toBe(canonical(snapshot))
    expect(Object.keys(a.state() as object)).toEqual(['z', 'a'])
    ;(b.state() as { log: string[] }).log.push('later')
    restoredKernel.rng.mechanism = 999
    expect(snapshot.engines.__proto__).toEqual({ log: ['first', 'second'] })
    expect(snapshot.kernel.rng.mechanism).toBe(123)
  })

  it('take rejects duplicate ids instead of overwriting an engine part', () => {
    const participant = engine('same', {}).participant
    expect(() => take([participant, participant], kernel())).toThrow('duplicate participant')
  })

  it('restore checks missing own parts before mutating any participant', () => {
    const a = engine('a', 1), missing = engine('toString', 2)
    const snapshot = take([a.participant], kernel())
    a.participant.restore(3)
    expect(() => restore([a.participant, missing.participant], snapshot)).toThrow('missing snapshot participant')
    expect(a.state()).toBe(3)
  })
})
