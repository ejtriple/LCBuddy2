import { BotHost } from '../BotHost.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';

/**
 * Owns the transparent overlay canvas stacked on the game canvas. Calls the
 * running script's onPaint(ctx) after every client redraw — bots draw stats
 * without ever touching Pix2D.
 */
export default class Overlay {
    private readonly ctx2d: CanvasRenderingContext2D | null;
    private readonly canvas: HTMLCanvasElement;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx2d = canvas.getContext('2d');
        BotHost.addDrawListener(() => this.paint());
    }

    private paint(): void {
        const ctx = this.ctx2d;
        if (!ctx) {
            return;
        }

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const bot = ScriptRunner.bot;
        const state = ScriptRunner.state;
        if (!bot?.onPaint || (state !== 'running' && state !== 'paused')) {
            return;
        }

        try {
            ctx.save();
            bot.onPaint(ctx);
        } catch (err) {
            console.error('[lcbuddy] onPaint error', err);
        } finally {
            ctx.restore();
        }
    }
}
