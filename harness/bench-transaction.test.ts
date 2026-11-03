// Measurements of fixture states, not world claims or a decision about scoped snapshots.
// Fresh fixtures: buildHamlet's prepared state, threePorts(0), runHorseStable(0).
// Realism has no restorable transaction adapter: measure its plain snapshot through
// runnerAdapter, not restoration of a live World (closures/Kahan carry are excluded).
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import { canonical, transaction, type Participant } from '../src/index.ts'
import { snapshotWorld } from '../../realism/src/snapshot.ts'
import { runnerAdapter } from './adapters.ts'
import { buildHamlet, runHorseStable } from './examples.ts'
import { threePorts } from './thirty-days.ts'

const warmups = 20
const repetitions = 200

function measure(participant: Participant, rollback: boolean) {
  const samples: number[] = []
  const failure = new Error('benchmark rollback')
  const body = rollback ? () => { throw failure } : () => {}
  for (let i = -warmups; i < repetitions; i++) {
    const start = performance.now()
    try {
      transaction([participant], body)
    } catch (error) {
      if (error !== failure) throw error
    }
    const elapsed = performance.now() - start
    if (i >= 0) samples.push(elapsed)
  }
  samples.sort((a, b) => a - b)
  return {
    median: (samples[repetitions / 2 - 1] + samples[repetitions / 2]) / 2,
    p95: samples[Math.ceil(repetitions * 0.95) - 1], // nearest rank
  }
}

it('measures fixture transaction costs and writes JSON', () => {
  const settlement = buildHamlet().r
  const economy = threePorts(0).economy
  const horse = runHorseStable(0)
  const realism = { state: snapshotWorld(horse.w, horse.sch), log: [], events: [] }
  const fixtures = [
    { state: 'settlement-hamlet', bytes: canonical(settlement.state).length,
      participant: runnerAdapter('settlement', settlement).participant },
    { state: 'economy-three-ports', bytes: canonical(economy.state).length,
      participant: runnerAdapter('economy', economy).participant },
    { state: 'realism-horse-stable', bytes: canonical(realism.state).length,
      participant: runnerAdapter('realism', realism).participant },
  ]
  // Empty bodies isolate transaction overhead: commit snapshots; rollback also restores.
  // Construction, canonical sizing, formatting and file I/O are outside the timers.
  const results = fixtures.map(({ state, bytes, participant }) => {
    const commit = measure(participant, false)
    const rollback = measure(participant, true)
    console.log(`${state}: bytes=${bytes} commit median=${commit.median.toFixed(6)}ms p95=${commit.p95.toFixed(6)}ms rollback median=${rollback.median.toFixed(6)}ms p95=${rollback.p95.toFixed(6)}ms step=1000ms`)
    return { state, bytes, commitMsMedian: commit.median, commitMsP95: commit.p95,
      rollbackMsMedian: rollback.median, rollbackMsP95: rollback.p95 }
  })
  const output = new URL('../out/bench-transaction.json', import.meta.url)
  mkdirSync(new URL('../out/', import.meta.url), { recursive: true })
  writeFileSync(output, JSON.stringify({ node: process.version, date: new Date().toISOString(), results, stepMs: 1000 }, null, 2) + '\n')
  expect(statSync(output).size).toBeGreaterThan(0)
})
