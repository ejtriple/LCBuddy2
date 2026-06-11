/**
 * Script-facing base classes (RuneMate shape). Scripts subclass one of
 * LoopingBot / TaskBot / TreeBot and only sleep via Execution.*.
 */
export abstract class AbstractBot {
    /** Wall-clock ms between loop() iterations when loop() returns void. */
    loopDelay = 600;

    private logSink: ((msg: string) => void) | null = null;

    /** Optional lifecycle hooks. onStop also runs after a crash or stop(). */
    onStart?(): void | Promise<void>;
    onStop?(): void;
    onPause?(): void;
    onResume?(): void;

    /** Draw on the overlay canvas; called every client redraw while running. */
    onPaint?(ctx: CanvasRenderingContext2D): void;

    log(msg: string): void {
        if (this.logSink) {
            this.logSink(msg);
        } else {
            console.log(`[bot] ${msg}`);
        }
    }

    /** @internal runner wiring */
    bindLog(sink: (msg: string) => void): void {
        this.logSink = sink;
    }
}

export abstract class LoopingBot extends AbstractBot {
    /**
     * One iteration. Return a number to override loopDelay for the next
     * iteration. Launched only by the scheduler, never re-entered.
     */
    abstract loop(): number | void | Promise<number | void>;
}

export interface Task {
    validate(): boolean | Promise<boolean>;
    execute(): void | Promise<void>;
}

/** Runs the first task whose validate() returns true, once per loop. */
export abstract class TaskBot extends LoopingBot {
    private readonly tasks: Task[] = [];

    protected add(...tasks: Task[]): void {
        this.tasks.push(...tasks);
    }

    async loop(): Promise<number | void> {
        for (const task of this.tasks) {
            if (await task.validate()) {
                await task.execute();
                return;
            }
        }
    }
}

export abstract class BranchTask {
    abstract validate(): boolean;
    abstract success(): TreeNode;
    abstract failure(): TreeNode;
}

export abstract class LeafTask {
    abstract execute(): void | Promise<void>;
}

export type TreeNode = BranchTask | LeafTask;

/** Walks branches by validate() until a leaf, executes it, once per loop. */
export abstract class TreeBot extends LoopingBot {
    abstract root(): TreeNode;

    async loop(): Promise<number | void> {
        let node = this.root();
        while (node instanceof BranchTask) {
            node = node.validate() ? node.success() : node.failure();
        }

        await node.execute();
    }
}
