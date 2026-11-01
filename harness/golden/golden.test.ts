// Golden outputs (ADOPTION.md): each engine run reduced to one canonical string and compared byte for byte with the
// file recorded before any kernel adoption. GOLDEN_WRITE=1 rewrites the files, and a missing file is written on first run; an adoption unit never does.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonical, fnv1a64 } from '../../src/index.ts'
import { runHumanWeek } from '../../../realism/examples/human-week.ts'
import { runWoundVariant, healingReference, VARIANTS } from '../../../realism/examples/human-wound.ts'
import { runHorseStable } from '../../../realism/examples/horse-stable.ts'
import { Runner } from '../../../settlement/src/reduce.ts'
import { initialState } from '../../../settlement/src/state.ts'
import { defaultConfig } from '../../../settlement/src/config.ts'
import { stubProviders } from '../../../settlement/src/providers.ts'
import { ledger } from '../../../settlement/src/queries.ts'
import { buildHamlet } from '../../../settlement/examples/hamlet.ts'
import { simulate } from '../../../economy/examples/three-ports.ts'

const dir = dirname(fileURLToPath(import.meta.url))

/** Plain JSON only, so class instances and Maps do not reach canonical. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

function firstDifference(a: unknown, b: unknown, path: string): string | null {
  if (Object.is(a, b)) return null
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return path || '(root)'
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of [...keys].sort()) {
    const found = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}${Array.isArray(a) ? `[${key}]` : `.${key}`}`)
    if (found) return found
  }
  return null
}

function golden(name: string, value: unknown) {
  const text = canonical(plain(value))
  const file = join(dir, `${name}.json`)
  if (process.env.GOLDEN_WRITE === '1' || !existsSync(file)) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, text)
    return
  }
  const recorded = readFileSync(file, 'utf8')
  if (recorded === text) return
  const where = firstDifference(JSON.parse(recorded), JSON.parse(text), '')
  expect.fail(`${name} differs from its golden file; first difference at ${where}`)
}

type World = ReturnType<typeof runHumanWeek>['w']

/** Every check (time, quantity, expected, actual, ok) is covered by a per-quantity hash, with the first and last row
 * kept readable: the full list is hundreds of thousands of rows per run. */
function checkRecord(w: World) {
  const by = new Map<string, { t: number; quantity: string; expected: number; actual: number; ok: boolean }[]>()
  for (const c of w.trace.checks) {
    const row = { t: c.t, quantity: c.quantity, expected: c.expected, actual: c.actual, ok: c.ok }
    const rows = by.get(c.quantity)
    if (rows) rows.push(row)
    else by.set(c.quantity, [row])
  }
  return {
    count: w.trace.checks.length,
    failed: w.trace.failed().length,
    byQuantity: Object.fromEntries([...by].map(([quantity, rows]) => [quantity,
      { count: rows.length, failed: rows.filter((r) => !r.ok).length, first: rows[0], last: rows[rows.length - 1], hash: fnv1a64(canonical(plain(rows))) }])),
  }
}

/** Final component states, every conservation check, the transfer count and the transfer-trace hash. */
function worldRecord(w: World) {
  return {
    t: w.t,
    components: [...w.registry.components.values()].map((c) => ({ id: c.id, kind: c.kind, mass: c.mass, temperatureC: c.temperatureC, contents: c.contents, props: c.props })),
    checks: checkRecord(w),
    transferCount: w.trace.transfers.length,
    transferHash: fnv1a64(canonical(plain(w.trace.transfers))),
  }
}

describe('realism', () => {
  it('realism: human week', () => {
    const run = runHumanWeek()
    golden('realism-human-week', { days: run.days, order: run.order, world: worldRecord(run.w) })
  })
  for (const variant of VARIANTS) {
    it(`realism: human wound ${variant}`, () => {
      const run = runWoundVariant(variant)
      golden(`realism-human-wound-${variant}`, { days: run.days, medicine: run.medicine, week: { days: run.week.days, world: worldRecord(run.week.w) } })
    })
  }
  it('realism: human wound healing reference', () => {
    golden('realism-wound-healing-reference', healingReference())
  })
  it('realism: horse stable', () => {
    const run = runHorseStable()
    golden('realism-horse-stable', { days: run.days, restingVentilation: run.restingVentilation, world: worldRecord(run.w) })
  })
})

describe('settlement', () => {
  it('settlement: A1', () => {
    const providers = stubProviders({
      'salt-meat': { inputs: [{ good: 'meat', units: 1 }, { good: 'salt', units: 1 }], output: 'salt-meat', yield: 1, unitsPerFixtureDay: 10, labourHoursPerUnit: 2.5 },
      'smoked-meat': { inputs: [{ good: 'meat', units: 1 }], output: 'smoked-meat', yield: 1, unitsPerFixtureDay: 6, labourHoursPerUnit: 2.5 },
    })
    providers.labour.pools['pool.housing'] = 5
    providers.prices.values['bldg.0001'] = 60
    const r = new Runner(initialState('stl.port', 'the port'), defaultConfig(), providers)
    const dist = r.run<string>({ type: 'addDistrict', name: 'housing', kind: 'housing', bounds: { x: 0, y: 0, w: 40, h: 40 } })
    const parcel = r.run<string>({ type: 'addParcel', district: dist, footprint: { x: 0, y: 0, w: 10, h: 10 }, access: ['road'] })
    r.run({ type: 'grantTitle', subject: parcel, holder: 'esfp-f' })
    providers.materials.set('esfp-f', 'timber', 20)
    const build = r.run<string>({ type: 'startProject', kind: 'construct', target: parcel, account: 'esfp-f', labourHours: 0, materials: [{ material: 'timber', units: 10 }],
      plan: { footprint: { x: 1, y: 1, w: 8, h: 6 }, addFixtures: ['salting-house'],
        rooms: [{ id: 'shop', name: 'the shop', tiles: { x: 1, y: 1, w: 8, h: 4 }, use: 'work' }],
        placements: [{ fixture: 'salting-house', room: 'shop', at: { x: 2, y: 2 } }] } })
    r.tick()
    const bldg = r.state.projects[build].result!
    const title = r.run<string>({ type: 'grantTitle', subject: bldg, holder: 'esfp-f' })
    r.run({ type: 'assign', person: 'esfp-f', kind: 'residence', target: bldg })
    r.run({ type: 'assign', person: 'farm-son', kind: 'residence', target: bldg })
    for (const holder of ['player', 'esfp-f', 'farm-son']) r.run({ type: 'credit', holder, amount: 100 })
    // 1
    r.run({ type: 'sell', title, buyer: 'player', price: providers.prices.valueOf(bldg, r.state.settlement.day) })
    r.tick()
    // 2
    r.run({ type: 'transfer', title, to: 'farm-son', kind: 'gift' })
    r.tick()
    // 3
    r.run({ type: 'lease', title, tenant: 'esfp-f', scope: ['shop'], rent: 2 })
    const biz = r.run<string>({ type: 'openBusiness', kind: 'butcher', premises: [{ bldg, rooms: ['shop'] }], operator: 'esfp-f', manager: 'farm-son', inventory: 'inv.butcher',
      lines: [{ recipe: 'salt-meat', equipment: ['salting-house'] }, { recipe: 'smoked-meat', equipment: ['smokehouse'] }] })
    r.run({ type: 'assign', person: 'farm-son', kind: 'management', target: biz })
    r.run({ type: 'credit', holder: biz, amount: 100 })
    r.tick()
    // 4
    const p1 = r.run<string>({ type: 'addPost', biz, role: 'butcher', wage: 2 })
    const p2 = r.run<string>({ type: 'addPost', biz, role: 'labourer', wage: 1 })
    r.run({ type: 'hire', post: p1, holder: 'esfp-f' })
    r.run({ type: 'hire', post: p2, holder: 'pool.housing' })
    r.tick()
    // 5
    providers.labour.pools['pool.builders'] = 1
    providers.materials.set('esfp-f', 'timber', 10)
    r.run<string>({ type: 'startProject', kind: 'renovate', target: bldg, account: 'esfp-f', pool: 'pool.builders', wage: 1, labourHours: 20,
      materials: [{ material: 'timber', units: 5 }],
      plan: { rooms: [{ id: 'back', name: 'back room', tiles: { x: 1, y: 5, w: 8, h: 2 }, use: 'smoke' }], addFixtures: ['smokehouse'],
        placements: [{ fixture: 'smokehouse', room: 'back', at: { x: 2, y: 5 } }] } })
    r.tick(2)
    // 6
    providers.materials.set('inv.butcher', 'meat', 100)
    providers.materials.set('inv.butcher', 'salt', 100)
    r.tick()
    golden('settlement-A1', { state: r.state, events: r.events, ledger: ledger(r.state) })
  })

  it('settlement: hamlet 30 days', () => {
    const { r } = buildHamlet()
    r.tick(30)
    golden('settlement-hamlet-30', { state: r.state, events: r.events })
  })
})

describe('economy', () => {
  it('economy: three ports', () => {
    const run = simulate(30)
    golden('economy-three-ports', { state: run.state, log: run.log, rows: run.rows, balances: run.balances })
  })
})
