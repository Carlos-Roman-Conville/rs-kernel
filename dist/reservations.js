import { finite, nonempty } from "./guards.js";
import { simTime } from "./time.js";
/** Integer-ms accounting only; actors' owners supply all capacity bounds. */
export class ReservationLedger {
    id;
    bound;
    reservations = new Map();
    log = [];
    constructor(options) {
        this.id = nonempty(options.id ?? 'kernel.reservations', 'reservation ledger id');
        this.bound = options.bound;
    }
    reserve(now, request) {
        simTime(now);
        const { id, actor, cause, start, end, share } = request;
        nonempty(id, 'reservation id');
        nonempty(actor, 'reservation actor');
        nonempty(cause, 'reservation cause');
        simTime(start, 'reservation start');
        simTime(end, 'reservation end');
        finite(share, 'reservation share');
        if (share <= 0)
            throw new Error('reservation share must be positive');
        if (start >= end)
            throw new Error('reservation start must precede end');
        if (start < now)
            throw new Error('reservation start is in the past');
        if (this.reservations.has(id))
            throw new Error(`duplicate reservation: ${id}`);
        const bound = this.bound(actor);
        if (bound === undefined)
            throw new Error(`missing bound for ${actor}`);
        if (bound.kind === 'series') {
            let previous = -1;
            for (const step of bound.steps) {
                simTime(step.from, 'bound step');
                finite(step.value, 'bound value', 0);
                if (step.from <= previous)
                    throw new Error(`bound steps must ascend for ${actor}`);
                previous = step.from;
            }
            if (!bound.steps.length || bound.steps[0].from > start) {
                throw new Error(`missing bound for ${actor} at ${start}`);
            }
            const overlapping = [...this.reservations.values()].filter(reservation => reservation.actor === actor && reservation.status === 'reserved' &&
                reservation.start < end && reservation.end > start);
            const points = new Set([start]);
            for (const point of [
                ...bound.steps.map(step => step.from),
                ...overlapping.flatMap(reservation => [reservation.start, reservation.end]),
            ]) {
                if (point > start && point < end)
                    points.add(point);
            }
            let stepIndex = 0;
            for (const t of [...points].sort((a, b) => a - b)) {
                while (stepIndex + 1 < bound.steps.length && bound.steps[stepIndex + 1].from <= t)
                    stepIndex++;
                const total = overlapping.reduce((sum, reservation) => sum + (reservation.start <= t && t < reservation.end ? reservation.share : 0), share);
                if (total > bound.steps[stepIndex].value)
                    throw new Error(`bound exceeded for ${actor} at ${t}`);
            }
        }
        else if (bound.kind !== 'unbounded' || bound.evidence !== 'fixture') {
            throw new Error(`invalid bound for ${actor}`);
        }
        const reservation = { id, actor, cause, start, end, share, status: 'reserved', fulfilledMs: 0 };
        return this.append(now, 'reserve', reservation);
    }
    release(now, id) {
        simTime(now);
        const reservation = this.pending(id);
        if (now >= reservation.end)
            throw new Error(`reservation already elapsed: ${id}`);
        return this.append(now, 'release', {
            ...reservation, status: 'released', fulfilledMs: Math.max(0, now - reservation.start), releasedAt: now,
        });
    }
    fulfil(now, id) {
        simTime(now);
        const reservation = this.pending(id);
        if (now < reservation.end)
            throw new Error(`reservation has not ended: ${id}`);
        return this.append(now, 'fulfil', {
            ...reservation, status: 'fulfilled', fulfilledMs: reservation.end - reservation.start,
        });
    }
    active(actor, t) {
        simTime(t);
        return [...this.reservations.values()].filter(reservation => reservation.actor === actor && reservation.status === 'reserved' &&
            reservation.start <= t && t < reservation.end).map(reservation => ({ ...reservation }));
    }
    records() { return this.log.map(record => ({ ...record })); }
    snapshot() {
        return {
            reservations: [...this.reservations.values()].map(reservation => ({ ...reservation })),
            records: this.records(),
        };
    }
    restore(snapshot) {
        const saved = snapshot;
        this.reservations = new Map(saved.reservations.map(reservation => [reservation.id, { ...reservation }]));
        this.log = saved.records.map(record => ({ ...record }));
    }
    pending(id) {
        const reservation = this.reservations.get(id);
        if (!reservation)
            throw new Error(`unknown reservation: ${id}`);
        if (reservation.status !== 'reserved')
            throw new Error(`reservation is already ${reservation.status}: ${id}`);
        return reservation;
    }
    append(t, operation, reservation) {
        this.reservations.set(reservation.id, reservation);
        this.log.push({ ...reservation, operation, t });
        return { ...reservation };
    }
}
