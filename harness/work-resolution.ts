import { transaction, type KernelEvent, type Participant } from '../src/index.ts'

export interface LabourSupply {
  hours(source: string, role: string, day: number): number
}

export interface Post { id: string; role: string; holder: string | null }
export interface Command { type: 'hire'; post: string; holder: string; cause: string }
export interface Outcome {
  type: 'shared.action.outcome'
  cause: string
  status: 'failed'
  stimuli: { reason: 'no target' | 'no hours' | 'no vacant post' }[]
}

export interface WorkOptions {
  /** Events in bus order; map recordsSince() entries to their event first. */
  events: readonly KernelEvent[]
  labour: LabourSupply
  day: number
  posts(): readonly Post[]
  apply(command: Command): unknown
  participants: readonly Participant[]
  resolved?: readonly string[]
  /** Called after the hire transaction succeeds; the host owns publication. */
  emit?(outcome: Outcome): void
}

/** History DESIGN §3.8: provisional host vacancy rule, never an engine staffing rule. */
export function resolveWork(options: WorkOptions): { hires: Command[]; failed: Outcome[]; resolved: string[] } {
  const latest = new Map<string, number>()
  const intentions = options.events.map(event => {
    if (event.type !== 'cognition.intention' || !event.payload || typeof event.payload !== 'object') return undefined
    const payload = event.payload as { mind?: unknown; action?: unknown; target?: unknown }
    if (typeof payload.mind !== 'string' || (payload.action !== 'work' && payload.action !== 'refuse_work')) return undefined
    return { mind: payload.mind, action: payload.action, target: payload.target }
  })
  intentions.forEach((intention, index) => { if (intention) latest.set(intention.mind, index) })
  const resolved = new Set(options.resolved)
  const hires: Command[] = []
  const failed: Outcome[] = []
  transaction(options.participants, () => {
    // Track successful hires even when the host's posts reader returns a fixed view.
    const filled = new Set<string>()
    intentions.forEach((intention, index) => {
      const cause = options.events[index].id
      if (!intention || intention.action !== 'work' || latest.get(intention.mind) !== index || resolved.has(cause)) return
      let reason: Outcome['stimuli'][number]['reason'] | undefined
      let post: Post | undefined
      if (typeof intention.target !== 'string' || intention.target.length === 0) {
        reason = 'no target'
      } else {
        const posts = options.posts()
        const direct = posts.find(post => post.id === intention.target)
        const vacant = (post: Post) => post.holder === null && !filled.has(post.id)
        post = direct ? (vacant(direct) ? direct : undefined) : posts
          .filter(post => post.role === intention.target && vacant(post))
          .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0]
        if (!post) reason = 'no vacant post'
        else if (!(options.labour.hours(intention.mind, post.role, options.day) > 0)) reason = 'no hours'
      }
      if (reason) {
        failed.push({ type: 'shared.action.outcome', cause, status: 'failed', stimuli: [{ reason }] })
      } else if (post) {
        const command: Command = { type: 'hire', post: post.id, holder: intention.mind, cause }
        options.apply(command)
        hires.push(command)
        filled.add(post.id)
      }
      resolved.add(cause)
    })
  })
  for (const outcome of failed) options.emit?.(outcome)
  return { hires, failed, resolved: [...resolved] }
}
