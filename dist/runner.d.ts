export type Reducer<S, C, R> = (state: S, command: C) => R;
/** Bind engine config and providers in the reducer passed to the constructor. */
export declare class Runner<S, C, R extends {
    state: S;
    events: E[];
}, E> {
    state: S;
    log: C[];
    events: E[];
    private readonly reduce;
    constructor(state: S, reduce: Reducer<S, C, R>);
    run(command: C): R;
    /**
     * Engine subclasses keep (state, config, providers) constructors and their defaults.
     * For the base Runner, config is the bound reducer and from is the initial state.
     * Replay preserves command order, including provider-issued commands in an engine log.
     */
    static replay<S, C, R extends {
        state: S;
        events: E[];
    }, E>(this: typeof Runner, log: readonly C[], reduce: Reducer<S, C, R>, providers: undefined, from: S): Runner<S, C, R, E>;
    static replay<S, C, Config, Providers, T extends {
        run(command: C): unknown;
    }>(this: new (state: S, config: Config, providers: Providers) => T, log: readonly C[], config?: Config, providers?: Providers, from?: S): T;
}
