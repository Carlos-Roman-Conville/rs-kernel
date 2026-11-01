/** Adapters own detached snapshots, including their event and command-log cursors. */
export interface Participant {
    id: string;
    snapshot(): unknown;
    restore(snapshot: unknown): void;
}
/** Synchronous boundary; participant restore methods must not throw. */
export declare function transaction<T>(participants: readonly Participant[], fn: () => T): T;
