import type { OrderPosition } from './order.ts';
import type { ScheduledEmission } from './scheduler.ts';
import { type SimTime } from './time.ts';
export interface KernelEvent {
    readonly id: string;
    readonly t: SimTime;
    readonly source: string;
    readonly type: string;
    readonly payload: unknown;
    readonly cause?: string;
}
export interface PayloadField {
    kind: 'number' | 'integer' | 'string' | 'boolean' | 'id' | 'list' | 'record';
    of?: PayloadField['kind'];
    nullable?: boolean;
    quantity?: string;
    unit?: string;
    required: boolean;
}
export interface EventContract {
    type: string;
    producer: string;
    consumers: string[];
    cause: 'required' | 'optional';
    payload: Record<string, PayloadField>;
    notes?: string;
}
/** Reader's position in the scheduler; later emissions at this instant are hidden. */
export interface EventReader extends OrderPosition {
    readonly t: SimTime;
}
/** Number of events already consumed, starting at zero. Advance by the returned length. */
export type EventCursor = number;
export interface EventRecord extends OrderPosition {
    readonly event: KernelEvent;
    readonly sequence: number;
}
export interface EventBusState {
    readonly counter: number;
    readonly records: readonly EventRecord[];
}
/**
 * Append-only, pull-based delivery. Wire Scheduler's emit option to bus.emit.
 * Publications must follow scheduler order: backdated writes are rejected so cursors
 * cannot skip events. Equal positions retain emission order. No subscribers are called.
 */
export declare class EventBus {
    private counter;
    private records;
    private readonly options;
    constructor(options?: {
        contracts?: ReadonlyMap<string, EventContract>;
        onViolation?: (message: string, event: KernelEvent) => void;
    });
    private checkContract;
    readonly emit: (input: ScheduledEmission) => KernelEvent;
    /** Omit reader only for host/audit reads; processes supply their current t and rank. */
    since(cursor?: EventCursor, reader?: EventReader): KernelEvent[];
    /** Read detached records with scheduler metadata; reader visibility follows since(). */
    recordsSince(cursor?: EventCursor, reader?: EventReader): EventRecord[];
    state(): EventBusState;
    /** Restore the entire queue and counter atomically; consumer cursors belong to the host. */
    restore(state: EventBusState): void;
}
