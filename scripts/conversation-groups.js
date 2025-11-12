console.log("LOADING: Conversation Groups system starting");

const MODULE_ID = 'intrinsics-conversations';

/**
 * Conversation Groups System
 * Manages multi-NPC conversations that trigger when players come nearby
 */
class ConversationGroupsSystem {
    constructor(dialogueAuraSystem) {
        this.dialogueAuraSystem = dialogueAuraSystem;
        this.conversationGroups = new Map(); // Map of groupId -> conversation config
        this.activeConversations = new Map(); // Map of groupId -> active conversation state
        this.conversationHistory = new Map(); // Track which line we're on for scripted conversations
    }

    /**
     * Create a new conversation group
     */
    async createConversationGroup(groupConfig) {
        const groupId = `group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Validate config
        if (!groupConfig.name) {
            ui.notifications.error("Conversation group must have a name");
            return false;
        }

        if (!groupConfig.npcs || groupConfig.npcs.length < 1) {
            ui.notifications.error("Conversation group must have at least 1 NPC");
            return false;
        }

        if (!groupConfig.mode || !['scripted', 'scripted-custom', 'random', 'turn-taking'].includes(groupConfig.mode)) {
            ui.notifications.error("Mode must be 'scripted', 'scripted-custom', 'random', or 'turn-taking'");
            return false;
        }

        // For scripted mode (table-based), validate shared table
        if (groupConfig.mode === 'scripted') {
            if (!groupConfig.sharedTableId) {
                ui.notifications.error("Scripted conversation must have a dialogue table");
                return false;
            }
        }

        // For scripted-custom mode, validate dialogue
        if (groupConfig.mode === 'scripted-custom') {
            if (!groupConfig.dialogue || groupConfig.dialogue.length === 0) {
                ui.notifications.error("Scripted conversation must have at least one line");
                return false;
            }
        }

        // For random mode, validate tables
        if (groupConfig.mode === 'random') {
            if (!groupConfig.tablesByNPC || Object.keys(groupConfig.tablesByNPC).length < 2) {
                ui.notifications.error("Random conversation must have tables assigned for all NPCs");
                return false;
            }
        }

        // For turn-taking mode, validate shared table
        if (groupConfig.mode === 'turn-taking') {
            if (!groupConfig.sharedTableId) {
                ui.notifications.error("Turn-taking conversation must have a shared dialogue table");
                return false;
            }
        }

        // Create the conversation group
        // Note: npcs array order determines speaking sequence for scripted, scripted-custom, and turn-taking modes
        const conversation = {
            groupId,
            name: groupConfig.name,
            mode: groupConfig.mode,
            npcs: groupConfig.npcs,  // Array order is preserved and used for NPC speaking order
            dialogue: groupConfig.dialogue || [],
            tablesByNPC: groupConfig.tablesByNPC || {},
            sharedTableId: groupConfig.sharedTableId || null,
            range: groupConfig.range || 30,
            delay: groupConfig.delay || game.settings.get(MODULE_ID, 'dialogueAuraRandomInterval'),  // Per-group delay in seconds
            enabled: true,
            createdAt: Date.now()
        };

        this.conversationGroups.set(groupId, conversation);

        // Save to world settings
        await this.saveConversationGroups();

        console.log(`CONV: Created conversation group "${conversation.name}" (${groupId})`);
        ui.notifications.info(`Created conversation: ${conversation.name}`);

        return groupId;
    }

    /**
     * Delete a conversation group
     */
    async deleteConversationGroup(groupId) {
        const conversation = this.conversationGroups.get(groupId);
        if (!conversation) {
            ui.notifications.error("Conversation group not found");
            return false;
        }

        this.conversationGroups.delete(groupId);
        this.activeConversations.delete(groupId);
        this.conversationHistory.delete(groupId);

        await this.saveConversationGroups();

        console.log(`CONV: Deleted conversation group "${conversation.name}"`);
        ui.notifications.info(`Deleted conversation: ${conversation.name}`);

        return true;
    }

    /**
     * Get all conversation groups
     */
    getConversationGroups() {
        return Array.from(this.conversationGroups.values());
    }

    /**
     * Get a specific conversation group
     */
    getConversationGroup(groupId) {
        return this.conversationGroups.get(groupId);
    }

    /**
     * Check if an NPC is part of any conversation group
     */
    getNPCConversations(tokenId) {
        const conversations = [];
        for (let [groupId, conv] of this.conversationGroups.entries()) {
            if (conv.npcs.includes(tokenId)) {
                conversations.push(conv);
            }
        }
        return conversations;
    }

    /**
     * Check if any NPC in a group is within range of a player
     */
    isConversationInRange(groupId) {
        const conversation = this.conversationGroups.get(groupId);
        if (!conversation || !conversation.enabled) return false;

        // Get all player tokens
        const playerTokens = canvas.tokens.placeables.filter(token => {
            return token.actor && token.actor.hasPlayerOwner;
        });

        if (playerTokens.length === 0) return false;

        // Check if any NPC in the group is within range of any player
        for (let npcId of conversation.npcs) {
            const npcToken = canvas.tokens.get(npcId);
            if (!npcToken) continue;

            for (let playerToken of playerTokens) {
                if (this.dialogueAuraSystem.isTokenInRange(npcToken, playerToken, conversation.range)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Trigger a conversation group
     */
    async triggerConversation(groupId) {
        const conversation = this.conversationGroups.get(groupId);
        if (!conversation || !conversation.enabled) return;

        console.log(`CONV: Triggering conversation "${conversation.name}"`);

        if (conversation.mode === 'scripted') {
            await this.triggerScriptedTableConversation(groupId, conversation);
        } else if (conversation.mode === 'scripted-custom') {
            await this.triggerScriptedCustomConversation(groupId, conversation);
        } else if (conversation.mode === 'random') {
            await this.triggerRandomConversation(groupId, conversation);
        } else if (conversation.mode === 'turn-taking') {
            await this.triggerTurnTakingConversation(groupId, conversation);
        }
    }

    /**
     * Trigger a scripted conversation with a roll table
     * Hard-selects lines by index instead of rolling
     * Cycles through both NPCs and table entries
     */
    async triggerScriptedTableConversation(groupId, conversation) {
        // Get the shared table
        const table = game.tables.get(conversation.sharedTableId);
        if (!table) {
            console.error(`CONV: Shared table not found: ${conversation.sharedTableId}`);
            return;
        }

        // Get current line in the conversation (cycles through all table entries across all NPCs)
        let currentLine = this.conversationHistory.get(groupId) || 0;

        // Convert results collection to array
        const resultsArray = Array.from(table.results.values());
        if (resultsArray.length === 0) {
            console.error(`CONV: Table has no entries`);
            return;
        }

        // Determine which NPC and which table entry
        // Each NPC gets a unique line from the table
        const npcIndex = currentLine % conversation.npcs.length;
        const tableIndex = currentLine % resultsArray.length;

        const npcId = conversation.npcs[npcIndex];
        if (!npcId) {
            console.error(`CONV: NPC not found at index ${npcIndex}`);
            return;
        }

        const npcToken = canvas.tokens.get(npcId);
        if (!npcToken) {
            console.error(`CONV: Token not found: ${npcId}`);
            // Move to next line anyway
            this.conversationHistory.set(groupId, currentLine + 1);
            return;
        }

        // Get the table entry
        const tableEntry = resultsArray[tableIndex];

        if (tableEntry) {
            const dialogue = tableEntry.text;
            console.log(`CONV: "${npcToken.name}" says (scripted table): "${dialogue}"`);
            await this.dialogueAuraSystem.displayDialogue(npcToken, dialogue);
        }

        // Move to next line (continues indefinitely through both NPCs and table entries)
        this.conversationHistory.set(groupId, currentLine + 1);
    }

    /**
     * Trigger a scripted conversation with custom text
     */
    async triggerScriptedCustomConversation(groupId, conversation) {
        // Get current line
        let currentLine = this.conversationHistory.get(groupId) || 0;

        // Get the dialogue line
        const dialogueLine = conversation.dialogue[currentLine];
        if (!dialogueLine) {
            console.log(`CONV: Conversation "${conversation.name}" completed, resetting`);
            this.conversationHistory.set(groupId, 0);
            return;
        }

        // Get the speaker token
        const speakerToken = canvas.tokens.get(dialogueLine.speaker);
        if (!speakerToken) {
            console.error(`CONV: Speaker token not found: ${dialogueLine.speaker}`);
            return;
        }

        console.log(`CONV: "${speakerToken.name}" says: "${dialogueLine.text}"`);

        // Display dialogue
        await this.dialogueAuraSystem.displayDialogue(speakerToken, dialogueLine.text);

        // Move to next line
        currentLine = (currentLine + 1) % conversation.dialogue.length;
        this.conversationHistory.set(groupId, currentLine);
    }

    /**
     * Trigger a random conversation
     */
    async triggerRandomConversation(groupId, conversation) {
        // Pick a random NPC from the group
        const randomNpcId = conversation.npcs[Math.floor(Math.random() * conversation.npcs.length)];
        const tableId = conversation.tablesByNPC[randomNpcId];

        if (!tableId) {
            console.error(`CONV: No table assigned for NPC ${randomNpcId}`);
            return;
        }

        const table = game.tables.get(tableId);
        if (!table) {
            console.error(`CONV: Table not found: ${tableId}`);
            return;
        }

        const npcToken = canvas.tokens.get(randomNpcId);
        if (!npcToken) {
            console.error(`CONV: Token not found: ${randomNpcId}`);
            return;
        }

        // Roll the table
        const result = await table.roll();
        if (result.results && result.results.length > 0) {
            const dialogue = result.results[0].text;
            console.log(`CONV: "${npcToken.name}" says: "${dialogue}"`);
            await this.dialogueAuraSystem.displayDialogue(npcToken, dialogue);
        }
    }

    /**
     * Trigger a turn-taking conversation
     * NPCs take turns rolling from a shared table
     */
    async triggerTurnTakingConversation(groupId, conversation) {
        // Get the shared table
        const table = game.tables.get(conversation.sharedTableId);
        if (!table) {
            console.error(`CONV: Shared table not found: ${conversation.sharedTableId}`);
            return;
        }

        // Determine whose turn it is
        let currentSpeaker = this.conversationHistory.get(groupId) || 0;

        // Get the NPC for this turn
        const npcId = conversation.npcs[currentSpeaker];
        if (!npcId) {
            // Reset to first NPC
            currentSpeaker = 0;
            this.conversationHistory.set(groupId, 0);
            return;
        }

        const npcToken = canvas.tokens.get(npcId);
        if (!npcToken) {
            console.error(`CONV: Token not found: ${npcId}`);
            // Move to next speaker anyway
            currentSpeaker = (currentSpeaker + 1) % conversation.npcs.length;
            this.conversationHistory.set(groupId, currentSpeaker);
            return;
        }

        // Roll the shared table
        const result = await table.roll();
        if (result.results && result.results.length > 0) {
            const dialogue = result.results[0].text;
            console.log(`CONV: "${npcToken.name}" says (turn-taking): "${dialogue}"`);
            await this.dialogueAuraSystem.displayDialogue(npcToken, dialogue);
        }

        // Move to next speaker
        currentSpeaker = (currentSpeaker + 1) % conversation.npcs.length;
        this.conversationHistory.set(groupId, currentSpeaker);
    }

    /**
     * Monitor and trigger conversations
     */
    checkConversations() {
        if (!game.user.isGM) return;

        for (let [groupId, conversation] of this.conversationGroups.entries()) {
            if (!conversation.enabled) continue;

            // Check if conversation is in range
            if (this.isConversationInRange(groupId)) {
                // Check if enough time has passed since last trigger
                const active = this.activeConversations.get(groupId) || { lastTriggered: 0 };
                const timeSinceLastTrigger = (Date.now() - active.lastTriggered) / 1000;
                // Use per-group delay, fall back to global setting if not defined
                const interval = conversation.delay || game.settings.get(MODULE_ID, 'dialogueAuraRandomInterval');

                if (timeSinceLastTrigger >= interval) {
                    this.triggerConversation(groupId);
                    active.lastTriggered = Date.now();
                    this.activeConversations.set(groupId, active);
                }
            }
        }
    }

    /**
     * Save conversation groups to world settings
     */
    async saveConversationGroups() {
        const data = Array.from(this.conversationGroups.values());
        await game.settings.set(MODULE_ID, 'conversationGroups', JSON.stringify(data));
        console.log(`CONV: Saved ${data.length} conversation group(s)`);
    }

    /**
     * Load conversation groups from world settings
     */
    async loadConversationGroups() {
        try {
            const data = game.settings.get(MODULE_ID, 'conversationGroups');
            const groups = JSON.parse(data || '[]');

            this.conversationGroups.clear();
            for (let group of groups) {
                this.conversationGroups.set(group.groupId, group);
            }

            console.log(`CONV: Loaded ${groups.length} conversation group(s)`);
        } catch (error) {
            console.error("CONV: Error loading conversation groups:", error);
        }
    }

    /**
     * Get conversation statistics
     */
    getConversationStats() {
        const total = this.conversationGroups.size;
        const enabled = Array.from(this.conversationGroups.values()).filter(c => c.enabled).length;
        const scriptedCount = Array.from(this.conversationGroups.values()).filter(c => c.mode === 'scripted' || c.mode === 'scripted-custom').length;
        const randomCount = Array.from(this.conversationGroups.values()).filter(c => c.mode === 'random').length;
        const turnTakingCount = Array.from(this.conversationGroups.values()).filter(c => c.mode === 'turn-taking').length;

        return {
            total,
            enabled,
            disabled: total - enabled,
            scripted: scriptedCount,
            random: randomCount,
            turnTaking: turnTakingCount
        };
    }
}

// Export for use in main dialogue-aura.js
window.ConversationGroupsSystem = ConversationGroupsSystem;

console.log("LOADED: Conversation Groups system ready");
