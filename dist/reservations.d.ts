import { type SimTime } from './time.ts';
import type { Participant } from './transaction.ts';
export type Bound = {
    kind: 'unbounded';
    evidence: 'fixture';
} | {
    kind: 'series';
    steps: {
        from: SimTime;
        value: number;
    }[];
};
export interface Reservation {
    id: string;
    actor: string;
    cause: string;
    start: SimTime;
    end: SimTime;
    share: number;
    status: 'reserved' | 'fulfilled' | 'released';
    fulfilledMs: number;
    releasedAt?: SimTime;
}
export type ReservationRequest = Pick<Reservation, 'id' | 'actor' | 'cause' | 'start' | 'end' | 'share'>;
/** State after each successful operation, suitable for a cause-linked trace. */
export interface ReservationRecord extends Reservation {
    operation: 'reserve' | 'release' | 'fulfil';
    t: SimTime;
}
export interface ReservationLedgerOptions {
    id?: string;
    bound: (actor: string) => Bound | undefined;
}
export interface ReservationSnapshot {
    reservations: Reservation[];
    records: ReservationRecord[];
}
/** Integer-ms accounting only; actors' owners supply all capacity bounds. */
export declare class ReservationLedger implements Participant {
    readonly id: string;
    private readonly bound;
    private reservations;
    private log;
    constructor(options: ReservationLedgerOptions);
    reserve(now: SimTime, request: ReservationRequest): Reservation;
    release(now: SimTime, id: string): Reservation;
    fulfil(now: SimTime, id: string): Reservation;
    active(actor: string, t: SimTime): Reservation[];
    records(): ReservationRecord[];
    snapshot(): ReservationSnapshot;
    restore(snapshot: unknown): void;
    private pending;
    private append;
}
