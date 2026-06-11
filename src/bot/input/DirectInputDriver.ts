import { MiniMenuAction } from '#/client/MiniMenuAction.js';

import { actions } from '../adapter/ClientAdapter.js';
import type { InputDriver } from './InputDriver.js';

const NPC_OPS = [MiniMenuAction.OP_NPC1, MiniMenuAction.OP_NPC2, MiniMenuAction.OP_NPC3, MiniMenuAction.OP_NPC4, MiniMenuAction.OP_NPC5];
const LOC_OPS = [MiniMenuAction.OP_LOC1, MiniMenuAction.OP_LOC2, MiniMenuAction.OP_LOC3, MiniMenuAction.OP_LOC4, MiniMenuAction.OP_LOC5];
const OBJ_OPS = [MiniMenuAction.OP_OBJ1, MiniMenuAction.OP_OBJ2, MiniMenuAction.OP_OBJ3, MiniMenuAction.OP_OBJ4, MiniMenuAction.OP_OBJ5];
const HELD_OPS = [MiniMenuAction.OP_HELD1, MiniMenuAction.OP_HELD2, MiniMenuAction.OP_HELD3, MiniMenuAction.OP_HELD4, MiniMenuAction.OP_HELD5];
const INV_BUTTONS = [MiniMenuAction.INV_BUTTON1, MiniMenuAction.INV_BUTTON2, MiniMenuAction.INV_BUTTON3, MiniMenuAction.INV_BUTTON4, MiniMenuAction.INV_BUTTON5];

/**
 * DIRECT mode: byte-identical OP packets via the client's own doAction, no
 * mouse/click telemetry. The deliberate "machine" class for the labeled
 * dataset, and the future headless path.
 */
export default class DirectInputDriver implements InputDriver {
    readonly mode = 'direct';

    interactNpc(index: number, op: number): boolean {
        // OPNPC*: a = npc scene index
        return actions.menuAction(NPC_OPS[op - 1], index, 0, 0);
    }

    interactLoc(lx: number, lz: number, typecode: number, op: number): boolean {
        // OPLOC*: a = typecode, b/c = scene-local tile
        return actions.menuAction(LOC_OPS[op - 1], typecode, lx, lz);
    }

    takeObj(lx: number, lz: number, objId: number, op: number): boolean {
        // OPOBJ*: a = obj id, b/c = scene-local tile
        return actions.menuAction(OBJ_OPS[op - 1], objId, lx, lz);
    }

    heldOp(objId: number, slot: number, comId: number, op: number): boolean {
        // OPHELD*: a = obj id, b = slot, c = component id
        return actions.menuAction(HELD_OPS[op - 1], objId, slot, comId);
    }

    invButton(objId: number, slot: number, comId: number, op: number): boolean {
        // INV_BUTTON*: same (a, b, c) encoding as OPHELD
        return actions.menuAction(INV_BUTTONS[op - 1], objId, slot, comId);
    }

    walk(lx: number, lz: number): boolean {
        return actions.walkTo(lx, lz);
    }

    continueDialog(): boolean {
        return actions.continueDialog();
    }
}
