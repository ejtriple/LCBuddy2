import DirectInputDriver from './DirectInputDriver.js';
import type { InputDriver } from './InputDriver.js';

/**
 * Single entry point for everything that emits input. Slice 3 ships DIRECT
 * only; Slice 6 adds SYNTHETIC and per-script mode selection. No silent
 * fallback between modes — dataset labels stay clean (PLAN.md §humanization).
 */
class ActionRouterImpl {
    driver: InputDriver = new DirectInputDriver();
}

export const ActionRouter = new ActionRouterImpl();
