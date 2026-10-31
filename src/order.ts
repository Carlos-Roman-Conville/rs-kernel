import data from '../data/order.json' with { type: 'json' }
import { nonempty } from './guards.ts'

export interface ProcessOrder {
  readonly phases: readonly string[]
  readonly order: Readonly<Record<string, readonly string[] | 'insertion'>>
}

export interface OrderPosition {
  readonly phase: number
  readonly position: number
}

export const defaultOrder: ProcessOrder = Object.freeze({
  phases: Object.freeze(data.phases),
  order: Object.freeze(Object.fromEntries(
    Object.entries(data.order).map(([phase, ids]) => [phase, Object.freeze(ids)]),
  )),
})

/** Compile a detached order; only explicitly marked phases accept unlisted processes. */
export class Order {
  private readonly phases = new Map<string, { index: number; ids: Map<string, number> | 'insertion'; count: number }>()

  constructor(order: ProcessOrder = defaultOrder) {
    const seen = new Set<string>()
    for (const [index, phase] of order.phases.entries()) {
      nonempty(phase, 'phase')
      if (this.phases.has(phase)) throw new Error(`duplicate phase: ${phase}`)
      const declared = Object.hasOwn(order.order, phase) ? order.order[phase] : []
      const ids = new Map<string, number>()
      if (declared !== 'insertion') {
        if (!Array.isArray(declared)) throw new Error(`invalid order for phase: ${phase}`)
        for (const [position, id] of declared.entries()) {
          nonempty(id, 'process id')
          if (seen.has(id)) throw new Error(`duplicate process in order: ${id}`)
          seen.add(id)
          ids.set(id, position)
        }
      }
      this.phases.set(phase, { index, ids: declared === 'insertion' ? 'insertion' : ids, count: 0 })
    }
    for (const phase of Object.keys(order.order)) {
      if (!this.phases.has(phase)) throw new Error(`order names unknown phase: ${phase}`)
    }
  }

  /** Resolve at registration, allocating a position only for an insertion phase. */
  register(phase: string, id: string): OrderPosition {
    const entry = this.phases.get(phase)
    if (!entry) throw new Error(`unknown phase: ${phase}`)
    const position = entry.ids === 'insertion' ? entry.count++ : entry.ids.get(id)
    if (position === undefined) throw new Error(`process ${id} is absent from order for phase: ${phase}`)
    return { phase: entry.index, position }
  }
}
