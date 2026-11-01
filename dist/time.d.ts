/** Integer milliseconds since the run's epoch; validated at scheduler boundaries. */
export type SimTime = number;
export declare const MS: SimTime;
export declare const SECOND: SimTime;
export declare const MINUTE: SimTime;
export declare const HOUR: SimTime;
export declare const DAY: SimTime;
export declare const TROPICAL_YEAR: SimTime;
export declare function simTime(value: number, what?: string): SimTime;
