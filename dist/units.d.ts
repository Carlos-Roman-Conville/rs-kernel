/** Exponents in the order m, kg, s, K, mol, A, cd, money, count. */
export type Dimension = readonly [number, number, number, number, number, number, number, number, number];
export interface Unit {
    readonly dim: Dimension;
    readonly scale: number;
    /** SI value = value * scale + offset; only temperature points are affine. */
    readonly offset?: number;
}
export interface UnitRow extends Unit {
    readonly source: string;
}
export type UnitTable = Readonly<Record<string, UnitRow>>;
export declare const defaultUnits: UnitTable;
/** Products and quotients associate left to right; parentheses group denominators. */
export declare function parse(expression: string, table?: UnitTable): Unit;
export declare function dim(unit: string | Unit, table?: UnitTable): Dimension;
export declare function sameDimension(a: string | Unit, b: string | Unit, table?: UnitTable): boolean;
export declare function convert(value: number, from: string, to: string, table?: UnitTable): number;
