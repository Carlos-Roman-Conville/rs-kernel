export declare function must<T>(table: Record<string, T>, id: string, what: string): T;
export declare function nonempty(value: unknown, what: string): string;
export declare function finite(value: unknown, what: string, min?: number): number;
export declare function integer(value: unknown, what: string, min: number): number;
