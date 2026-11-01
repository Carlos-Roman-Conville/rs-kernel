import { finite, nonempty } from "./guards.js";
import { simTime } from "./time.js";
import { transaction } from "./transaction.js";
/**
 * Owns the active representation (structured-cloneable data) and is a transaction
 * participant. Register each process through this service, in the host's chosen
 * order. Both sets retain scheduler slots; inactive wrappers skip owner callbacks.
 * Owner callbacks should only transform their arguments and enlisted participants.
 */
export class ResolutionService {
    id;
    resolution;
    scheduler;
    random;
    draw;
    quantity;
    participants;
    current;
    last = new Map();
    modes = new Map();
    switching = false;
    constructor(options) {
        this.id = nonempty(options.resolution.id, 'resolution id');
        const seen = new Set();
        const conserved = options.resolution.conserved.map(row => {
            nonempty(row.quantity, 'conserved quantity');
            nonempty(row.unit, 'conserved unit');
            finite(row.tolerance, 'conserved tolerance', 0);
            if (seen.has(row.quantity))
                throw new Error(`duplicate conserved quantity: ${row.quantity}`);
            seen.add(row.quantity);
            return { ...row };
        });
        this.resolution = {
            id: this.id, conserved,
            coarsen: options.resolution.coarsen.bind(options.resolution),
            refine: options.resolution.refine.bind(options.resolution),
        };
        this.scheduler = options.scheduler;
        this.random = options.rng;
        this.draw = this.random.get(nonempty(options.mechanismId, 'resolution mechanism id'));
        this.quantity = options.quantity;
        this.participants = [...options.participants ?? []];
        this.current = structuredClone(options.initial);
        this.validateMode(this.current.mode);
    }
    /** Processes read/mutate the active data here; a switch replaces its object. */
    get state() { return this.current; }
    get mode() { return this.current.mode; }
    validateMode(mode) {
        if (mode !== 'fine' && mode !== 'coarse')
            throw new Error(`unknown resolution mode: ${mode}`);
    }
    boundary(t) {
        simTime(t, 'resolution switch time');
        if (t !== this.scheduler.t)
            throw new Error('resolution requires the current scheduler boundary');
        if (this.switching)
            throw new Error('resolution switch is already in progress');
        // At the current T this performs no work, but the scheduler rejects calls from
        // any process callback (including unrelated processes) or after a failed run.
        this.scheduler.runUntil(t);
    }
    register(mode, process) {
        this.validateMode(mode);
        this.boundary(this.scheduler.t);
        const id = process.id;
        this.scheduler.register({
            ...process,
            run: ctx => {
                if (this.mode !== mode)
                    return;
                process.run({ ...ctx, dt: ctx.t - this.last.get(id) });
                this.last.set(id, ctx.t);
            },
        });
        this.modes.set(id, mode);
        this.last.set(id, this.scheduler.t);
        return this;
    }
    /**
     * Call after runUntil(T): the old set closes T, and the new set first runs after
     * T on its normal period/offset grid. This never advances the clock itself.
     * An enclosing transaction can enlist this service to roll back a later failure.
     */
    switchTo(mode, t) {
        this.validateMode(mode);
        this.boundary(t);
        if (mode === this.mode)
            return this.current;
        this.switching = true;
        try {
            return transaction([this, ...this.participants], () => {
                if (this.current.mode === 'coarse') {
                    const aggregate = structuredClone(this.current.aggregate);
                    const individuals = this.resolution.refine(structuredClone(aggregate), this.draw);
                    // Check on a copy: even a mutating coarsener cannot alter the fine state.
                    const roundTrip = this.resolution.coarsen(structuredClone(individuals));
                    for (const row of this.resolution.conserved) {
                        const before = finite(this.quantity(aggregate, row.quantity), `quantity ${row.quantity}`);
                        const after = finite(this.quantity(roundTrip, row.quantity), `quantity ${row.quantity}`);
                        if (Math.abs(after - before) > row.tolerance) {
                            throw new Error(`resolution ${this.id} does not conserve ${row.quantity} (${row.unit}, tolerance ${row.tolerance})`);
                        }
                    }
                    this.current = { mode: 'fine', individuals };
                }
                else {
                    // Install the complete coarsener result, without rounding or adjustment.
                    const aggregate = this.resolution.coarsen(structuredClone(this.current.individuals));
                    this.current = { mode: 'coarse', aggregate };
                }
                for (const [id, activeMode] of this.modes) {
                    if (activeMode === mode)
                        this.last.set(id, t);
                }
                return this.current;
            });
        }
        finally {
            this.switching = false;
        }
    }
    snapshot() {
        return structuredClone({ state: this.current, last: [...this.last], rng: this.random.state() });
    }
    /** Restore at the same scheduler boundary; scheduler time itself is not rewound. */
    restore(snapshot) {
        const saved = structuredClone(snapshot);
        this.current = saved.state;
        this.last = new Map(saved.last);
        this.random.restore(saved.rng);
    }
}
export function switchTo(service, mode, t) {
    return service.switchTo(mode, t);
}
