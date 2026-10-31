/** Adapters own detached snapshots, including their event and command-log cursors. */
export interface Participant {
  id: string
  snapshot(): unknown
  restore(snapshot: unknown): void
}

/** Synchronous boundary; participant restore methods must not throw. */
export function transaction<T>(participants: readonly Participant[], fn: () => T): T {
  const snapshots = participants.map(participant => participant.snapshot())
  try {
    return fn()
  } catch (error) {
    // Attempt every restore even if an adapter violates the restore contract.
    for (let i = 0; i < participants.length; i++) {
      try { participants[i].restore(snapshots[i]) } catch { /* preserve the original failure */ }
    }
    throw error
  }
}
