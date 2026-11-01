import { describe, expect, it, vi } from 'vitest'
import { simTime, type KernelEvent, type Participant } from '../src/index.ts'
import { resolveWork, type Command, type Post, type WorkOptions } from './work-resolution.ts'

function intention(id: string, action = 'work', target: string | undefined = 'post.a', mind = 'person.a'): KernelEvent {
  return { id, t: simTime(0), source: 'cognition', type: 'cognition.intention',
    payload: { id: `intention.${id}`, mind, action, target } }
}

function fixture(events: KernelEvent[], posts: Post[] = [{ id: 'post.a', role: 'farmer', holder: null }]) {
  let state = { posts: structuredClone(posts), commands: [] as Command[] }
  const participant: Participant = {
    id: 'settlement', snapshot: () => structuredClone(state),
    restore: snapshot => { state = structuredClone(snapshot) as typeof state },
  }
  const options: WorkOptions = {
    events, day: 7, labour: { hours: vi.fn(() => 8) }, posts: () => state.posts,
    apply: command => {
      state.commands.push(command)
      state.posts.find(post => post.id === command.post)!.holder = command.holder
    }, participants: [participant], emit: vi.fn(),
  }
  return { options, participant, state: () => state }
}

describe('host work resolution', () => {
  it('latest work/refuse_work wins, without unrelated intentions closing work', () => {
    const closed = fixture([intention('e1'), intention('e2', 'refuse_work')])
    expect(resolveWork(closed.options)).toEqual({ hires: [], failed: [], resolved: [] })
    const open = fixture([intention('e1', 'refuse_work'), intention('e2'), intention('e3', 'eat')])
    expect(resolveWork(open.options).hires).toEqual([
      { type: 'hire', post: 'post.a', holder: 'person.a', cause: 'e2' },
    ])
    expect(open.options.labour.hours).toHaveBeenCalledWith('person.a', 'farmer', 7)
  })

  it('H1 hires once across calls with the KernelEvent cause, not the payload id', () => {
    const f = fixture([intention('e1')])
    const first = resolveWork(f.options)
    expect(first.resolved).toEqual(['e1'])
    expect(first.hires[0].cause).toBe('e1')
    expect(resolveWork({ ...f.options, resolved: first.resolved })).toEqual({ hires: [], failed: [], resolved: ['e1'] })
    expect(f.state().commands).toHaveLength(1)
  })

  it.each([
    ['no target', undefined, null, 8],
    ['no hours', 'post.a', null, 0],
    ['no vacant post', 'post.a', 'occupied', 8],
    ['no vacant post', 'missing', null, 8],
  ] as const)('fails once for %s (target %s, holder %s, hours %s)', (reason, target, holder, hours) => {
    const event = { ...intention('e1'), payload: { mind: 'person.a', action: 'work', target } }
    const f = fixture([event], [{ id: 'post.a', role: 'farmer', holder }])
    f.options.labour = { hours: () => hours }
    const first = resolveWork(f.options)
    const outcome = { type: 'shared.action.outcome', cause: 'e1', status: 'failed', stimuli: [{ reason }] }
    expect(first).toEqual({ hires: [], failed: [outcome], resolved: ['e1'] })
    expect(f.options.emit).toHaveBeenCalledExactlyOnceWith(outcome)
    expect(resolveWork({ ...f.options, resolved: first.resolved }).failed).toEqual([])
    expect(f.options.emit).toHaveBeenCalledTimes(1)
    expect(f.state().commands).toEqual([])
  })

  it('chooses role vacancies by stable id in surviving event order, including hires in this call', () => {
    const posts: Post[] = [
      { id: 'post.c', role: 'farmer', holder: null },
      { id: 'post.a', role: 'farmer', holder: 'occupied' },
      { id: 'post.b', role: 'farmer', holder: null },
    ]
    const f = fixture([
      intention('e1', 'work', 'farmer', 'person.a'),
      intention('e2', 'work', 'farmer', 'person.b'),
      intention('e3', 'work', 'farmer', 'person.a'),
      intention('e4', 'work', 'farmer', 'person.c'),
    ], posts)
    f.options.posts = () => posts // Detached fixed view; local successful hires still count.
    const result = resolveWork(f.options)
    expect(result.hires).toEqual([
      { type: 'hire', post: 'post.b', holder: 'person.b', cause: 'e2' },
      { type: 'hire', post: 'post.c', holder: 'person.a', cause: 'e3' },
    ])
    expect(result.failed[0].stimuli).toEqual([{ reason: 'no vacant post' }])
    expect(posts[2].holder).toBeNull()
  })

  it('a post-id target takes precedence over a matching role and never falls back when filled', () => {
    const f = fixture([intention('e1', 'work', 'post.a')], [
      { id: 'post.b', role: 'post.a', holder: null },
      { id: 'post.a', role: 'farmer', holder: 'occupied' },
    ])
    expect(resolveWork(f.options).failed[0].stimuli).toEqual([{ reason: 'no vacant post' }])
  })

  it('H2 rolls back every participant when the second apply throws, without emitting failures', () => {
    const f = fixture([
      intention('e0', 'work', 'missing', 'person.c'),
      intention('e1'), intention('e2', 'work', 'post.b', 'person.b'),
    ], [{ id: 'post.a', role: 'farmer', holder: null }, { id: 'post.b', role: 'farmer', holder: null }])
    let log: string[] = []
    f.options.participants = [...f.options.participants, {
      id: 'log', snapshot: () => [...log], restore: snapshot => { log = snapshot as string[] },
    }]
    const before = f.participant.snapshot()
    const apply = f.options.apply
    const error = new Error('second hire rejected')
    f.options.apply = command => {
      apply(command)
      log.push(command.cause)
      if (log.length === 2) throw error
    }
    const resolved = ['previous']
    expect(() => resolveWork({ ...f.options, resolved })).toThrow(error)
    expect(f.state()).toEqual(before)
    expect(log).toEqual([])
    expect(resolved).toEqual(['previous'])
    expect(f.options.emit).not.toHaveBeenCalled()
  })

  it('H3 never reads reservationWage or writes any wage field in commands or results', () => {
    const f = fixture([intention('e1'), intention('e2', 'work', 'missing', 'person.b')])
    Object.defineProperty(f.options.labour, 'reservationWage', { get() { throw new Error('must not read') } })
    const result = resolveWork(f.options)
    const check = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value)) {
        expect(key.toLowerCase()).not.toContain('wage')
        check(child)
      }
    }
    check(result)
    check(f.state().commands)
    expect(result.hires).toHaveLength(1)
  })
})
