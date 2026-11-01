// The engines own their prefix lists; minting preserves their existing local ids.
export function mint(counters, prefix) {
    const n = (counters[prefix] ?? 0) + 1;
    return { id: `${prefix}.${String(n).padStart(4, '0')}`, counters: { ...counters, [prefix]: n } };
}
/** Qualify an opaque local id at the Kernel boundary. */
export function qualify(engine, id) {
    if (!engine || engine.includes('/'))
        throw new Error('engine must be non-empty and contain no /');
    if (!id || id.includes('/'))
        throw new Error('local id must be non-empty and contain no /');
    return `${engine}/${id}`;
}
/** Invert qualification without interpreting the local id. */
export function unqualify(qualified) {
    const separator = qualified.indexOf('/');
    if (separator <= 0 || separator === qualified.length - 1 || qualified.indexOf('/', separator + 1) !== -1) {
        throw new Error('qualified id must have the form engine/local id');
    }
    return { engine: qualified.slice(0, separator), id: qualified.slice(separator + 1) };
}
