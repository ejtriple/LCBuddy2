import { actions, reader } from '../adapter/ClientAdapter.js';
import { BotHost } from '../BotHost.js';
import { ScriptRunner } from './ScriptRunner.js';

const FIRST_RETRY_MS = 6000;
const RETRY_STEP_MS = 10000;
const MAX_RETRY_MS = 30000;
const MAX_ATTEMPTS = 15;

/**
 * Reconnect watchdog (Slice 7). While a script is running/paused it captures
 * the session credentials every frame (Client.logout() clears them), and on
 * an ingame -> title transition it pauses the run, retries the client's own
 * login with backoff (the server rejects "already online" for ~10s after a
 * drop), and resumes once the scene is rebuilt. Host-side: runs off the
 * frame hook, not inside any script context.
 */
class AutoReloginImpl {
    private enabled = false;
    private username = '';
    private password = '';

    private wasIngame = false;
    private reconnecting = false;
    private wePaused = false;
    private attempts = 0;
    private nextAttemptAt = 0;

    enable(): void {
        if (this.enabled) {
            return;
        }

        this.enabled = true;
        BotHost.addFrameListener(() => this.onFrame());
    }

    private scriptActive(): boolean {
        const state = ScriptRunner.state;
        return state === 'running' || state === 'paused';
    }

    private onFrame(): void {
        const ingame = reader.ingame();

        if (ingame) {
            const creds = actions.loginCredentials();
            if (creds.username.length > 0) {
                this.username = creds.username;
                this.password = creds.password;
            }

            if (this.reconnecting) {
                if (reader.sceneState() === 2) {
                    ScriptRunner.ctx?.addLog('info', `auto-relogin: back ingame as '${this.username}' after ${this.attempts} attempt(s)`);
                    if (this.wePaused) {
                        ScriptRunner.resume();
                    }
                    this.reconnecting = false;
                    this.wePaused = false;
                }
            }

            this.wasIngame = true;
            return;
        }

        // not ingame
        if (this.wasIngame) {
            this.wasIngame = false;

            if (this.scriptActive() && this.username.length > 0) {
                this.reconnecting = true;
                this.attempts = 0;
                this.nextAttemptAt = performance.now() + FIRST_RETRY_MS;

                if (ScriptRunner.state === 'running') {
                    ScriptRunner.pause();
                    this.wePaused = true;
                }
                ScriptRunner.ctx?.addLog('warn', `auto-relogin: disconnected — retrying as '${this.username}'`);
            }
        }

        if (!this.reconnecting) {
            return;
        }

        if (!this.scriptActive()) {
            // user stopped the script while we were reconnecting — stand down
            this.reconnecting = false;
            this.wePaused = false;
            return;
        }

        if (performance.now() < this.nextAttemptAt) {
            return;
        }

        if (this.attempts >= MAX_ATTEMPTS) {
            ScriptRunner.ctx?.addLog('error', `auto-relogin: giving up after ${MAX_ATTEMPTS} attempts`);
            this.reconnecting = false;
            return;
        }

        this.attempts++;
        const backoff = Math.min(FIRST_RETRY_MS + this.attempts * RETRY_STEP_MS, MAX_RETRY_MS);
        this.nextAttemptAt = performance.now() + backoff;
        ScriptRunner.ctx?.addLog('info', `auto-relogin: attempt ${this.attempts}/${MAX_ATTEMPTS}`);
        actions.login(this.username, this.password);
    }
}

export const AutoRelogin = new AutoReloginImpl();
