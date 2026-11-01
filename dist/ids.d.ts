export type Counters = Record<string, number>;
export declare function mint(counters: Counters, prefix: string): {
    id: string;
    counters: Counters;
};
/** Qualify an opaque local id at the Kernel boundary. */
export declare function qualify(engine: string, id: string): string;
/** Invert qualification without interpreting the local id. */
export declare function unqualify(qualified: string): {
    engine: string;
    id: string;
};
