export interface ProcessOrder {
    readonly phases: readonly string[];
    readonly order: Readonly<Record<string, readonly string[] | 'insertion'>>;
}
export interface OrderPosition {
    readonly phase: number;
    readonly position: number;
}
export declare const defaultOrder: ProcessOrder;
/** Compile a detached order; only explicitly marked phases accept unlisted processes. */
export declare class Order {
    private readonly phases;
    constructor(order?: ProcessOrder);
    /** Resolve at registration, allocating a position only for an insertion phase. */
    register(phase: string, id: string): OrderPosition;
}
