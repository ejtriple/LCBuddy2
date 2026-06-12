import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Traversal } from '../api/Traversal.js';

const LEASH_RADIUS = 12;

/**
 * Slice 3 exit-criterion bot: kills chickens, loots and buries the bones,
 * unattended. Anchors to wherever it was started — stand among chickens.
 */
export default class ChickenKiller extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private buried = 0;
    private kills = 0;
    private status = 'starting';

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const here = Game.tile()!;
        this.anchor = new Tile(here.x, here.z, here.level);
        this.log(`anchored at ${this.anchor}, leash ${LEASH_RADIUS} tiles`);

        this.add(new ContinueDialog(this), new BuryBones(this), new LootBones(this), new Fight(this), new ReturnToAnchor(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`ChickenKiller — ${this.status}`, `kills ${this.kills}  buried ${this.buried}`, `tick ${Game.tick()}`];
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

    countBurial(): void {
        this.buried++;
    }

    countKill(): void {
        this.kills++;
    }

    getAnchor(): Tile {
        return this.anchor!;
    }
}

class ContinueDialog implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return ChatDialog.canContinue();
    }

    async execute(): Promise<void> {
        this.bot.setStatus('continuing dialog');
        await ChatDialog.continue();
    }
}

class BuryBones implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return Inventory.contains('Bones');
    }

    async execute(): Promise<void> {
        this.bot.setStatus('burying bones');
        const bones = Inventory.first('Bones');
        if (!bones) {
            return;
        }

        const before = Inventory.used();
        if (!bones.interact('Bury')) {
            this.bot.log(`no Bury op on bones? ops=[${bones.actions().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }

        if (await Execution.delayUntil(() => Inventory.used() < before, 3000)) {
            this.bot.countBurial();
            this.bot.log('buried bones');
        }
    }
}

class LootBones implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return !Game.inCombat() && this.findBones() !== null && !Inventory.isFull();
    }

    async execute(): Promise<void> {
        const bones = this.findBones();
        if (!bones) {
            return;
        }

        this.bot.setStatus(`looting bones at ${bones.tile()}`);
        const before = Inventory.used();
        if (!bones.interact('Take')) {
            this.bot.log(`no Take op on ground bones? ops=[${bones.actions().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }

        if (await Execution.delayUntil(() => Inventory.used() > before, 6000)) {
            this.bot.log('looted bones');
        } else {
            this.bot.log('loot timed out (unreachable?)');
        }
    }

    private findBones() {
        return GroundItems.query()
            .name('Bones')
            .within(LEASH_RADIUS + 4)
            .nearest();
    }
}

class Fight implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return !Game.inCombat() && this.findChicken() !== null;
    }

    async execute(): Promise<void> {
        const chicken = this.findChicken();
        if (!chicken) {
            return;
        }

        this.bot.setStatus(`attacking chicken at ${chicken.tile()}`);
        if (!chicken.interact('Attack')) {
            this.bot.log(`no Attack op on chicken? ops=[${chicken.actions().join(', ')}]`);
            await Execution.delayTicks(2);
            return;
        }

        const engaged = await Execution.delayUntil(() => Game.inCombat() || ChatDialog.canContinue(), 5000);
        if (!engaged || ChatDialog.canContinue()) {
            return;
        }

        this.bot.setStatus('fighting');
        // fight (auto-retaliate keeps it going) until the health bar clears
        // or a blocking dialog pops; bounded
        const done = await Execution.delayUntil(() => !Game.inCombat() || ChatDialog.canContinue(), 60000);
        if (done && !ChatDialog.canContinue()) {
            this.bot.countKill();
            this.bot.log('fight ended');
        }
    }

    private findChicken() {
        const anchor = this.bot.getAnchor();
        return Npcs.query()
            .name('Chicken')
            .action('Attack')
            .where(n => !n.inCombat && n.tile().distanceTo(anchor) <= LEASH_RADIUS)
            .nearest();
    }
}

class ReturnToAnchor implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        const here = Game.tile();
        return here !== null && this.bot.getAnchor().distanceTo(here) > LEASH_RADIUS;
    }

    async execute(): Promise<void> {
        this.bot.setStatus('returning to anchor');
        await Traversal.walkTo(this.bot.getAnchor(), { radius: 3, timeoutMs: 90000 });
    }
}
