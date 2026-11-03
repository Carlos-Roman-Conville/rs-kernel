export interface PortDeclaration {
    readonly mechanismId: string;
    readonly outputId: string;
    readonly unit: string;
    readonly direction: 'output' | 'input';
}
/** Declarations are reusable data; there is no process-global port registry. */
export declare function declareOutput(mechanismId: string, outputId: string, unit: string): PortDeclaration;
export declare function declareInput(mechanismId: string, outputId: string, unit: string): PortDeclaration;
/** One table per entity. Inputs wire to outputs with the same registry quantity id. */
export declare class PortTable {
    private outputs;
    private inputs;
    private values;
    private readonly running?;
    /** Input declarations may precede their outputs in this list. */
    constructor(declarations?: readonly PortDeclaration[], options?: {
        running?: () => readonly string[] | null;
    });
    declareOutput(mechanismId: string, outputId: string, unit: string): void;
    /** Dynamic wiring requires the output to have been declared first. */
    declareInput(mechanismId: string, outputId: string, unit: string): void;
    private output;
    /** Values are expressed in the output's declared unit. */
    write(writer: string, outputId: string, value: number): void;
    /** Omit mechanismId for a raw output read; supply it for a wired input read. */
    read(outputId: string, mechanismId?: string): number | undefined;
}
