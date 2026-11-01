import { nonempty } from "./guards.js";
import { convert, parse, sameDimension } from "./units.js";
function declaration(mechanismId, outputId, unit, direction) {
    nonempty(mechanismId, 'mechanism id');
    nonempty(outputId, 'output id');
    parse(unit);
    return Object.freeze({ mechanismId, outputId, unit, direction });
}
/** Declarations are reusable data; there is no process-global port registry. */
export function declareOutput(mechanismId, outputId, unit) {
    return declaration(mechanismId, outputId, unit, 'output');
}
export function declareInput(mechanismId, outputId, unit) {
    return declaration(mechanismId, outputId, unit, 'input');
}
/** One table per entity. Inputs wire to outputs with the same registry quantity id. */
export class PortTable {
    outputs = new Map();
    inputs = new Map();
    values = new Map();
    /** Input declarations may precede their outputs in this list. */
    constructor(declarations = []) {
        for (const port of declarations) {
            if (port.direction === 'output')
                this.declareOutput(port.mechanismId, port.outputId, port.unit);
        }
        for (const port of declarations) {
            if (port.direction === 'input')
                this.declareInput(port.mechanismId, port.outputId, port.unit);
        }
    }
    declareOutput(mechanismId, outputId, unit) {
        const port = declareOutput(mechanismId, outputId, unit);
        const previous = this.outputs.get(outputId);
        if (previous) {
            if (previous.mechanismId !== mechanismId)
                throw new Error(`output ${outputId} already has writer ${previous.mechanismId}`);
            if (previous.unit !== unit)
                throw new Error(`output ${outputId} is already declared with unit ${previous.unit}`);
            return;
        }
        this.outputs.set(outputId, port);
    }
    /** Dynamic wiring requires the output to have been declared first. */
    declareInput(mechanismId, outputId, unit) {
        const port = declareInput(mechanismId, outputId, unit);
        const output = this.output(outputId);
        if (!sameDimension(output.unit, unit))
            throw new Error(`port dimension mismatch for ${outputId}: ${output.unit} and ${unit}`);
        const inputs = this.inputs.get(mechanismId) ?? new Map();
        const previous = inputs.get(outputId);
        if (previous && previous.unit !== unit)
            throw new Error(`input ${outputId} for ${mechanismId} is already declared with unit ${previous.unit}`);
        inputs.set(outputId, port);
        this.inputs.set(mechanismId, inputs);
    }
    output(outputId) {
        const output = this.outputs.get(outputId);
        if (!output)
            throw new Error(`undeclared output: ${outputId}`);
        return output;
    }
    /** Values are expressed in the output's declared unit. */
    write(outputId, value) {
        this.output(outputId);
        this.values.set(outputId, value);
    }
    /** Omit mechanismId for a raw output read; supply it for a wired input read. */
    read(outputId, mechanismId) {
        const output = this.output(outputId);
        const input = mechanismId === undefined ? undefined : this.inputs.get(mechanismId)?.get(outputId);
        if (mechanismId !== undefined && !input)
            throw new Error(`undeclared input: ${outputId} for ${mechanismId}`);
        const value = this.values.get(outputId);
        return value === undefined || !input ? value : convert(value, output.unit, input.unit);
    }
}
