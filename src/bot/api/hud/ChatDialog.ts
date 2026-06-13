import { actions, reader } from '../../adapter/ClientAdapter.js';
import { ActionRouter } from '../../input/ActionRouter.js';
import { Execution } from '../Execution.js';

export const ChatDialog = {
    /** A chat modal is open (dialog, make-x, etc.). */
    isOpen(): boolean {
        return reader.modals().chat !== -1;
    },

    /** A "Click here to continue" button is up. */
    canContinue(): boolean {
        return reader.chatContinueComId() !== -1;
    },

    /** Selectable option lines in the current dialog (text only). */
    options(): string[] {
        return reader.chatOptions().map(o => o.text);
    },

    /** A "What would you like to make?" skill-multi menu is open. */
    isMakeMenu(): boolean {
        return reader.makeProducts().length > 0;
    },

    /** Product names offered by the open make menu. */
    makeProducts(): string[] {
        return reader.makeProducts().map(p => p.name);
    },

    /**
     * In a skill-multi make menu, pick the product whose name contains `match`
     * (or the first product if omitted) at the largest fixed quantity offered
     * (prefer 10), clicking its resume button. Returns false if no product or
     * button matched.
     */
    async make(match?: string): Promise<boolean> {
        const products = reader.makeProducts();
        if (products.length === 0) {
            return false;
        }

        const want = match?.toLowerCase();
        const product = want ? products.find(p => p.name.toLowerCase().includes(want)) : products[0];
        const btn = product?.buttons.filter(b => b.qty > 0).sort((a, b) => b.qty - a.qty)[0];
        if (!btn) {
            return false;
        }

        const before = reader.modals().chat;
        if (!actions.ifButton(btn.comId)) {
            return false;
        }

        return Execution.delayUntil(() => reader.modals().chat !== before, 3000);
    },

    /** Press continue and wait for the dialog page to change. */
    async continue(): Promise<boolean> {
        const before = reader.modals().chat;
        // direct resolves synchronously; synthetic spans the mouse gesture
        if (!(await ActionRouter.driver.continueDialog())) {
            return false;
        }

        return Execution.delayUntil(() => reader.modals().chat !== before || reader.chatContinueComId() !== -1, 3000);
    },

    /**
     * Pick a dialog option whose text contains `match` (case-insensitive), or
     * the first option if `match` is omitted. Returns false if no option
     * matched.
     */
    async chooseOption(match?: string): Promise<boolean> {
        const opts = reader.chatOptions();
        if (opts.length === 0) {
            return false;
        }

        const wanted = match?.toLowerCase();
        const pick = wanted ? opts.find(o => o.text.toLowerCase().includes(wanted)) : opts[0];
        if (!pick) {
            return false;
        }

        const before = reader.modals().chat;
        if (!actions.ifButton(pick.comId)) {
            return false;
        }

        return Execution.delayUntil(() => reader.modals().chat !== before || reader.chatContinueComId() !== -1, 3000);
    }
};
