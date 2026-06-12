import { reader } from '../../adapter/ClientAdapter.js';
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

    /** Press continue and wait for the dialog page to change. */
    async continue(): Promise<boolean> {
        const before = reader.modals().chat;
        // direct resolves synchronously; synthetic spans the mouse gesture
        if (!(await ActionRouter.driver.continueDialog())) {
            return false;
        }

        return Execution.delayUntil(() => reader.modals().chat !== before || reader.chatContinueComId() !== -1, 3000);
    }
};
