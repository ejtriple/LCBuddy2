import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { RandomEventTask } from '../api/RandomEvents.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs, type Npc } from '../api/queries/Npcs.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Skills } from '../api/hud/Skills.js';
import { Traversal } from '../api/Traversal.js';

const LEASH_RADIUS = 12;
/** Don't START fights below this HP fraction (auto-retaliate still defends). */
const FIGHT_HP_GATE = 0.45;
const REST_UNTIL_HP = 0.7;

/**
 * Slice 3 exit-criterion bot: kills chickens, loots and buries the bones,
 * unattended. Anchors to wherever it was started — stand among chickens.
 *
 * Hardening: fights are target-tracked (a kill is the chicken dying, not our
 * health bar clearing), death is detected via the chat event and recovered
 * by web-walking home from the respawn, and an HP gate stops new fights when
 * low. Random events: dialog events (genie/old man/dwarf) are clicked
 * through by ContinueDialog; attack events (swarm/mage) are survived via the
 * HP gate + death recovery; teleport-away events recover through
 * ReturnToAnchor where a walkable path home exists (the enclosed maze is not
 * solvable in v1).
 */
export default class ChickenKiller extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private buried = 0;
    private kills = 0;
    private deaths = 0;
    private status = 'starting';
    died = false;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        const here = Game.tile()!;
        this.anchor = new Tile(here.x, here.z, here.level);
        this.log(`anchored at ${this.anchor}, leash ${LEASH_RADIUS} tiles`);

        // 274 content says "Oh dear you are dead!" (no comma); match loosely
        // so a punctuation tweak upstream can't silently break recovery
        this.on('chat.message', e => {
            if (/oh dear.*you are dead/i.test(e.text)) {
                this.died = true;
            }
        });

        this.add(new RandomEventTask(msg => this.log(msg), ['chicken']), new ContinueDialog(this), new DeathRecovery(this), new BuryBones(this), new LootBones(this), new Rest(this), new Fight(this), new ReturnToAnchor(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const lines = [`ChickenKiller — ${this.status}`, `kills ${this.kills}  buried ${this.buried}${this.deaths > 0 ? `  deaths ${this.deaths}` : ''}`, `hp ${Skills.effective('hitpoints')}/${Skills.level('hitpoints')}  tick ${Game.tick()}`];
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

    countDeath(): void {
        this.deaths++;
    }

    getAnchor(): Tile {
        return this.anchor!;
    }
}

function hpFraction(): number {
    const base = Skills.level('hitpoints');
    return base > 0 ? Skills.effective('hitpoints') / base : 1;
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

/** Death -> wait out the respawn, then web-walk home and carry on. */
class DeathRecovery implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return this.bot.died;
    }

    async execute(): Promise<void> {
        this.bot.setStatus('died — recovering');
        this.bot.countDeath();
        this.bot.log('died! waiting for respawn, then walking back to the anchor');

        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 20000);
        await Execution.delayTicks(3); // let the respawn scene settle

        const here = Game.tile();
        if (here && this.bot.getAnchor().distanceTo(here) > 3) {
            const back = await Traversal.walkTo(this.bot.getAnchor(), { radius: 3, timeoutMs: 180000, log: msg => this.bot.log(`  ${msg}`) });
            this.bot.log(back ? 'back at the anchor' : 'could not walk back yet — will keep trying');
        }

        this.bot.died = false;
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

/** Low HP and out of combat: stand down until we regen (no new fights). */
class Rest implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return !Game.inCombat() && hpFraction() < FIGHT_HP_GATE;
    }

    async execute(): Promise<void> {
        this.bot.setStatus(`resting (${Skills.effective('hitpoints')}/${Skills.level('hitpoints')} hp)`);
        await Execution.delayUntil(() => hpFraction() >= REST_UNTIL_HP || Game.inCombat() || ChatDialog.canContinue(), 120000);
    }
}

class Fight implements Task {
    constructor(private bot: ChickenKiller) {}

    validate(): boolean {
        return !Game.inCombat() && hpFraction() >= FIGHT_HP_GATE && this.findChicken() !== null;
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

        // fight THIS chicken until it dies — our own health bar clearing
        // mid-fight does not end the kill
        this.bot.setStatus('fighting');
        const deadline = performance.now() + 90000;
        let reattacks = 0;

        while (performance.now() < deadline) {
            if (ChatDialog.canContinue() || this.bot.died) {
                return; // dialog/death tasks take over next loop
            }

            const me = Game.tile();
            if (!me || chicken.tile().distanceTo(me) > LEASH_RADIUS + 8) {
                // we got moved (teleport/death), not the chicken dying
                this.bot.log('displaced mid-fight — abandoning target');
                return;
            }

            const target = this.target(chicken);
            if (!target) {
                // despawned: died (corpse removed after the death animation)
                this.bot.countKill();
                this.bot.log('chicken killed');
                return;
            }

            if (target.health === 0 && target.snap.totalHealth > 0) {
                // death animation playing — wait for the despawn, then count
                await Execution.delayUntil(() => this.target(chicken) === null, 10000);
                this.bot.countKill();
                this.bot.log('chicken killed');
                return;
            }

            if (!Game.inCombat() && !target.inCombat) {
                // both disengaged but it's alive (wandered/blocked)
                if (reattacks >= 2) {
                    this.bot.log('target disengaged twice — abandoning this chicken');
                    return;
                }

                reattacks++;
                target.interact('Attack');
                await Execution.delayUntil(() => Game.inCombat() || ChatDialog.canContinue(), 5000);
                continue;
            }

            await Execution.delayTicks(2);
        }
    }

    /** Re-snapshot our engaged chicken by scene slot (name-checked). */
    private target(chicken: Npc): Npc | null {
        return Npcs.all().find(n => n.index === chicken.index && n.name === 'Chicken') ?? null;
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
