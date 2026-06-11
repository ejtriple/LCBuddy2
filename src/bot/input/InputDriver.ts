/**
 * Semantic input operations. DIRECT (Slice 3) dispatches them through the
 * client's doAction; SYNTHETIC (Slice 6) will resolve the same ops through a
 * virtual cursor + the real minimenu. `op` is the 1-based option index
 * (OP_*1..5), already resolved from an action name by the entity layer.
 */
export interface InputDriver {
    /** The label telemetry/dataset rows get (PLAN.md §humanization). */
    readonly mode: 'direct' | 'synthetic';

    interactNpc(index: number, op: number): boolean;
    interactLoc(lx: number, lz: number, typecode: number, op: number): boolean;
    takeObj(lx: number, lz: number, objId: number, op: number): boolean;
    heldOp(objId: number, slot: number, comId: number, op: number): boolean;
    walk(lx: number, lz: number): boolean;
    continueDialog(): boolean;
}
