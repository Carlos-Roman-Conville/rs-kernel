export function must(table, id, what) {
    if (!Object.hasOwn(table, id))
        throw new Error(`unknown ${what}: ${id}`);
    return table[id];
}
export function nonempty(value, what) {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`${what} must be a non-empty string`);
    return value;
}
export function finite(value, what, min = Number.NEGATIVE_INFINITY) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min)
        throw new Error(`${what} must be a number >= ${min}`);
    return value;
}
export function integer(value, what, min) {
    finite(value, what, min);
    if (!Number.isInteger(value))
        throw new Error(`${what} must be an integer`);
    return value;
}
