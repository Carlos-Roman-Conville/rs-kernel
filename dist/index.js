// The Kernel barrel: each service is re-exported here as its unit lands (ADOPTION.md, stage K).
export { Compactor } from "./compact.js";
export { declareOutput, declareInput, PortTable } from "./ports.js";
export { parse, dim, sameDimension, convert, defaultUnits } from "./units.js";
export { mint, qualify, unqualify } from "./ids.js";
export { must, nonempty, finite, integer } from "./guards.js";
export { rng, fnv1a32, mix32, streams } from "./rng.js";
export { Runner } from "./runner.js";
export { transaction } from "./transaction.js";
export { transfer, TransferJournal } from "./transfer.js";
export { canonical, fnv1a64, take, restore, checkKernelBlock } from "./snapshot.js";
export { MS, SECOND, MINUTE, HOUR, DAY, TROPICAL_YEAR, simTime } from "./time.js";
export { Order, defaultOrder } from "./order.js";
export { Scheduler } from "./scheduler.js";
export { EventBus } from "./events.js";
export { ResolutionService, switchTo } from "./resolution.js";
export { Trace } from "./trace.js";
