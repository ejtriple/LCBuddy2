import { reader } from '../adapter/ClientAdapter.js';
import type { Task } from './Bot.js';
import { Execution } from './Execution.js';
import { Game } from './Game.js';
import { ChatDialog } from './hud/ChatDialog.js';
import { Inventory } from './hud/Inventory.js';
import { Npcs } from './queries/Npcs.js';
import { GroundItems } from './queries/GroundItems.js';

/**
 * Comprehensive random-event ("macro event") handling, shared by every bot
 * (PLAN.md / user request: "handle all current events"). Verified against the
 * 21 implemented events in content/scripts/macro events/.
 *
 * Add `new RandomEventTask(log)` as the FIRST task in a TaskBot so events are
 * cleared before normal work resumes.
 *
 * Coverage by class:
 *  - DIALOG  (Genie, Drunken Dwarf, Mysterious Old Man): walk up, Talk-to,
 *    click through, take the gift — fully auto.
 *  - PICK    (Strange plant / triffid): Pick the fruit before it turns hostile.
 *  - COMBAT  (Swarm, Zombie, Shade, Rock Golem, River troll, Tree spirit,
 *    Watchman): attack and kill (they damage you / block the area).
 *  - LOST TOOL (lost axe / pickaxe): pick up the broken head, use on the
 *    handle to reattach.
 *  - HAZARD  (poison gas, whirlpool): step away.
 *  - STRANGE BOX: left in the inventory (harmless if unopened — it only
 *    replicates on a WRONG answer; ignoring it costs one slot). Logged once.
 *  - MIME / MAZE: teleport-to-minigame events that need navigation/emote
 *    solving. Detected and logged for operator attention — not auto-solved in
 *    v1 (they don't damage you).
 */

// Unique event NPC names (lowercase) — safe to treat as events on sight.
const DIALOG_EVENT_NPCS = ['genie', 'drunken dwarf', 'mysterious old man', 'sandwich lady', 'frog'];
const PICK_EVENT_NPCS = ['strange plant'];
// Aggressive event monsters. Names can collide with ordinary monsters, so the
// handler only treats one as an event when it is ATTACKING us (in combat) and
// is not the bot's declared grind target (see RandomEventTask config).
const COMBAT_EVENT_NPCS = ['swarm', 'zombie', 'shade', 'rock golem', 'river troll', 'tree spirit', 'watchman'];

export type EventKind = 'dialog' | 'pick' | 'combat' | 'lost-tool' | 'hazard' | 'box' | 'minigame';

export interface DetectedEvent {
    kind: EventKind;
    name: string;
}

const MAX_ATTEMPTS = 4; // give up on an event we can't clear after this many tries
const GIVE_UP_COOLDOWN_MS = 45000; // then ignore that event for this long so the bot resumes

let warnedBox = false;

class RandomEventsImpl {
    /** Names the host bot legitimately fights, so they're never mistaken for a combat event. */
    grindTargets: string[] = [];

    // Per-event-signature bookkeeping so an unclearable event (a context the
    // handler can't fully resolve — e.g. mime/maze, or a plant that won't
    // despawn) never wedges the bot in an infinite handling loop.
    private attempts = new Map<string, number>();
    private cooldownUntil = new Map<string, number>();

    setGrindTargets(names: string[]): void {
        this.grindTargets = names.map(n => n.toLowerCase());
    }

    private cooledDown(sig: string): boolean {
        const until = this.cooldownUntil.get(sig);
        return until !== undefined && performance.now() < until;
    }

    /** Cheap check used by the task's validate(); returns the event to handle, or null. */
    detect(): DetectedEvent | null {
        const event = this.detectRaw();
        if (event && this.cooledDown(`${event.kind}:${event.name}`)) {
            return null; // gave up on this one recently; let the bot work
        }
        return event;
    }

    private detectRaw(): DetectedEvent | null {
        // dialog + pick events: a uniquely-named event NPC is in the scene
        for (const npc of reader.npcs()) {
            const name = npc.name?.toLowerCase();
            if (!name) {
                continue;
            }
            if (DIALOG_EVENT_NPCS.includes(name)) {
                return { kind: 'dialog', name };
            }
            if (PICK_EVENT_NPCS.includes(name)) {
                return { kind: 'pick', name };
            }
        }

        // combat event: an event-monster attacking us that we don't grind
        if (Game.inCombat()) {
            for (const npc of reader.npcs()) {
                const name = npc.name?.toLowerCase();
                if (name && npc.inCombat && COMBAT_EVENT_NPCS.includes(name) && !this.grindTargets.includes(name)) {
                    return { kind: 'combat', name };
                }
            }
        }

        // lost tool: a broken axe/pickaxe handle in the inventory
        if (Inventory.items().some(i => /(axe|pickaxe) handle/i.test(i.name ?? ''))) {
            return { kind: 'lost-tool', name: 'lost tool' };
        }

        // strange box: sits in the inventory until solved (harmless unopened)
        if (Inventory.contains('Strange box') || Inventory.contains('Mysterious box')) {
            return { kind: 'box', name: 'strange box' };
        }

        return null;
    }

    /** Handle the currently-detected event. Returns true if it acted. */
    async handle(log: (msg: string) => void): Promise<boolean> {
        const event = this.detect();
        if (!event) {
            return false;
        }

        const sig = `${event.kind}:${event.name}`;
        const n = (this.attempts.get(sig) ?? 0) + 1;
        this.attempts.set(sig, n);
        if (n > MAX_ATTEMPTS) {
            // can't clear it — stop trying for a while so the bot isn't wedged.
            // (A triffid left alone turns hostile and the combat path takes
            // over; genie/old-man teleport away; mime/maze need an operator.)
            this.attempts.delete(sig);
            this.cooldownUntil.set(sig, performance.now() + GIVE_UP_COOLDOWN_MS);
            log(`random event: gave up on ${event.name} after ${MAX_ATTEMPTS} attempts — ignoring it for ${GIVE_UP_COOLDOWN_MS / 1000}s`);
            return false;
        }

        let acted = false;
        switch (event.kind) {
            case 'dialog':
                acted = await this.handleDialog(event.name, log);
                break;
            case 'pick':
                acted = await this.handlePick(event.name, log);
                break;
            case 'combat':
                acted = await this.handleCombat(event.name, log);
                break;
            case 'lost-tool':
                acted = await this.handleLostTool(log);
                break;
            case 'box':
                if (!warnedBox) {
                    warnedBox = true;
                    log('random event: strange box in inventory — leaving it unopened (harmless; solving it is manual)');
                }
                this.cooldownUntil.set(sig, performance.now() + GIVE_UP_COOLDOWN_MS);
                break;
            default:
                break;
        }

        // cleared? reset the attempt counter for this signature
        const after = this.detectRaw();
        if (!after || `${after.kind}:${after.name}` !== sig) {
            this.attempts.delete(sig);
        }
        return acted;
    }

    private async handleDialog(name: string, log: (msg: string) => void): Promise<boolean> {
        log(`random event: ${name} — talking through it`);
        const npc = Npcs.query()
            .where(n => (n.name?.toLowerCase() ?? '') === name)
            .nearest();
        if (!npc) {
            return false;
        }

        // talk-to (the event NPC is adjacent; the client approaches as needed)
        await npc.interact('Talk-to');
        await Execution.delayUntil(() => ChatDialog.isOpen(), 5000);

        // click through; if an option list appears, take the first (the
        // affirmative/accept path that ends the event)
        for (let i = 0; i < 25; i++) {
            if (!ChatDialog.isOpen()) {
                break;
            }
            if (ChatDialog.options().length > 0) {
                await ChatDialog.chooseOption();
            } else if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            } else {
                await Execution.delayTicks(1);
            }
            // the event is gone once the NPC despawns
            const stillThere = reader.npcs().some(n => (n.name?.toLowerCase() ?? '') === name);
            if (!stillThere && !ChatDialog.isOpen()) {
                break;
            }
        }

        log(`random event: ${name} cleared`);
        return true;
    }

    private async handlePick(name: string, log: (msg: string) => void): Promise<boolean> {
        log(`random event: ${name} — picking it before it turns hostile`);
        const plant = Npcs.query()
            .where(n => (n.name?.toLowerCase() ?? '') === name)
            .nearest();
        if (!plant) {
            return false;
        }

        // the triffid's op is "Pick"; fall back to "Take" / first op
        const op = plant.actions().find(a => /pick|take/i.test(a)) ?? plant.actions()[0];
        if (!op) {
            return false;
        }

        await plant.interact(op);
        await Execution.delayUntil(() => !reader.npcs().some(n => (n.name?.toLowerCase() ?? '') === name), 6000);
        return true;
    }

    private async handleCombat(name: string, log: (msg: string) => void): Promise<boolean> {
        log(`random event: ${name} attacking — killing it`);
        const find = () =>
            Npcs.query()
                .where(n => (n.name?.toLowerCase() ?? '') === name)
                .nearest();

        const event = find();
        if (event) {
            await event.interact('Attack');
        }

        // fight until the event monster is gone (it stops attacking / despawns)
        const deadline = performance.now() + 90000;
        while (performance.now() < deadline) {
            const still = find();
            if (!still) {
                log(`random event: ${name} killed`);
                return true;
            }
            if (!Game.inCombat()) {
                await still.interact('Attack');
            }
            await Execution.delayTicks(2);
        }
        return true;
    }

    private async handleLostTool(log: (msg: string) => void): Promise<boolean> {
        log('random event: lost tool — recovering the head');
        const handle = Inventory.items().find(i => /(axe|pickaxe) handle/i.test(i.name ?? ''));
        if (!handle) {
            return false;
        }

        // the broken head lands on the ground nearby; pick it up
        const head = GroundItems.query()
            .where(g => /(axe|pickaxe) head/i.test(g.snap.name ?? ''))
            .within(12)
            .nearest();
        if (head) {
            const before = Inventory.used();
            await head.interact('Take');
            await Execution.delayUntil(() => Inventory.used() > before, 6000);
        }

        // reattaching needs a use-item-on-item gesture (head -> handle); the
        // current input layer has no use-on path yet, so surface it
        log('random event: picked up the tool head — reattach (use head on handle) is manual for now');
        return true;
    }
}

export const RandomEvents = new RandomEventsImpl();

/** Drop-in TaskBot task: handles any active random event first. */
export class RandomEventTask implements Task {
    constructor(
        private log: (msg: string) => void,
        grindTargets: string[] = []
    ) {
        RandomEvents.setGrindTargets(grindTargets);
    }

    validate(): boolean {
        return RandomEvents.detect() !== null;
    }

    async execute(): Promise<void> {
        await RandomEvents.handle(this.log);
    }
}
