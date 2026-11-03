// Test doubles only: fixture ledgers, journal and bus; arbitrary holdings, no world semantics.
import { describe, expect, it, vi } from 'vitest'
import {
  canonical, EventBus, eventsParticipant, transfer, transaction, TransferJournal,
  type TransferLedger, type TransferRequest, type Participant,
} from '../../src/index.ts'

class Ledger implements TransferLedger, Participant {
  readonly id: string
  amount: number
  readonly failApply?: Error

  constructor(id: string, amount = 10, failApply?: Error) {
    this.id = id
    this.amount = amount
    this.failApply = failApply
  }

  unit(): string { return 'kg' }
  apply(_account: string, _quantity: string, delta: number): void {
    if (this.failApply) throw this.failApply
    this.amount += delta
  }

  snapshot(): number { return this.amount }
  restore(snapshot: unknown): void { this.amount = snapshot as number }
}

function foodMove(from: Ledger, to: Ledger, amount = 2): TransferRequest {
  return {
    t: 0, process: 'fixture.food', quantity: 'fixture.food', unit: 'kg', amount,
    from: { ledger: from, account: 'stock' }, to: { ledger: to, account: 'stock' }, cause: 'intention.food',
  }
}

function participants(journal: TransferJournal, bus: EventBus, ...ledgers: Participant[]): Participant[] {
  return [journal, ...ledgers, eventsParticipant(bus)]
}

function snapshotAll(journal: TransferJournal, bus: EventBus, ...ledgers: Participant[]): string {
  return canonical([journal.snapshot(), bus.state(), ...ledgers.map(p => p.snapshot())])
}

describe('L2 rollback (PLAN §7a)', () => {
  it('injected failures leave journal, ledgers and bus canonical-equal with no new bus events', () => {
    const cases: { name: string; run: (f: ReturnType<typeof setup>) => void }[] = [
      {
        name: 'before the first leg',
        run: ({ parts }) => {
          expect(() => transaction(parts, () => { throw new Error('before first leg') })).toThrow('before first leg')
        },
      },
      {
        name: 'between legs',
        run: ({ journal, a, b, parts }) => {
          vi.spyOn(b, 'apply').mockImplementation(() => { throw new Error('between legs') })
          expect(() => transaction(parts, () => transfer(journal, foodMove(a, b)))).toThrow('between legs')
        },
      },
      {
        name: 'after the journal append',
        run: ({ journal, a, b, parts }) => {
          const append = journal.append.bind(journal)
          vi.spyOn(journal, 'append').mockImplementation(entry => {
            append(entry)
            throw new Error('after journal append')
          })
          expect(() => transaction(parts, () => transfer(journal, foodMove(a, b)))).toThrow('after journal append')
        },
      },
      {
        name: 'after transfer in a later fn step',
        run: ({ journal, a, b, parts }) => {
          expect(() => transaction(parts, () => {
            transfer(journal, foodMove(a, b))
            throw new Error('later fn step')
          })).toThrow('later fn step')
        },
      },
      {
        name: 'in the second request of a batch',
        run: ({ journal, a, b, parts }) => {
          const move = foodMove(a, b)
          let credits = 0
          vi.spyOn(b, 'apply').mockImplementation((_account, _quantity, delta) => {
            credits++
            if (credits === 2) throw new Error('second request fault')
            b.amount += delta
          })
          expect(() => transaction(parts, () => transfer(journal, move, { ...move, amount: 1 }))).toThrow('second request fault')
        },
      },
    ]

    function setup() {
      const bus = new EventBus(), journal = new TransferJournal()
      const a = new Ledger('food.source', 10), b = new Ledger('food.gut', 0)
      const parts = participants(journal, bus, a, b)
      return { bus, journal, a, b, parts }
    }

    for (const { name, run } of cases) {
      const f = setup()
      const before = snapshotAll(f.journal, f.bus, f.a, f.b)
      const eventsBefore = canonical(f.bus.since(0))
      run(f)
      expect(snapshotAll(f.journal, f.bus, f.a, f.b), name).toBe(before)
      expect(canonical(f.bus.since(0)), name).toBe(eventsBefore)
    }
  })

  it('committed effort survives a later failing food transfer without a kernel expenditure entry', () => {
    const bus = new EventBus(), journal = new TransferJournal()
    const effort = new Ledger('effort', 10), spent = new Ledger('effort.spent', 0)
    const foodSource = new Ledger('food.source', 10), foodGut = new Ledger('food.gut', 0)

    transaction(participants(journal, bus, effort, spent), () => {
      transfer(journal, {
        t: 0, process: 'fixture.effort', quantity: 'fixture.effort', unit: 'kg', amount: 3,
        from: { ledger: effort, account: 'stock' }, to: { ledger: spent, account: 'stock' }, cause: 'intention.effort',
      })
    })

    const foodBefore = canonical([foodSource.snapshot(), foodGut.snapshot()])
    const effortAfterT1 = effort.amount
    expect(journal.length).toBe(1)

    expect(() => transaction(participants(journal, bus, foodSource, foodGut), () => {
      transfer(journal, foodMove(foodSource, foodGut))
      throw new Error('food refused')
    })).toThrow('food refused')

    expect(journal.length).toBe(1)
    expect(journal.entries()[0].process).toBe('fixture.effort')
    expect(canonical([foodSource.snapshot(), foodGut.snapshot()])).toBe(foodBefore)
    expect(effort.amount).toBe(effortAfterT1)
    expect(journal.entries().some(e => e.process === 'kernel.expenditure')).toBe(false)
  })

  it('nested inner rollback is caught by outer transaction which then commits', () => {
    const bus = new EventBus(), journal = new TransferJournal()
    const inner = new Ledger('inner', 5), outer = new Ledger('outer', 0)
    const parts = participants(journal, bus, inner, outer)

    transaction(parts, () => {
      try {
        transaction([inner, outer], () => {
          inner.apply('stock', 'fixture.mass', -1)
          throw new Error('inner fault')
        })
      } catch (error) {
        expect((error as Error).message).toBe('inner fault')
        expect(inner.amount).toBe(5)
        expect(outer.amount).toBe(0)
      }
      transfer(journal, {
        t: 0, process: 'outer.commit', quantity: 'fixture.mass', unit: 'kg', amount: 2,
        from: { ledger: inner, account: 'stock' }, to: { ledger: outer, account: 'stock' },
      })
    })

    expect(inner.amount).toBe(3)
    expect(outer.amount).toBe(2)
    expect(journal.length).toBe(1)
  })

  it('propagates the original error when a participant restore throws', () => {
    const bad: Participant = {
      id: 'bad',
      snapshot: () => 0,
      restore: () => { throw new Error('restore violated') },
    }
    const original = new Error('original failure')
    expect(() => transaction([bad], () => { throw original })).toThrow(original)
  })
})
