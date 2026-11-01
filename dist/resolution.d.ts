import type { RandomStream, RandomStreams, StreamsState } from './rng.ts';
import type { Process, Scheduler } from './scheduler.ts';
import { type SimTime } from './time.ts';
import { type Participant } from './transaction.ts';
export interface ConservedQuantity {
    readonly quantity: string;
    readonly unit: string;
    /** Absolute tolerance in the declared unit; supplied by the owner. */
    readonly tolerance: number;
}
export interface Resolution<A, I> {
    readonly id: string;
    readonly conserved: readonly ConservedQuantity[];
    coarsen(individuals: I): A;
    refine(aggregate: A, rng: RandomStream): I;
}
export type ResolutionMode = 'fine' | 'coarse';
export type ResolutionState<A, I> = {
    readonly mode: 'coarse';
    aggregate: A;
} | {
    readonly mode: 'fine';
    individuals: I;
};
export interface ResolutionOptions<A, I> {
    readonly resolution: Resolution<A, I>;
    readonly scheduler: Scheduler;
    readonly initial: ResolutionState<A, I>;
    readonly rng: RandomStreams;
    readonly mechanismId: string;
    /** Read an owner-defined quantity from A, expressed in its declared unit. */
    readonly quantity: (aggregate: A, quantity: string) => number;
    /** Include external state, logs and event queues touched by owner callbacks. */
    readonly participants?: readonly Participant[];
}
interface ResolutionSnapshot<A, I> {
    state: ResolutionState<A, I>;
    last: [string, SimTime][];
    rng: StreamsState;
}
/**
 * Owns the active representation (structured-cloneable data) and is a transaction
 * participant. Register each process through this service, in the host's chosen
 * order. Both sets retain scheduler slots; inactive wrappers skip owner callbacks.
 * Owner callbacks should only transform their arguments and enlisted participants.
 */
export declare class ResolutionService<A, I> implements Participant {
    readonly id: string;
    private readonly resolution;
    private readonly scheduler;
    private readonly random;
    private readonly draw;
    private readonly quantity;
    private readonly participants;
    private current;
    private last;
    private readonly modes;
    private switching;
    constructor(options: ResolutionOptions<A, I>);
    /** Processes read/mutate the active data here; a switch replaces its object. */
    get state(): ResolutionState<A, I>;
    get mode(): ResolutionMode;
    private validateMode;
    private boundary;
    register(mode: ResolutionMode, process: Process): this;
    /**
     * Call after runUntil(T): the old set closes T, and the new set first runs after
     * T on its normal period/offset grid. This never advances the clock itself.
     * An enclosing transaction can enlist this service to roll back a later failure.
     */
    switchTo(mode: ResolutionMode, t: SimTime): ResolutionState<A, I>;
    snapshot(): ResolutionSnapshot<A, I>;
    /** Restore at the same scheduler boundary; scheduler time itself is not rewound. */
    restore(snapshot: unknown): void;
}
export declare function switchTo<A, I>(service: ResolutionService<A, I>, mode: ResolutionMode, t: SimTime): ResolutionState<A, I>;
export {};
