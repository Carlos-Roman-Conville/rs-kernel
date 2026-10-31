export type Reducer<S, C, R> = (state: S, command: C) => R

/** Bind engine config and providers in the reducer passed to the constructor. */
export class Runner<S, C, R extends { state: S; events: E[] }, E> {
  state: S
  log: C[] = []
  events: E[] = []
  private readonly reduce: Reducer<S, C, R>

  constructor(state: S, reduce: Reducer<S, C, R>) {
    this.state = state
    this.reduce = reduce
  }

  run(command: C): R {
    // Prepare everything that can fail before publishing the command's effects.
    const logged = structuredClone(command)
    const result = this.reduce(structuredClone(this.state), command)
    this.state = result.state
    this.log.push(logged)
    for (const event of result.events) this.events.push(event)
    return result
  }

  /**
   * Engine subclasses keep (state, config, providers) constructors and their defaults.
   * For the base Runner, config is the bound reducer and from is the initial state.
   * Replay preserves command order, including provider-issued commands in an engine log.
   */
  static replay<S, C, R extends { state: S; events: E[] }, E>(
    this: typeof Runner, log: readonly C[], reduce: Reducer<S, C, R>, providers: undefined, from: S,
  ): Runner<S, C, R, E>
  static replay<S, C, Config, Providers, T extends { run(command: C): unknown }>(
    this: new (state: S, config: Config, providers: Providers) => T,
    log: readonly C[], config?: Config, providers?: Providers, from?: S,
  ): T
  static replay<S, C, Config, Providers, T extends { run(command: C): unknown }>(
    this: new (state: S, config: Config, providers: Providers) => T,
    log: readonly C[], config?: Config, providers?: Providers, from?: S,
  ): T {
    const runner = new this(structuredClone(from) as S, config as Config, providers as Providers)
    for (const command of log) runner.run(structuredClone(command))
    return runner
  }
}
