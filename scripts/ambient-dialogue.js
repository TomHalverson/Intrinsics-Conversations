import { MODULE_ID, FLAGS } from './constants.js';
import { isTokenInRange, getActivePlayerTokens, showFloatingText, stripHTML, postTokenChatMessage, pickRandom, tableToLines } from './utils.js';
import { emitSocket, onSocket } from './socket.js';
import { conversationGroups } from './conversation-groups.js';

/**
 * Ambient dialogue ("dialogue auras"): an NPC says a random inline line when a
 * player token lingers within range. Lines are authored as JSON and stored on
 * the *actor* flag (historical key 'dialogueAura') as
 * { enabled, range, lines: [...] }, mirroring how dialogue trees live on the
 * actor. Worlds built before the JSON switch stored a RollTable id on the token
 * flag; those are migrated to inline lines on ready.
 *
 * The GM client runs the monitoring loop and broadcasts lines. Re-trigger
 * cooldown is kept in memory (per token), so several tokens of one actor don't
 * fight over a shared persisted timestamp.
 */
class AmbientDialogueSystem {
    constructor() {
        this.activeAuras = new Map(); // tokenId -> { range, lines, enabled, lastTriggered }
        this.monitoring = false;
        this.safetyInterval = null;
        this._moveTimeout = null;
    }

    registerSettings() {
        game.settings.register(MODULE_ID, 'dialogueAuraEnabled', {
            name: 'Enable Ambient Dialogue',
            hint: 'NPCs with ambient lines speak when players come within range',
            scope: 'world', config: true, type: Boolean, default: true
        });
        game.settings.register(MODULE_ID, 'dialogueAuraRange', {
            name: 'Ambient Dialogue Range (feet)',
            hint: 'Default detection range for ambient dialogue in feet',
            scope: 'world', config: true, type: Number, default: 30,
            range: { min: 5, max: 120, step: 5 }
        });
        game.settings.register(MODULE_ID, 'dialogueAuraRandomInterval', {
            name: 'Ambient Trigger Interval (seconds)',
            hint: 'Minimum seconds between lines while a player stays in range',
            scope: 'world', config: true, type: Number, default: 10,
            range: { min: 5, max: 60, step: 5 },
            // The safety interval is derived from this value — restart it.
            onChange: () => {
                if (!ambientDialogue.monitoring) return;
                ambientDialogue.stopMonitoring();
                ambientDialogue.startMonitoring();
            }
        });
        game.settings.register(MODULE_ID, 'dialogueAuraFloatingText', {
            name: 'Show Floating Text',
            hint: 'Display dialogue as floating text above NPCs',
            scope: 'world', config: true, type: Boolean, default: true
        });
        game.settings.register(MODULE_ID, 'dialogueAuraChatMessage', {
            name: 'Show in Chat',
            hint: 'Also display dialogue in the chat log',
            scope: 'world', config: true, type: Boolean, default: true
        });
        game.settings.register(MODULE_ID, 'globalPause', {
            name: 'Pause All Conversations',
            hint: 'Pause all ambient dialogue and conversation groups from triggering',
            scope: 'world', config: true, type: Boolean, default: false
        });
    }

    setup() {
        // Players render floating text broadcast by the GM.
        onSocket('floatingText', (data) => {
            if (game.user.isGM) return; // GM already displayed it locally
            const token = canvas.tokens.get(data?.tokenId);
            if (token && data?.text) showFloatingText(token, data.text);
        });

        if (game.user.isGM) {
            // Migrate table-based auras before the first monitoring pass.
            this.migrateLegacyData().finally(() => this.startMonitoring());
        }
    }

    /** Show a line above a token everywhere, and optionally in chat. */
    async displayDialogue(token, text, { floating = null, chat = null } = {}) {
        const showFloat = floating ?? game.settings.get(MODULE_ID, 'dialogueAuraFloatingText');
        const showChat = chat ?? game.settings.get(MODULE_ID, 'dialogueAuraChatMessage');
        if (showFloat) {
            const cleanText = stripHTML(text);
            showFloatingText(token, cleanText);
            emitSocket('floatingText', { tokenId: token.id, text: cleanText });
        }
        if (showChat) await postTokenChatMessage(token, text);
    }

    /** Normalised view of an actor's aura config: { enabled, range, lines }. */
    normalizeConfig(raw) {
        if (!raw) return null;
        const lines = Array.isArray(raw.lines) ? raw.lines.map(s => String(s)).filter(s => s.trim()) : [];
        if (!lines.length) return null;
        return {
            enabled: raw.enabled ?? true,
            range: Number(raw.range) || game.settings.get(MODULE_ID, 'dialogueAuraRange'),
            lines
        };
    }

    /**
     * One-time migration from RollTable-based auras to inline lines. Walks every
     * scene's token docs, reading the referenced table's rows onto the token's
     * actor and clearing the old token flag.
     */
    async migrateLegacyData() {
        try {
            for (const scene of game.scenes) {
                for (const tokenDoc of scene.tokens) {
                    const flag = tokenDoc.getFlag(MODULE_ID, FLAGS.AMBIENT);
                    if (!flag || Array.isArray(flag.lines)) continue; // absent or already JSON
                    const lines = tableToLines(flag.tableId);
                    const actor = tokenDoc.actor;
                    if (actor && lines.length && !Array.isArray(actor.getFlag(MODULE_ID, FLAGS.AMBIENT)?.lines)) {
                        await actor.setFlag(MODULE_ID, FLAGS.AMBIENT, {
                            enabled: flag.enabled ?? true,
                            range: Number(flag.range) || game.settings.get(MODULE_ID, 'dialogueAuraRange'),
                            lines
                        });
                    }
                    await tokenDoc.unsetFlag(MODULE_ID, FLAGS.AMBIENT);
                }
            }
        } catch (e) {
            console.error(`${MODULE_ID} | ambient dialogue migration failed`, e);
        }
    }

    // -- Configuration (actor flags) -----------------------------------------

    async assignLinesToToken(tokenId, lines, range = null) {
        const actor = canvas.tokens.get(tokenId)?.actor;
        if (!actor) {
            ui.notifications.error('Token has no actor');
            return false;
        }
        const clean = Array.isArray(lines) ? lines.map(s => String(s).trim()).filter(Boolean) : [];
        if (!clean.length) {
            ui.notifications.error('Add at least one line');
            return false;
        }
        const config = {
            range: range || game.settings.get(MODULE_ID, 'dialogueAuraRange'),
            enabled: true,
            lines: clean
        };
        await actor.setFlag(MODULE_ID, FLAGS.AMBIENT, config);
        this.activeAuras.set(tokenId, { ...config, lastTriggered: 0 });
        return true;
    }

    async removeFromToken(tokenId) {
        const actor = canvas.tokens.get(tokenId)?.actor;
        if (!actor) return false;
        await actor.unsetFlag(MODULE_ID, FLAGS.AMBIENT);
        this.activeAuras.delete(tokenId);
        return true;
    }

    async updateAuraRange(tokenId, newRange) {
        const actor = canvas.tokens.get(tokenId)?.actor;
        const flag = actor?.getFlag(MODULE_ID, FLAGS.AMBIENT);
        if (!actor || !flag) return false;
        await actor.setFlag(MODULE_ID, FLAGS.AMBIENT, { ...flag, range: newRange });
        const aura = this.activeAuras.get(tokenId);
        if (aura) aura.range = newRange;
        return true;
    }

    async toggleAura(tokenId, enabled) {
        const actor = canvas.tokens.get(tokenId)?.actor;
        const flag = actor?.getFlag(MODULE_ID, FLAGS.AMBIENT);
        if (!actor || !flag) return false;
        await actor.setFlag(MODULE_ID, FLAGS.AMBIENT, { ...flag, enabled });
        if (enabled) this.activeAuras.set(tokenId, { ...this.normalizeConfig({ ...flag, enabled }), lastTriggered: 0 });
        else this.activeAuras.delete(tokenId);
        return true;
    }

    getAuraConfig(tokenId) {
        const live = this.activeAuras.get(tokenId);
        if (live) return live;
        return this.normalizeConfig(canvas.tokens.get(tokenId)?.actor?.getFlag(MODULE_ID, FLAGS.AMBIENT));
    }

    getAllAuras() {
        return Array.from(this.activeAuras.entries()).map(([tokenId, aura]) => ({ tokenId, ...aura }));
    }

    loadAurasFromScene() {
        this.activeAuras.clear();
        for (const token of canvas.tokens.placeables) {
            const config = this.normalizeConfig(token.actor?.getFlag(MODULE_ID, FLAGS.AMBIENT));
            if (config?.enabled) {
                this.activeAuras.set(token.id, { ...config, lastTriggered: 0 });
            }
        }
    }

    // -- Monitoring (GM only) --------------------------------------------------
    // Event-driven: token movement triggers a debounced check; a slow safety
    // interval (the trigger-interval setting) covers "player stands still
    // inside the aura" re-triggers. No fast polling loop.

    startMonitoring() {
        if (this.monitoring) return;
        this.monitoring = true;
        this.loadAurasFromScene();
        const seconds = Math.max(5, game.settings.get(MODULE_ID, 'dialogueAuraRandomInterval'));
        this.safetyInterval = setInterval(() => this.checkAll(), seconds * 1000);
    }

    stopMonitoring() {
        this.monitoring = false;
        if (this.safetyInterval) clearInterval(this.safetyInterval);
        this.safetyInterval = null;
        if (this._moveTimeout) clearTimeout(this._moveTimeout);
        this._moveTimeout = null;
    }

    /** Debounced movement trigger — many waypoint updates collapse into one check. */
    onTokenMoved() {
        if (!this.monitoring || !game.user.isGM) return;
        if (this._moveTimeout) clearTimeout(this._moveTimeout);
        this._moveTimeout = setTimeout(() => {
            this._moveTimeout = null;
            this.checkAll();
        }, 250);
    }

    checkAll() {
        if (!game.user.isGM || !canvas?.ready) return;
        if (game.settings.get(MODULE_ID, 'globalPause')) return;

        if (game.settings.get(MODULE_ID, 'dialogueAuraEnabled') && this.activeAuras.size > 0) {
            const playerTokens = getActivePlayerTokens();
            if (playerTokens.length > 0) {
                for (const [tokenId, aura] of this.activeAuras.entries()) {
                    this.checkAura(tokenId, aura, playerTokens);
                }
            }
        }
        conversationGroups.checkConversations();
    }

    checkAura(tokenId, aura, playerTokens) {
        const npcToken = canvas.tokens.get(tokenId);
        if (!npcToken) {
            this.activeAuras.delete(tokenId);
            return;
        }
        if (playerTokens.some(pt => isTokenInRange(npcToken, pt, aura.range))) {
            this.triggerDialogue(tokenId, aura, npcToken);
        }
    }

    async triggerDialogue(tokenId, aura, npcToken, force = false) {
        const now = Date.now();
        const interval = game.settings.get(MODULE_ID, 'dialogueAuraRandomInterval');
        if (!force && (now - aura.lastTriggered) / 1000 < interval) return;

        const text = pickRandom(aura.lines);
        if (!text) {
            this.activeAuras.delete(tokenId);
            return;
        }

        aura.lastTriggered = now; // set immediately to prevent rapid re-triggering
        try {
            await this.displayDialogue(npcToken, text);
        } catch (e) {
            console.error(`${MODULE_ID} | error triggering ambient dialogue`, e);
        }
    }

    /** Hub "Test now" button: fire once regardless of range and cooldown. */
    async testToken(tokenId) {
        const npcToken = canvas.tokens.get(tokenId);
        const config = this.normalizeConfig(npcToken?.actor?.getFlag(MODULE_ID, FLAGS.AMBIENT));
        if (!npcToken || !config?.lines.length) {
            ui.notifications.warn('No ambient dialogue configured for this token');
            return;
        }
        await this.triggerDialogue(tokenId, { ...config, lastTriggered: 0 }, npcToken, true);
    }
}

export const ambientDialogue = new AmbientDialogueSystem();

export function registerAmbientHooks() {
    Hooks.on('canvasReady', () => ambientDialogue.loadAurasFromScene());
    Hooks.on('createToken', () => ambientDialogue.loadAurasFromScene());
    Hooks.on('deleteToken', (tokenDoc) => ambientDialogue.activeAuras.delete(tokenDoc.id));
    // Movement drives the in-range checks (covers both a player token moving
    // near an aura NPC and an aura NPC moving near players).
    Hooks.on('updateToken', (tokenDoc, changes) => {
        if (changes.x === undefined && changes.y === undefined) return;
        ambientDialogue.onTokenMoved();
    });
}
