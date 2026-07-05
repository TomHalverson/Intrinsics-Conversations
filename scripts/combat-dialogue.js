import { MODULE_ID, FLAGS } from './constants.js';
import { showFloatingText, stripHTML, postTokenChatMessage, pickRandom, tableToLines } from './utils.js';
import { emitSocket } from './socket.js';

// Trigger kinds an NPC can have barks for. 'action' is the historical
// attack/cast trigger; the pre-JSON single `tableId` is migrated into it.
export const COMBAT_TRIGGERS = {
    action: { label: 'Attack / cast', hint: 'chance per action (module setting)' },
    damaged: { label: 'Taking damage', hint: 'chance when damaged (module setting)' },
    death: { label: 'Death (HP reaches 0)', hint: 'always — once per combat' },
    combatStart: { label: 'Combat start', hint: 'always' }
};

/**
 * Combat dialogue: NPCs can bark a random line on combat triggers (PF2e):
 * attacking/casting, taking damage, dying, and combat start. Lines are authored
 * as inline JSON and stored on the *actor* flag as
 * { enabled, lines: { action, damaged, death, combatStart } } — each trigger
 * holding an array of strings, mirroring how dialogue trees live on the actor.
 *
 * Worlds built before the JSON switch stored RollTable ids (on token flags, or
 * the older 'combatDialogueData' world setting). Those are migrated on ready by
 * reading each table's rows into inline lines, then dropped.
 */
class CombatDialogueSystem {
    constructor() {
        this.lastRolledTime = new Map(); // tokenId -> ms, per-token spam guard
        this.lastGlobalActionTime = 0; // one bark per action, across tokens
        this.spamThrottleMs = 500;
        this.globalActionThrottleMs = 1500;
        this.deathAnnounced = new Set(); // "<combatId>:<tokenId>" — once per combat
    }

    registerSettings() {
        game.settings.register(MODULE_ID, 'combatDialogueEnabled', {
            name: 'Enable Combat Dialogue',
            hint: 'NPCs with combat lines can speak when attacking or casting',
            scope: 'world', config: true, type: Boolean, default: true
        });
        game.settings.register(MODULE_ID, 'combatDialogueChatDisplay', {
            name: 'Show Combat Dialogue in Chat',
            scope: 'world', config: true, type: Boolean, default: true
        });
        game.settings.register(MODULE_ID, 'combatDialogueFloatingText', {
            name: 'Show Combat Dialogue Floating Text',
            scope: 'world', config: true, type: Boolean, default: true
        });
        game.settings.register(MODULE_ID, 'combatDialogueProbability', {
            name: 'Combat Dialogue Chance (%)',
            hint: 'Probability (0-100) that dialogue triggers on attack/spell or damage taken',
            scope: 'world', config: true, type: Number, default: 30,
            range: { min: 0, max: 100, step: 5 }
        });
        // Legacy storage, kept registered only so existing data can be migrated.
        game.settings.register(MODULE_ID, 'combatDialogueData', {
            scope: 'world', config: false, type: String, default: '{}'
        });
    }

    setup() {
        // The pre-update HP stash must run on whichever client initiates the
        // update (often a player applying damage); the options object travels
        // with the broadcast so the GM's updateActor handler can read it.
        Hooks.on('preUpdateActor', (actor, changes, options) => {
            const newHp = foundry.utils.getProperty(changes, 'system.attributes.hp.value');
            if (newHp === undefined) return;
            options.icvOldHp = foundry.utils.getProperty(actor, 'system.attributes.hp.value');
        });

        if (game.user.isGM) {
            // Migrate before wiring triggers so they read the new inline shape.
            this.migrateLegacyData().finally(() => this.registerHooks());
        }
    }

    /** Only one GM client should bark, even with several GMs connected. */
    #isActingGM() {
        return game.users.activeGM ? game.users.activeGM === game.user : game.user.isGM;
    }

    /** Normalised view of an actor's combat config: { enabled, lines }. */
    normalizeConfig(raw) {
        if (!raw) return null;
        const src = raw.lines ?? {};
        const lines = {};
        for (const key of Object.keys(COMBAT_TRIGGERS)) {
            const arr = Array.isArray(src[key]) ? src[key].map(s => String(s)).filter(s => s.trim()) : [];
            if (arr.length) lines[key] = arr;
        }
        if (!Object.keys(lines).length) return null;
        return { enabled: raw.enabled ?? true, lines };
    }

    /**
     * One-time migration from RollTable-based configs to inline lines. Covers
     * both the old per-token flags (across every scene) and the even older
     * 'combatDialogueData' world setting, writing the converted lines onto the
     * token's actor and clearing the old token flag.
     */
    async migrateLegacyData() {
        try {
            // 1. Pre-flag world-setting configs: { tokenId: { tableId, enabled } }.
            const raw = game.settings.get(MODULE_ID, 'combatDialogueData');
            const data = JSON.parse(raw || '{}');
            const remaining = {};
            for (const [tokenId, config] of Object.entries(data)) {
                const actor = canvas.tokens?.get(tokenId)?.actor;
                if (!actor) { remaining[tokenId] = config; continue; }
                if (!actor.getFlag(MODULE_ID, FLAGS.COMBAT)?.lines) {
                    const action = tableToLines(config.tableId);
                    if (action.length) {
                        await actor.setFlag(MODULE_ID, FLAGS.COMBAT, {
                            enabled: config.enabled ?? true, lines: { action }
                        });
                    }
                }
            }
            if (Object.keys(remaining).length !== Object.keys(data).length) {
                await game.settings.set(MODULE_ID, 'combatDialogueData', JSON.stringify(remaining));
            }

            // 2. Token-flag configs that still reference RollTables, on any scene.
            for (const scene of game.scenes) {
                for (const tokenDoc of scene.tokens) {
                    const flag = tokenDoc.getFlag(MODULE_ID, FLAGS.COMBAT);
                    if (!flag || flag.lines) continue; // absent or already JSON
                    const tables = { ...(flag.tables ?? {}) };
                    if (!tables.action && flag.tableId) tables.action = flag.tableId;
                    const lines = {};
                    for (const [key, tableId] of Object.entries(tables)) {
                        if (!COMBAT_TRIGGERS[key]) continue;
                        const list = tableToLines(tableId);
                        if (list.length) lines[key] = list;
                    }
                    const actor = tokenDoc.actor;
                    if (actor && Object.keys(lines).length && !actor.getFlag(MODULE_ID, FLAGS.COMBAT)?.lines) {
                        await actor.setFlag(MODULE_ID, FLAGS.COMBAT, { enabled: flag.enabled ?? true, lines });
                    }
                    await tokenDoc.unsetFlag(MODULE_ID, FLAGS.COMBAT);
                }
            }
        } catch (e) {
            console.error(`${MODULE_ID} | combat dialogue migration failed`, e);
        }
    }

    registerHooks() {
        // PF2e strike/spell messages carry origin flags; this is the most
        // reliable signal across PF2e versions.
        Hooks.on('createChatMessage', async (message) => {
            if (!this.#isActingGM()) return;
            if (!game.settings.get(MODULE_ID, 'combatDialogueEnabled')) return;
            if (!game.combat?.active) return;
            if (!message.flags?.pf2e?.origin?.type) return;
            if (!this.shouldRollGlobalAction()) return;

            const actor = message.speaker?.actor ? game.actors.get(message.speaker.actor) : null;
            const token = actor?.getActiveTokens()?.[0];
            if (!token) return;

            const config = this.getTokenConfig(token.id);
            if (!config?.lines.action || !config.enabled) return;
            if (!this.shouldRoll(token.id)) return;

            await this.rollAndDisplayDialogue(token, config.lines.action);
        });

        // Damage / death barks from HP deltas (old value stashed in preUpdateActor).
        Hooks.on('updateActor', async (actor, changes, options) => {
            if (!this.#isActingGM()) return;
            if (!game.settings.get(MODULE_ID, 'combatDialogueEnabled')) return;
            if (!game.combat?.active) return;

            const newHp = foundry.utils.getProperty(changes, 'system.attributes.hp.value');
            if (typeof newHp !== 'number') return;
            const oldHp = options.icvOldHp;

            const token = actor.getActiveTokens()?.[0];
            if (!token) return;
            const config = this.getTokenConfig(token.id);
            if (!config?.enabled) return;

            if (newHp <= 0 && (typeof oldHp !== 'number' || oldHp > 0)) {
                if (!config.lines.death) return;
                const key = `${game.combat.id}:${token.id}`;
                if (this.deathAnnounced.has(key)) return;
                this.deathAnnounced.add(key);
                await this.rollAndDisplayDialogue(token, config.lines.death);
                return;
            }

            if (typeof oldHp === 'number' && newHp < oldHp && newHp > 0) {
                if (!config.lines.damaged) return;
                if (!this.shouldRoll(token.id)) return;
                await this.rollAndDisplayDialogue(token, config.lines.damaged);
            }
        });

        // Combat-start barks: every configured combatant, staggered so the
        // floating text doesn't overlap.
        Hooks.on('combatStart', (combat) => {
            if (!this.#isActingGM()) return;
            if (!game.settings.get(MODULE_ID, 'combatDialogueEnabled')) return;
            this.deathAnnounced.clear();

            const speakers = [];
            for (const combatant of combat.combatants) {
                const token = combatant.token?.object ?? canvas.tokens.get(combatant.tokenId);
                if (!token) continue;
                const config = this.getTokenConfig(token.id);
                if (config?.enabled && config.lines.combatStart) {
                    speakers.push({ token, lines: config.lines.combatStart });
                }
            }
            speakers.forEach((s, i) => {
                setTimeout(() => this.rollAndDisplayDialogue(s.token, s.lines), i * 1200);
            });
        });

        Hooks.on('deleteCombat', (combat) => {
            for (const key of [...this.deathAnnounced]) {
                if (key.startsWith(`${combat.id}:`)) this.deathAnnounced.delete(key);
            }
        });
    }

    shouldRollGlobalAction() {
        const now = Date.now();
        if (now - this.lastGlobalActionTime < this.globalActionThrottleMs) return false;
        this.lastGlobalActionTime = now;
        return true;
    }

    shouldRoll(tokenId) {
        const now = Date.now();
        if (now - (this.lastRolledTime.get(tokenId) || 0) < this.spamThrottleMs) return false;
        const probability = game.settings.get(MODULE_ID, 'combatDialogueProbability');
        if (Math.random() * 100 > probability) return false;
        this.lastRolledTime.set(tokenId, now);
        return true;
    }

    /** Pick a random line from the trigger's list and show it above the token. */
    async rollAndDisplayDialogue(token, lines) {
        try {
            const text = pickRandom(lines);
            if (!text) return;

            if (game.settings.get(MODULE_ID, 'combatDialogueFloatingText')) {
                const cleanText = stripHTML(text);
                showFloatingText(token, cleanText);
                emitSocket('floatingText', { tokenId: token.id, text: cleanText });
            }
            if (game.settings.get(MODULE_ID, 'combatDialogueChatDisplay')) {
                await postTokenChatMessage(token, `<p><em>"${text}"</em></p>`);
            }
        } catch (e) {
            console.error(`${MODULE_ID} | error showing combat dialogue`, e);
        }
    }

    // -- Configuration (actor flags) -----------------------------------------

    /**
     * Save a full multi-trigger config. `lines` maps trigger key -> array of
     * strings; empty/unknown entries are dropped. The flag is rewritten (not
     * merged) so cleared triggers actually go away.
     */
    async assignLinesToToken(tokenId, lines, enabled = true) {
        const actor = canvas.tokens.get(tokenId)?.actor;
        if (!actor) {
            ui.notifications.error('Token has no actor');
            return false;
        }
        const clean = {};
        for (const [key, arr] of Object.entries(lines || {})) {
            if (!COMBAT_TRIGGERS[key]) continue;
            const list = Array.isArray(arr) ? arr.map(s => String(s).trim()).filter(Boolean) : [];
            if (list.length) clean[key] = list;
        }
        if (!Object.keys(clean).length) {
            ui.notifications.error('Add at least one line');
            return false;
        }
        await actor.unsetFlag(MODULE_ID, FLAGS.COMBAT);
        await actor.setFlag(MODULE_ID, FLAGS.COMBAT, { enabled, lines: clean });
        return true;
    }

    async removeFromToken(tokenId) {
        const actor = canvas.tokens.get(tokenId)?.actor;
        if (!actor?.getFlag(MODULE_ID, FLAGS.COMBAT)) return false;
        await actor.unsetFlag(MODULE_ID, FLAGS.COMBAT);
        return true;
    }

    async toggleForToken(tokenId) {
        const actor = canvas.tokens.get(tokenId)?.actor;
        const config = actor?.getFlag(MODULE_ID, FLAGS.COMBAT);
        if (!config) return false;
        const enabled = !(config.enabled ?? true);
        await actor.setFlag(MODULE_ID, FLAGS.COMBAT, { enabled });
        return enabled;
    }

    getTokenConfig(tokenId) {
        return this.normalizeConfig(canvas.tokens.get(tokenId)?.actor?.getFlag(MODULE_ID, FLAGS.COMBAT));
    }

    getTokensWithCombatDialogue() {
        return canvas.tokens.placeables
            .map(t => ({ token: t, config: this.normalizeConfig(t.actor?.getFlag(MODULE_ID, FLAGS.COMBAT)) }))
            .filter(e => e.config)
            .map(e => ({
                tokenId: e.token.id,
                tokenName: e.token.name,
                enabled: e.config.enabled,
                lines: e.config.lines
            }));
    }

    /** Hub "Test" button: bark one trigger regardless of combat/probability. */
    async testToken(tokenId, trigger = 'action') {
        const token = canvas.tokens.get(tokenId);
        const config = this.getTokenConfig(tokenId);
        const lines = config?.lines?.[trigger];
        if (!token || !lines) {
            ui.notifications.warn(`No "${COMBAT_TRIGGERS[trigger]?.label ?? trigger}" lines configured for this token`);
            return;
        }
        await this.rollAndDisplayDialogue(token, lines);
    }
}

export const combatDialogue = new CombatDialogueSystem();
