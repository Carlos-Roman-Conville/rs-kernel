import { type ProcessOrder } from './order.ts';
import { type RandomStream, type RandomStreams } from './rng.ts';
import { type SimTime } from './time.ts';
export interface ProcessContext {
    readonly t: SimTime;
    readonly dt: SimTime;
    rng(mechanismId: string): RandomStream;
    emit(type: string, payload: unknown, cause?: string): void;
}
export interface Process {
    readonly id: string;
    readonly mechanisms: readonly string[];
    readonly period: SimTime;
    readonly offset?: SimTime;
    readonly phase: string;
    readonly readonly?: boolean;
    run(ctx: ProcessContext): void;
}
/** The event service/host supplies the sink and owns event ids and delivery. */
export interface ScheduledEmission {
    readonly t: SimTime;
    readonly source: string;
    readonly phase: number;
    readonly position: number;
    readonly type: string;
    readonly payload: unknown;
    readonly cause?: string;
}
export interface SchedulerOptions {
    readonly order?: ProcessOrder;
    readonly start?: SimTime;
    /** Supply streams(runSeed); omitted streams use seed 0. */
    readonly rng?: RandomStreams;
    /** Synchronous publication hook, not subscriber delivery. Missing sinks reject emit. */
    readonly emit?: (event: ScheduledEmission) => void;
}
export declare class Scheduler {
    private time;
    private readonly order;
    private readonly random;
    private readonly sink;
    private readonly ids;
    private readonly buckets;
    private running;
    private active;
    private failed;
    constructor(options?: SchedulerOptions);
    get t(): SimTime;
    current(): {
        id: string;
        mechanisms: readonly string[];
    } | null;
    /**
     * First run is strictly after registration and at/after offset (default epoch 0).
     * It closes the interval since registration; later dt values equal the period.
     * Registration between runUntil calls is supported, never during callbacks.
     */
    register(process: Process): this;
    /** Inclusive endpoint, even when no process is due there. No wall-clock reads. */
    runUntil(target: SimTime): void;
}
