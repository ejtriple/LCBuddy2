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
