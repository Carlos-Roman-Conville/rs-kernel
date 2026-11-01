/** Bind engine config and providers in the reducer passed to the constructor. */
export class Runner {
    state;
    log = [];
    events = [];
    reduce;
    constructor(state, reduce) {
        this.state = state;
        this.reduce = reduce;
    }
    run(command) {
        // Prepare everything that can fail before publishing the command's effects.
        const logged = structuredClone(command);
        const result = this.reduce(structuredClone(this.state), command);
        this.state = result.state;
        this.log.push(logged);
        for (const event of result.events)
            this.events.push(event);
        return result;
    }
    static replay(log, config, providers, from) {
        const runner = new this(structuredClone(from), config, providers);
        for (const command of log)
            runner.run(structuredClone(command));
        return runner;
    }
}
