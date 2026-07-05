import { MODULE_ID } from './constants.js';
import { isTokenInRange, getActivePlayerTokens } from './utils.js';
import { ambientDialogue } from './ambient-dialogue.js';

export const GROUP_MODES = {
    'random': 'Random — a random NPC rolls on their own table',
    'turn-taking': 'Turn-taking — NPCs take turns rolling on a shared table',
    'scripted': 'Scripted (table) — NPCs alternate through a shared table in order',
    'scripted-custom': 'Scripted (custom) — pre-written lines with chosen speakers'
};

/**
 * Multi-NPC ambient conversations. Groups are stored in a hidden world setting
 * and progressed by the GM client (driven from the ambient monitoring loop).
 */
class ConversationGroupsSystem {
    constructor() {
        this.conversationGroups = new Map(); // groupId -> config
        this.activeConversations = new Map(); // groupId -> { lastTriggered }
        this.conversationHistory = new Map(); // groupId -> current line / speaker index
    }

    registerSettings() {
        game.settings.register(MODULE_ID, 'conversationGroups', {
            scope: 'world', config: false, type: String, default: '[]'
        });
    }

    validateConfig(config) {
        if (!config.name?.trim()) return 'Conversation group must have a name';
        if (!config.npcs || config.npcs.length < 1) return 'Conversation group must have at least 1 NPC';
        if (!Object.keys(GROUP_MODES).includes(config.mode)) return 'Invalid conversation mode';
        if ((config.mode === 'scripted' || config.mode === 'turn-taking') && !config.sharedTableId) {
            return 'This mode needs a shared dialogue table';
        }
        if (config.mode === 'scripted-custom' && !(config.dialogue?.length > 0)) {
            return 'Scripted conversation must have at least one line';
        }
        if (config.mode === 'random') {
            const missing = config.npcs.filter(id => !config.tablesByNPC?.[id]);
            if (missing.length) return 'Random mode needs a table assigned to every NPC';
        }
        return null;
    }

    /** Build the normalised stored record from a raw config. */
    #buildRecord(config, existing = null) {
        return {
            groupId: existing?.groupId ?? `group-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
            name: config.name.trim(),
            mode: config.mode,
            npcs: [...config.npcs], // array order = speaking order
            dialogue: config.dialogue || [],
            tablesByNPC: config.tablesByNPC || {},
            sharedTableId: config.sharedTableId || null,
            range: config.range || 30,
            delay: config.delay || game.settings.get(MODULE_ID, 'dialogueAuraRandomInterval'),
            enabled: existing?.enabled ?? true,
            createdAt: existing?.createdAt ?? Date.now()
        };
    }

    async createConversationGroup(config) {
        const error = this.validateConfig(config);
        if (error) {
            ui.notifications.error(error);
            return false;
        }
        const record = this.#buildRecord(config);
        this.conversationGroups.set(record.groupId, record);
        await this.saveConversationGroups();
        return record.groupId;
    }

    async updateConversationGroup(groupId, config) {
        const existing = this.conversationGroups.get(groupId);
        if (!existing) {
            ui.notifications.error('Conversation group not found');
            return false;
        }
        const error = this.validateConfig(config);
        if (error) {
            ui.notifications.error(error);
            return false;
        }
        const record = this.#buildRecord(config, existing);
        this.conversationGroups.set(groupId, record);
        this.conversationHistory.delete(groupId); // restart with the new config
        await this.saveConversationGroups();
        return groupId;
    }

    async deleteConversationGroup(groupId) {
        if (!this.conversationGroups.delete(groupId)) return false;
        this.activeConversations.delete(groupId);
        this.conversationHistory.delete(groupId);
        await this.saveConversationGroups();
        return true;
    }

    getConversationGroups() {
        return Array.from(this.conversationGroups.values());
    }

    getConversationGroup(groupId) {
        return this.conversationGroups.get(groupId);
    }

    /** All groups containing the given token. */
    getTokenConversations(tokenId) {
        return this.getConversationGroups().filter(c => c.npcs.includes(tokenId));
    }

    async reorderNPCs(groupId, npcIds) {
        const conversation = this.conversationGroups.get(groupId);
        if (!conversation) return false;
        if (npcIds.length !== conversation.npcs.length || !npcIds.every(id => conversation.npcs.includes(id))) {
            ui.notifications.error('Invalid NPC list for reordering');
            return false;
        }
        conversation.npcs = [...npcIds];
        this.conversationHistory.delete(groupId);
        await this.saveConversationGroups();
        return true;
    }

    async toggleConversation(groupId, enabled) {
        const conversation = this.conversationGroups.get(groupId);
        if (!conversation) return false;
        conversation.enabled = enabled;
        await this.saveConversationGroups();
        return true;
    }

    async resetConversation(groupId) {
        if (!this.conversationGroups.has(groupId)) return false;
        this.conversationHistory.delete(groupId);
        this.activeConversations.delete(groupId);
        return true;
    }

    /**
     * Play a whole conversation from the start, line by line with the group's
     * delay. Bypasses range and cooldown checks.
     */
    async manuallyTriggerConversation(groupId) {
        const conversation = this.conversationGroups.get(groupId);
        if (!conversation) return false;
        if (!conversation.enabled) {
            ui.notifications.warn(`Conversation "${conversation.name}" is paused — enable it first.`);
            return false;
        }

        this.conversationHistory.delete(groupId);
        this.activeConversations.delete(groupId);

        let totalLines = 0;
        if (conversation.mode === 'scripted') {
            totalLines = game.tables.get(conversation.sharedTableId)?.results.size ?? 0;
        } else if (conversation.mode === 'scripted-custom') {
            totalLines = conversation.dialogue?.length || 0;
        } else {
            totalLines = conversation.npcs.length; // one line per NPC
        }
        if (totalLines === 0) {
            ui.notifications.warn('No lines to play in this conversation');
            return false;
        }

        for (let i = 0; i < totalLines; i++) {
            await this.triggerConversation(groupId);
            if (i < totalLines - 1) {
                await new Promise(resolve => setTimeout(resolve, conversation.delay * 1000));
            }
        }
        return true;
    }

    isConversationInRange(conversation, playerTokens) {
        for (const npcId of conversation.npcs) {
            const npcToken = canvas.tokens.get(npcId);
            if (!npcToken) continue;
            if (playerTokens.some(pt => isTokenInRange(npcToken, pt, conversation.range))) return true;
        }
        return false;
    }

    /** Called from the ambient monitoring loop, GM only. */
    checkConversations() {
        if (!game.user.isGM || this.conversationGroups.size === 0) return;
        const playerTokens = getActivePlayerTokens();
        if (playerTokens.length === 0) return;

        for (const [groupId, conversation] of this.conversationGroups.entries()) {
            if (!conversation.enabled) continue;
            if (!this.isConversationInRange(conversation, playerTokens)) continue;

            const active = this.activeConversations.get(groupId) || { lastTriggered: 0 };
            const interval = conversation.delay || game.settings.get(MODULE_ID, 'dialogueAuraRandomInterval');
            if ((Date.now() - active.lastTriggered) / 1000 >= interval) {
                this.triggerConversation(groupId);
                active.lastTriggered = Date.now();
                this.activeConversations.set(groupId, active);
            }
        }
    }

    async triggerConversation(groupId) {
        const conversation = this.conversationGroups.get(groupId);
        if (!conversation || !conversation.enabled) return;
        switch (conversation.mode) {
            case 'scripted': return this.#triggerScriptedTable(groupId, conversation);
            case 'scripted-custom': return this.#triggerScriptedCustom(groupId, conversation);
            case 'random': return this.#triggerRandom(conversation);
            case 'turn-taking': return this.#triggerTurnTaking(groupId, conversation);
        }
    }

    /** NPCs alternate speaking consecutive lines from the table, in order. */
    async #triggerScriptedTable(groupId, conversation) {
        const table = game.tables.get(conversation.sharedTableId);
        if (!table) return;
        const results = Array.from(table.results.values());
        if (!results.length) return;

        const currentLine = this.conversationHistory.get(groupId) || 0;
        if (currentLine >= results.length) {
            // Finished the script — pause the group so it doesn't loop forever.
            conversation.enabled = false;
            await this.saveConversationGroups();
            return;
        }

        const npcId = conversation.npcs[currentLine % conversation.npcs.length];
        const npcToken = canvas.tokens.get(npcId);
        this.conversationHistory.set(groupId, currentLine + 1);
        if (!npcToken) return;

        const text = results[currentLine]?.text;
        if (text) await ambientDialogue.displayDialogue(npcToken, text);
    }

    async #triggerScriptedCustom(groupId, conversation) {
        const currentLine = this.conversationHistory.get(groupId) || 0;
        const line = conversation.dialogue[currentLine];
        if (!line) {
            this.conversationHistory.set(groupId, 0);
            return;
        }
        this.conversationHistory.set(groupId, (currentLine + 1) % conversation.dialogue.length);

        const speakerToken = canvas.tokens.get(line.speaker);
        if (!speakerToken) return;
        await ambientDialogue.displayDialogue(speakerToken, line.text);
    }

    async #triggerRandom(conversation) {
        const npcId = conversation.npcs[Math.floor(Math.random() * conversation.npcs.length)];
        const table = game.tables.get(conversation.tablesByNPC[npcId]);
        const npcToken = canvas.tokens.get(npcId);
        if (!table || !npcToken) return;

        const result = await table.roll();
        const text = result.results?.[0]?.text;
        if (text) await ambientDialogue.displayDialogue(npcToken, text);
    }

    async #triggerTurnTaking(groupId, conversation) {
        const table = game.tables.get(conversation.sharedTableId);
        if (!table) return;

        let currentSpeaker = this.conversationHistory.get(groupId) || 0;
        if (currentSpeaker >= conversation.npcs.length) currentSpeaker = 0;
        this.conversationHistory.set(groupId, (currentSpeaker + 1) % conversation.npcs.length);

        const npcToken = canvas.tokens.get(conversation.npcs[currentSpeaker]);
        if (!npcToken) return;

        const result = await table.roll();
        const text = result.results?.[0]?.text;
        if (text) await ambientDialogue.displayDialogue(npcToken, text);
    }

    async saveConversationGroups() {
        const data = Array.from(this.conversationGroups.values());
        await game.settings.set(MODULE_ID, 'conversationGroups', JSON.stringify(data));
    }

    loadConversationGroups() {
        try {
            const groups = JSON.parse(game.settings.get(MODULE_ID, 'conversationGroups') || '[]');
            this.conversationGroups.clear();
            for (const group of groups) this.conversationGroups.set(group.groupId, group);
        } catch (e) {
            console.error(`${MODULE_ID} | error loading conversation groups`, e);
        }
    }

    getConversationStats() {
        const groups = this.getConversationGroups();
        return {
            total: groups.length,
            enabled: groups.filter(c => c.enabled).length,
            disabled: groups.filter(c => !c.enabled).length,
            scripted: groups.filter(c => c.mode.startsWith('scripted')).length,
            random: groups.filter(c => c.mode === 'random').length,
            turnTaking: groups.filter(c => c.mode === 'turn-taking').length
        };
    }
}

export const conversationGroups = new ConversationGroupsSystem();
