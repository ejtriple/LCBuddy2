import type { InvItemSnapshot } from '../../adapter/ClientAdapter.js';
import { reader } from '../../adapter/ClientAdapter.js';
import { ActionRouter } from '../../input/ActionRouter.js';
import { Execution } from '../Execution.js';

/**
 * Bank access (read + component-button withdraw/deposit). The bank screen is
 * a main modal whose TYPE_INV child defines Withdraw-* ops; the side modal
 * swaps to a Deposit-* backpack view while it is open.
 */
export const Bank = {
    isOpen(): boolean {
        return reader.bankComId() !== -1;
    },

    items(): InvItemSnapshot[] {
        return reader.bankItems();
    },

    count(name: string): number {
        const wanted = name.toLowerCase();
        return reader
            .bankItems()
            .filter(i => i.name?.toLowerCase() === wanted)
            .reduce((sum, i) => sum + i.count, 0);
    },

    /** Click a Withdraw-* button on a bank item, e.g. withdraw('Logs', 'Withdraw-5'). */
    withdraw(name: string, op: string = 'Withdraw-1'): boolean | Promise<boolean> {
        return clickInvButton(reader.bankItems(), name, op);
    },

    /** Click a Deposit-* button on a backpack item while the bank is open. */
    deposit(name: string, op: string = 'Deposit-1'): boolean | Promise<boolean> {
        return clickInvButton(reader.bankSideItems(), name, op);
    },

    /** Deposit every slot (uses the highest Deposit op available per item). */
    async depositInventory(): Promise<void> {
        await Bank.depositAllMatching(() => true);
    },

    /**
     * Deposit every pack slot whose item name matches `match` (Deposit-all per
     * slot), leaving everything else — e.g. bank the loot but keep food/gear.
     */
    async depositAllMatching(match: (name: string) => boolean): Promise<void> {
        for (let guard = 0; guard < 32; guard++) {
            const items = reader.bankSideItems();
            const item = items.find(i => i.name !== null && match(i.name));
            if (!item) {
                return;
            }

            const allOp = item.ops.findIndex(op => op?.toLowerCase().includes('all'));
            const op = allOp !== -1 ? allOp + 1 : bestOpIndex(item.ops);
            if (op === -1) {
                return;
            }

            ActionRouter.driver.invButton(item.id, item.slot, item.comId, op);
            await Execution.delayUntil(() => !reader.bankSideItems().some(i => i.slot === item.slot && i.id === item.id), 2000);
        }
    }
};

function clickInvButton(items: InvItemSnapshot[], name: string, opLabel: string): boolean | Promise<boolean> {
    const wanted = name.toLowerCase();
    const item = items.find(i => i.name?.toLowerCase() === wanted);
    if (!item) {
        return false;
    }

    const opWanted = opLabel.toLowerCase();
    for (let i = 0; i < item.ops.length; i++) {
        if (item.ops[i]?.toLowerCase() === opWanted) {
            return ActionRouter.driver.invButton(item.id, item.slot, item.comId, i + 1);
        }
    }

    return false;
}

function bestOpIndex(ops: (string | null)[]): number {
    for (let i = ops.length - 1; i >= 0; i--) {
        if (ops[i]) {
            return i + 1;
        }
    }

    return -1;
}
