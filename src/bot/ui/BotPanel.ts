import { reader } from '../adapter/ClientAdapter.js';
import type { BotHostImpl } from '../BotHost.js';
import { ScriptRegistry } from '../runtime/ScriptRegistry.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';

/**
 * Live state panel + script controls. Plain DOM, no framework. The only
 * DOM-dependent code outside bot.html/main.ts, by design — keeps a headless
 * build viable later.
 */
export default class BotPanel {
    private host: BotHostImpl;

    private scriptSelect: HTMLSelectElement;
    private startBtn: HTMLButtonElement;
    private pauseBtn: HTMLButtonElement;
    private stopBtn: HTMLButtonElement;
    private scriptStatus: HTMLElement;
    private logBox: HTMLElement;
    private unsubLog: (() => void) | null = null;

    private banner: HTMLElement;
    private stateCell: HTMLElement;
    private playerCell: HTMLElement;
    private tileCell: HTMLElement;
    private energyCell: HTMLElement;
    private countsCell: HTMLElement;
    private modalsCell: HTMLElement;
    private tickCell: HTMLElement;
    private statsGrid: HTMLElement;
    private chatList: HTMLElement;

    private statCells: { level: HTMLElement; cell: HTMLElement }[] = [];
    private lastRender = 0;

    constructor(root: HTMLElement, host: BotHostImpl) {
        this.host = host;

        root.replaceChildren();

        const title = el('div', 'lcb-title');
        title.textContent = 'LCBuddy2';
        root.appendChild(title);

        this.banner = el('div', 'lcb-banner');
        root.appendChild(this.banner);

        const script = el('div', 'lcb-section');
        script.appendChild(sectionTitle('script'));

        this.scriptSelect = document.createElement('select');
        this.scriptSelect.className = 'lcb-select';
        for (const meta of ScriptRegistry.list()) {
            const option = document.createElement('option');
            option.value = meta.name;
            option.textContent = meta.name;
            option.title = meta.description;
            this.scriptSelect.appendChild(option);
        }
        script.appendChild(this.scriptSelect);

        const buttons = el('div', 'lcb-buttons');
        this.startBtn = button(buttons, 'Start', () => this.handleStart());
        this.pauseBtn = button(buttons, 'Pause', () => this.handlePause());
        this.stopBtn = button(buttons, 'Stop', () => ScriptRunner.stop());
        script.appendChild(buttons);

        this.scriptStatus = row(script, 'status');
        root.appendChild(script);

        const status = el('div', 'lcb-section');
        status.appendChild(sectionTitle('status'));
        this.stateCell = row(status, 'state');
        this.playerCell = row(status, 'player');
        this.tileCell = row(status, 'tile');
        this.energyCell = row(status, 'energy');
        this.countsCell = row(status, 'nearby');
        this.modalsCell = row(status, 'modals');
        this.tickCell = row(status, 'tick');
        root.appendChild(status);

        const stats = el('div', 'lcb-section');
        stats.appendChild(sectionTitle('stats'));
        this.statsGrid = el('div', 'lcb-stats');
        stats.appendChild(this.statsGrid);
        root.appendChild(stats);

        const chat = el('div', 'lcb-section');
        chat.appendChild(sectionTitle('chat'));
        this.chatList = el('div', 'lcb-chat');
        chat.appendChild(this.chatList);
        root.appendChild(chat);

        const logSection = el('div', 'lcb-section');
        logSection.appendChild(sectionTitle('log'));
        this.logBox = el('div', 'lcb-log');
        logSection.appendChild(this.logBox);
        root.appendChild(logSection);

        ScriptRunner.onChange(() => {
            this.renderScriptControls();
            this.renderLog();
        });

        // stat cells are created once (sparse over unused skill ids), updated in place
        for (let i = 0; i < reader.skillCount(); i++) {
            if (!reader.skillUsed(i)) {
                continue;
            }

            const cell = el('div', 'lcb-stat');
            const name = el('span', 'lcb-stat-name');
            name.textContent = reader.stat(i).name.slice(0, 3);
            const level = el('span', 'lcb-stat-level');
            level.textContent = '-';
            cell.appendChild(name);
            cell.appendChild(level);
            this.statsGrid.appendChild(cell);
            this.statCells[i] = { level, cell };
        }

        host.addDrawListener(() => this.maybeRender());
        this.render();
        this.renderScriptControls();
    }

    private handleStart(): void {
        const meta = ScriptRegistry.get(this.scriptSelect.value);
        if (!meta) {
            return;
        }

        try {
            ScriptRunner.start(meta);
        } catch (err) {
            console.error('[lcbuddy] start failed', err);
            return;
        }

        // follow the new run's log
        this.unsubLog?.();
        this.unsubLog = ScriptRunner.ctx?.onLog(() => this.renderLog()) ?? null;
        this.renderLog();
    }

    private handlePause(): void {
        if (ScriptRunner.state === 'paused') {
            ScriptRunner.resume();
        } else {
            ScriptRunner.pause();
        }
    }

    private renderScriptControls(): void {
        const state = ScriptRunner.state;
        const active = state === 'running' || state === 'paused' || state === 'stopping';

        this.startBtn.disabled = active;
        this.pauseBtn.disabled = !(state === 'running' || state === 'paused');
        this.pauseBtn.textContent = state === 'paused' ? 'Resume' : 'Pause';
        this.stopBtn.disabled = !active || state === 'stopping';
        this.scriptSelect.disabled = active;

        const ctx = ScriptRunner.ctx;
        if (!ctx) {
            this.scriptStatus.textContent = 'idle';
        } else {
            const name = ScriptRunner.meta?.name ?? '?';
            const extra = state === 'crashed' && ctx.crashError ? ` — ${ctx.crashError.message}` : ` — ${ctx.loopCount} loops`;
            this.scriptStatus.textContent = `${name}: ${state}${extra}`;
        }
        this.scriptStatus.className = `lcb-value lcb-state-${state}`;
    }

    private renderLog(): void {
        const ctx = ScriptRunner.ctx;
        if (!ctx) {
            this.logBox.replaceChildren();
            return;
        }

        const atBottom = this.logBox.scrollTop + this.logBox.clientHeight >= this.logBox.scrollHeight - 4;

        this.logBox.replaceChildren();
        for (const line of ctx.log.slice(-200)) {
            const div = el('div', `lcb-log-line lcb-log-${line.level}`);
            const time = new Date(line.time).toTimeString().slice(0, 8);
            div.textContent = `${time} ${line.msg}`;
            this.logBox.appendChild(div);
        }

        if (atBottom) {
            this.logBox.scrollTop = this.logBox.scrollHeight;
        }
    }

    /** Throttle DOM updates to ~5Hz; the draw hook fires at up to 50Hz. */
    private maybeRender(): void {
        const now = performance.now();
        if (now - this.lastRender < 200) {
            return;
        }

        this.lastRender = now;
        this.render();
    }

    private render(): void {
        const missing = this.host.selfTestMissing;
        if (!reader.attached()) {
            this.banner.className = 'lcb-banner lcb-banner-warn';
            this.banner.textContent = 'adapter: not attached';
        } else if (missing.length > 0) {
            this.banner.className = 'lcb-banner lcb-banner-error';
            this.banner.textContent = `adapter self-test FAILED — missing: ${missing.join(', ')}`;
        } else {
            this.banner.className = 'lcb-banner lcb-banner-ok';
            this.banner.textContent = 'adapter self-test: ok';
        }

        const ingame = reader.ingame();
        this.stateCell.textContent = ingame ? 'ingame' : 'title screen';

        this.playerCell.textContent = reader.localPlayerName() ?? '-';

        const tile = reader.worldTile();
        this.tileCell.textContent = tile ? `${tile.x}, ${tile.z}, ${tile.level}` : '-';

        this.energyCell.textContent = ingame ? `${reader.energy()}% / ${reader.weight()} kg` : '-';
        this.countsCell.textContent = ingame ? `${reader.playerCount()} players, ${reader.npcCount()} npcs` : '-';

        const modals = reader.modals();
        this.modalsCell.textContent = `main ${modals.main} / side ${modals.side} / chat ${modals.chat}`;

        const mean = this.host.tickMeanMs;
        this.tickCell.textContent = `${this.host.tickCount}${mean > 0 ? ` (${mean.toFixed(0)}ms)` : ''}`;

        for (let i = 0; i < reader.skillCount(); i++) {
            if (!reader.skillUsed(i)) {
                continue;
            }

            const stat = reader.stat(i);
            const target = this.statCells[i];
            target.level.textContent = ingame ? `${stat.effective}/${stat.base}` : '-';
            target.cell.title = `${stat.name}: ${stat.xp} xp`;
        }

        const lines = reader.chat(6);
        this.chatList.replaceChildren();
        for (const line of lines) {
            const div = el('div', 'lcb-chat-line');
            div.textContent = line.username ? `${line.username}: ${line.text}` : line.text;
            this.chatList.appendChild(div);
        }
        if (lines.length === 0) {
            const div = el('div', 'lcb-chat-line lcb-dim');
            div.textContent = '(no messages)';
            this.chatList.appendChild(div);
        }
    }
}

function el(tag: string, className: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    return node;
}

function sectionTitle(text: string): HTMLElement {
    const node = el('div', 'lcb-section-title');
    node.textContent = text;
    return node;
}

function row(parent: HTMLElement, label: string): HTMLElement {
    const line = el('div', 'lcb-row');
    const key = el('span', 'lcb-key');
    key.textContent = label;
    const value = el('span', 'lcb-value');
    value.textContent = '-';
    line.appendChild(key);
    line.appendChild(value);
    parent.appendChild(line);
    return value;
}

function button(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
    const node = document.createElement('button');
    node.className = 'lcb-button';
    node.textContent = label;
    node.addEventListener('click', onClick);
    parent.appendChild(node);
    return node;
}
