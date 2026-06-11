import { reader } from '../adapter/ClientAdapter.js';
import type { BotHostImpl } from '../BotHost.js';

/**
 * Read-only live state panel (Slice 1). Plain DOM, no framework. The only
 * DOM-dependent code outside bot.html/main.ts, by design — keeps a headless
 * build viable later.
 */
export default class BotPanel {
    private host: BotHostImpl;

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
