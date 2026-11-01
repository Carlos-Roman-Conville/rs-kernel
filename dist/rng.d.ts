/** The legacy realism mulberry32 generator, preserved exactly for adoption. */
export declare function rng(seed: number): () => number;
/** FNV-1a over UTF-8 bytes, returning an unsigned 32-bit integer. */
export declare function fnv1a32(id: string): number;
/** XOR the two words, then apply the MurmurHash3 32-bit finaliser. */
export declare function mix32(seed: number, hash: number): number;
export type RandomStream = () => number;
export type StreamsState = Record<string, number>;
export interface RandomStreams {
    get(mechanismId: string, entityId?: string): RandomStream;
    state(): StreamsState;
    restore(state: StreamsState): void;
}
/** Independent mechanism and entity streams. Restore uses the same run seed as the snapshot. */
export declare function streams(runSeed: number): RandomStreams;
