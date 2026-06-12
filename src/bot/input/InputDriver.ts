/**
 * Semantic input operations. DIRECT (Slice 3) dispatches them through the
 * client's doAction synchronously (boolean); SYNTHETIC (Slice 6) resolves
 * the same ops through a virtual cursor + the real minimenu, so its methods
 * return a Promise that settles when the gesture completes. `op` is the
 * 1-based option index (OP_*1..5), already resolved from an action name by
 * the entity layer. No silent fallback between modes — a synthetic failure
 * resolves false (and logs) rather than degrading to direct (ADR-0003).
 */
export interface InputDriver {
    /** The label telemetry/dataset rows get (PLAN.md §humanization). */
    readonly mode: 'direct' | 'synthetic';

    interactNpc(index: number, op: number): boolean | Promise<boolean>;
    interactLoc(lx: number, lz: number, typecode: number, op: number): boolean | Promise<boolean>;
    takeObj(lx: number, lz: number, objId: number, op: number): boolean | Promise<boolean>;
    heldOp(objId: number, slot: number, comId: number, op: number): boolean | Promise<boolean>;
    /** Component-defined item button (bank withdraw/deposit etc.). */
    invButton(objId: number, slot: number, comId: number, op: number): boolean | Promise<boolean>;
    walk(lx: number, lz: number): boolean | Promise<boolean>;
    continueDialog(): boolean | Promise<boolean>;
}
