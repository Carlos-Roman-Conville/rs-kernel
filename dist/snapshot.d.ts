import type { StreamsState } from './rng.ts';
import type { SimTime } from './time.ts';
import type { Participant } from './transaction.ts';
export interface Snapshot {
    kernel: {
        version: number;
        versions?: Record<string, string>;
        t: SimTime;
        epoch: number | null;
        epochLabel?: string;
        catalogue_hash: string | null;
        seed: number;
        eventCounter: number;
        rng: StreamsState;
    };
    engines: Record<string, unknown>;
}
/** Validate host-supplied epoch and catalogue metadata without interpreting it. */
export declare function checkKernelBlock(block: unknown): void;
/** Plain JSON comparison only: undefined properties/elements are dropped, not reordered. */
export declare function canonical(value: unknown): string;
/** Compare host-recorded code versions before comparing run outputs. */
export declare function comparable(a: Snapshot, b: Snapshot): {
    ok: boolean;
    differences: string[];
};
/** FNV-1a over UTF-8 bytes, as a zero-padded lowercase 64-bit hex label. */
export declare function fnv1a64(value: string): string;
/** Capture detached parts without canonicalizing: engine insertion order must survive. */
export declare function take(participants: readonly Participant[], kernelPart: Snapshot['kernel']): Snapshot;
/** Restore requested adapters; return detached kernel state for the host to apply. */
export declare function restore(participants: readonly Participant[], snapshot: Snapshot): Snapshot['kernel'];
