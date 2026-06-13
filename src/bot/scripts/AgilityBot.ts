import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { RandomEventTask } from '../api/RandomEvents.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Locs } from '../api/queries/Locs.js';
import type { SettingsSchema } from '../runtime/Settings.js';

/** Shared parameter schema for any agility-course preset. */
export const AGILITY_SETTINGS: SettingsSchema = {
    obstacles: {
        type: 'string',
        default: 'Log balance,Obstacle net,Tree branch,Balancing rope,Obstacle pipe',
        label: 'Obstacles (in order)',
        help: 'comma-separated obstacle loc names for the course; the bot does the nearest matching one each step'
    },
    searchRadius: { type: 'number', default: 20, min: 4, max: 64, label: 'Obstacle search radius (tiles)' }
};

/**
 * Runs an agility course: repeatedly walk to and use the nearest course
 * obstacle (its op1 — Walk-across / Climb / Squeeze-through / …), wait for the
 * traversal to carry the player to the far side, and move on. Obstacles are
 * laid out linearly, so "nearest in the course set" naturally advances the
 * lap and rolls over at the end. Same OPLOC interaction the gatherers use.
 */
export default class AgilityBot extends TaskBot {
    override loopDelay = 600;

    private names = new Set<string>();
    private radius = 20;
    private laps = 0;
    private obstaclesCleared = 0;
    private status = 'starting';
    // tile we last started an obstacle from, to detect "did we move across?"
    private lastFrom: { x: number; z: number } | null = null;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.names = new Set(
            this.settings
                .str('obstacles', '')
                .split(',')
                .map(s => s.trim().toLowerCase())
                .filter(Boolean)
        );
        this.radius = this.settings.num('searchRadius', 20);
        this.log(`running agility course: [${[...this.names].join(', ')}] within ${this.radius} tiles`);

        this.add(new RandomEventTask(msg => this.log(msg)), new ContinueDialog(), new DoObstacle(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`Agility — ${this.status}`, `obstacles ${this.obstaclesCleared}  laps ${this.laps}`, `tick ${Game.tick()}`];
        ctx.font = '12px monospace';
        const width = Math.max(...lines.map(l => ctx.measureText(l).width)) + 12;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(6, 6, width, lines.length * 16 + 10);
        ctx.fillStyle = '#9be05b';
        lines.forEach((line, i) => ctx.fillText(line, 12, 24 + i * 16));
    }

    setStatus(s: string): void {
        this.status = s;
    }
    obstacleNames(): Set<string> {
        return this.names;
    }
    searchRadius(): number {
        return this.radius;
    }
    cleared(): void {
        this.obstaclesCleared++;
    }
    setFrom(t: { x: number; z: number } | null): void {
        this.lastFrom = t;
    }
    from(): { x: number; z: number } | null {
        return this.lastFrom;
    }
}

class ContinueDialog implements Task {
    validate(): boolean {
        return ChatDialog.canContinue();
    }
    async execute(): Promise<void> {
        await ChatDialog.continue();
    }
}

class DoObstacle implements Task {
    constructor(private bot: AgilityBot) {}

    private next() {
        const names = this.bot.obstacleNames();
        const within = this.bot.searchRadius();
        return Locs.query()
            .where(l => {
                const n = l.name?.toLowerCase();
                return n !== undefined && names.has(n) && l.distance() <= within;
            })
            .nearest();
    }

    validate(): boolean {
        return this.next() !== null;
    }

    async execute(): Promise<void> {
        const obstacle = this.next();
        if (!obstacle) {
            return;
        }

        const op = obstacle.actions()[0];
        if (!op) {
            return;
        }

        const here = Game.tile();
        this.bot.setStatus(`${op} ${obstacle.name} at ${obstacle.tile()}`);
        if (!(await obstacle.interact(op))) {
            await Execution.delayTicks(2);
            return;
        }

        // an obstacle carries the player across — wait until the tile has
        // moved well away from where we started and then settled. Generous
        // timeout: rope swings / pipes take several seconds.
        const start = here;
        await Execution.delayUntil(() => Game.animating() || (Game.tile() !== null && start !== null && farFrom(Game.tile()!, start)), 6000);
        let last = Game.tile();
        for (let settle = 0; settle < 25; settle++) {
            await Execution.delayTicks(1);
            const now = Game.tile();
            if (now && last && now.x === last.x && now.z === last.z && !Game.animating() && !ChatDialog.canContinue()) {
                break; // stopped moving and idle — obstacle complete
            }
            last = now;
        }

        if (start && Game.tile() && farFrom(Game.tile()!, start)) {
            this.bot.cleared();
        }
    }
}

/** Moved more than two tiles in either axis — we traversed the obstacle. */
function farFrom(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    return Math.abs(a.x - b.x) > 2 || Math.abs(a.z - b.z) > 2;
}
