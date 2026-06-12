import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { RandomEventTask } from '../api/RandomEvents.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { Locs } from '../api/queries/Locs.js';
import { Traversal } from '../api/Traversal.js';

const LEASH_RADIUS = 15;

/**
 * Slice 4 exit-criterion bot: chops trees and drops the logs, forever.
 * Anchors to wherever it was started — stand near trees with an axe in the
 * inventory (or wielded). Uses the event bus for xp/level/inventory tracking.
 */
export default class Woodcutter extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private logsChopped = 0;
    private xpGained = 0;
    private status = 'starting';
    private chopping = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const here = Game.tile()!;
        this.anchor = new Tile(here.x, here.z, here.level);
        this.log(`anchored at ${this.anchor}, woodcutting lvl ${Skills.level('woodcutting')}`);

        this.on('skill.xp', e => {
            if (e.name === 'woodcutting') {
                this.xpGained += e.delta;
                this.chopping = true;
            }
        });
        this.on('skill.level', e => {
            this.log(`level up! ${e.name} ${e.previous} -> ${e.level}`);
        });
        this.on('inventory.changed', e => {
            if (e.name?.toLowerCase() === 'logs' && e.count > e.previousCount) {
                this.logsChopped++;
            }
        });

        this.add(new RandomEventTask(msg => this.log(msg)), new ContinueDialog(this), new DropLogs(this), new Chop(this), new ReturnToAnchor(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`Woodcutter — ${this.status}`, `logs ${this.logsChopped}  wc xp +${this.xpGained}`, `lvl ${Skills.level('woodcutting')}  tick ${Game.tick()}`];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#5be05b';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(status: string): void {
        this.status = status;
    }

    getAnchor(): Tile {
        return this.anchor!;
    }

    /** Set by the skill.xp listener; consumed by Chop to detect progress. */
    consumeChopProgress(): boolean {
        const was = this.chopping;
        this.chopping = false;
        return was;
    }
}

class ContinueDialog implements Task {
    constructor(private bot: Woodcutter) {}

    validate(): boolean {
        return ChatDialog.canContinue();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('continuing dialog');
        await ChatDialog.continue();
    }
}

class DropLogs implements Task {
    constructor(private bot: Woodcutter) {}

    validate(): boolean {
        return Inventory.isFull() || (Inventory.contains('Logs') && Inventory.used() >= 26);
    }

    async execute(): Promise<void> {
        this.bot.setStatus('dropping logs');

        for (let guard = 0; guard < 30; guard++) {
            const logs = Inventory.first('Logs');
            if (!logs) {
                break;
            }

            const before = Inventory.used();
            if (!logs.interact('Drop')) {
                this.bot.log(`no Drop op on logs? ops=[${logs.actions().join(', ')}]`);
                return;
            }

            await Execution.delayUntil(() => Inventory.used() < before, 3000);
        }

        this.bot.log('dropped all logs');
    }
}

class Chop implements Task {
    constructor(private bot: Woodcutter) {}

    validate(): boolean {
        return this.findTree() !== null && !Inventory.isFull();
    }

    async execute(): Promise<void> {
        const tree = this.findTree();
        if (!tree) {
            return;
        }

        this.bot.setStatus(`chopping tree at ${tree.tile()}`);
        if (!tree.interact('Chop down')) {
            this.bot.log(`no 'Chop down' op on tree? ops=[${tree.actions().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }

        this.bot.consumeChopProgress();

        // wait until we start getting xp, the tree falls, or we time out
        const started = await Execution.delayUntil(() => this.bot.consumeChopProgress() || ChatDialog.canContinue(), 12000);
        if (!started || ChatDialog.canContinue()) {
            return;
        }

        // keep chopping while progress continues; trees fall on their own
        for (let guard = 0; guard < 60; guard++) {
            const progressed = await Execution.delayUntil(() => this.bot.consumeChopProgress() || ChatDialog.canContinue() || Inventory.isFull(), 8000);
            if (!progressed || ChatDialog.canContinue() || Inventory.isFull()) {
                return;
            }
        }
    }

    private findTree() {
        const anchor = this.bot.getAnchor();
        return Locs.query()
            .name('Tree')
            .action('Chop down')
            .where(l => l.tile().distanceTo(anchor) <= LEASH_RADIUS)
            .nearest();
    }
}

class ReturnToAnchor implements Task {
    constructor(private bot: Woodcutter) {}

    validate(): boolean {
        const here = Game.tile();
        return here !== null && this.bot.getAnchor().distanceTo(here) > LEASH_RADIUS;
    }

    async execute(): Promise<void> {
        this.bot.setStatus('returning to anchor');
        await Traversal.walkTo(this.bot.getAnchor(), { radius: 3, timeoutMs: 90000 });
    }
}
