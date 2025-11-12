console.log("LOADING: Dialogue Aura system starting");

const MODULE_ID = 'intrinsics-conversations';

/**
 * Dialogue Aura System
 * Manages NPCs with assigned dialogue tables that trigger when players come within range
 */
class DialogueAuraSystem {
    constructor() {
        this.activeAuras = new Map(); // Map of tokenId -> aura config
        this.monitoringActive = false;
        this.checkInterval = null;
        this.displayedTexts = new Map(); // Track displayed floating text
    }

    /**
     * Initialize the dialogue aura system
     */
    init() {
        console.log("AURA: Initializing dialogue aura system");

        // Register settings
        game.settings.register(MODULE_ID, 'dialogueAuraEnabled', {
            name: 'Enable Dialogue Auras',
            hint: 'Enable the dialogue aura feature for NPCs',
            scope: 'world',
            config: true,
            type: Boolean,
            default: true
        });

        game.settings.register(MODULE_ID, 'dialogueAuraRange', {
            name: 'Dialogue Aura Range (feet)',
            hint: 'Default detection range for dialogue auras in feet',
            scope: 'world',
            config: true,
            type: Number,
            default: 30,
            range: { min: 5, max: 120, step: 5 }
        });

        game.settings.register(MODULE_ID, 'dialogueAuraRandomInterval', {
            name: 'Dialogue Trigger Interval (seconds)',
            hint: 'How often to randomly trigger dialogue when in range',
            scope: 'world',
            config: true,
            type: Number,
            default: 10,
            range: { min: 5, max: 60, step: 5 }
        });

        game.settings.register(MODULE_ID, 'dialogueAuraFloatingText', {
            name: 'Show Floating Text',
            hint: 'Display dialogue as floating text above NPCs',
            scope: 'world',
            config: true,
            type: Boolean,
            default: true
        });

        game.settings.register(MODULE_ID, 'dialogueAuraChatMessage', {
            name: 'Show in Chat',
            hint: 'Also display dialogue in the chat log',
            scope: 'world',
            config: true,
            type: Boolean,
            default: true
        });

        // Register conversation groups setting
        game.settings.register(MODULE_ID, 'conversationGroups', {
            scope: 'world',
            config: false,
            type: String,
            default: '[]'
        });

        // Register floating text data setting for socket fallback
        game.settings.register(MODULE_ID, 'floatingTextData', {
            scope: 'world',
            config: false,
            type: String,
            default: '{}',
            onChange: (value) => {
                console.log("AURA: floatingTextData setting changed, isGM:", game.user.isGM, "systemExists:", !!dialogueAuraSystem);
                // Only non-GMs should listen to setting changes for floating text
                if (!game.user.isGM && dialogueAuraSystem) {
                    try {
                        const parsedData = JSON.parse(value);
                        console.log("AURA: Parsed settings data:", {
                            action: parsedData.action,
                            hasData: !!parsedData.data,
                            hasTimestampInData: !!parsedData.data?.timestamp
                        });
                        if (parsedData.action === 'displayFloatingText' && parsedData.data && parsedData.data.tokenId && parsedData.data.text) {
                            console.log("AURA: Player received floating text via settings fallback for token:", parsedData.data.tokenName);
                            dialogueAuraSystem.handleFloatingTextFromSocket(parsedData.data);
                        } else {
                            console.log("AURA: Settings data validation failed - missing required fields", {
                                action: parsedData.action,
                                hasData: !!parsedData.data,
                                hasTokenId: parsedData.data ? !!parsedData.data.tokenId : false,
                                hasText: parsedData.data ? !!parsedData.data.text : false,
                                hasTimestamp: parsedData.data ? !!parsedData.data.timestamp : false
                            });
                        }
                    } catch (error) {
                        console.error("AURA: Error parsing floating text data from settings:", error, "value:", value);
                    }
                } else if (game.user.isGM) {
                    console.log("AURA: Ignoring setting change on GM client");
                }
            }
        });

        // Register global pause setting for conversations and dialogue auras
        game.settings.register(MODULE_ID, 'globalPause', {
            name: 'Pause All Conversations',
            hint: 'Pause all dialogue auras and conversation groups from triggering',
            scope: 'world',
            config: true,
            type: Boolean,
            default: false
        });
    }

    /**
     * Setup the system (called in ready hook)
     */
    setup() {
        console.log("AURA: Setting up dialogue aura system");
        this.startMonitoring();
    }

    /**
     * Assign a dialogue table to a token
     */
    async assignTableToToken(tokenId, tableId, range = null) {
        const token = canvas.tokens.get(tokenId);
        if (!token) {
            console.error("AURA: Token not found:", tokenId);
            return false;
        }

        const table = game.tables.get(tableId);
        if (!table) {
            console.error("AURA: Roll table not found:", tableId);
            return false;
        }

        const defaultRange = game.settings.get(MODULE_ID, 'dialogueAuraRange');
        const auraRange = range || defaultRange;

        // Store in token flags
        const flags = token.document.getFlag(MODULE_ID, 'dialogueAura') || {};
        flags.tableId = tableId;
        flags.tableName = table.name;
        flags.range = auraRange;
        flags.enabled = true;
        flags.lastTriggered = 0;

        await token.document.setFlag(MODULE_ID, 'dialogueAura', flags);

        // Update internal map
        this.activeAuras.set(tokenId, {
            tokenId: tokenId,
            tableId: tableId,
            tableName: table.name,
            range: auraRange,
            enabled: true,
            lastTriggered: 0
        });

        console.log(`AURA: Assigned table "${table.name}" to token "${token.name}"`);
        ui.notifications.info(`Assigned dialogue table "${table.name}" to ${token.name}`);

        return true;
    }

    /**
     * Remove dialogue table from a token
     */
    async removeTableFromToken(tokenId) {
        const token = canvas.tokens.get(tokenId);
        if (!token) return false;

        await token.document.unsetFlag(MODULE_ID, 'dialogueAura');
        this.activeAuras.delete(tokenId);

        console.log(`AURA: Removed dialogue aura from token "${token.name}"`);
        ui.notifications.info(`Removed dialogue aura from ${token.name}`);

        return true;
    }

    /**
     * Get all active auras from scene tokens
     */
    loadAurasFromScene() {
        this.activeAuras.clear();

        for (let token of canvas.tokens.placeables) {
            const auraData = token.document.getFlag(MODULE_ID, 'dialogueAura');
            if (auraData && auraData.enabled) {
                this.activeAuras.set(token.id, {
                    tokenId: token.id,
                    tableId: auraData.tableId,
                    tableName: auraData.tableName,
                    range: auraData.range,
                    enabled: auraData.enabled,
                    lastTriggered: auraData.lastTriggered || 0
                });
            }
        }

        console.log(`AURA: Loaded ${this.activeAuras.size} active auras from scene`);
    }

    /**
     * Start monitoring for players in aura range
     */
    startMonitoring() {
        if (this.monitoringActive) return;

        console.log("AURA: Starting aura monitoring");
        this.monitoringActive = true;
        this.loadAurasFromScene();

        // Check every second for players in range
        this.checkInterval = setInterval(() => {
            this.checkAllAuras();
        }, 1000);
    }

    /**
     * Stop monitoring for auras
     */
    stopMonitoring() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.monitoringActive = false;
        console.log("AURA: Stopped aura monitoring");
    }

    /**
     * Check all active auras for nearby players
     */
    checkAllAuras() {
        if (!game.user.isGM) return;

        // Check if all conversations are paused globally
        const isPaused = game.settings.get(MODULE_ID, 'globalPause');
        if (isPaused) return;

        const enabledAuras = game.settings.get(MODULE_ID, 'dialogueAuraEnabled');
        if (enabledAuras && this.activeAuras.size > 0) {
            for (let [tokenId, auraConfig] of this.activeAuras.entries()) {
                this.checkAura(tokenId, auraConfig);
            }
        }

        // Also check conversations if the system is initialized
        if (window.conversationGroupsSystem) {
            window.conversationGroupsSystem.checkConversations();
        }
    }

    /**
     * Check if any player tokens are in range of this aura
     */
    checkAura(tokenId, auraConfig) {
        const npcToken = canvas.tokens.get(tokenId);
        if (!npcToken) {
            this.activeAuras.delete(tokenId);
            return;
        }

        // Get all owned player tokens (controlled by players)
        const playerTokens = canvas.tokens.placeables.filter(token => {
            return token.actor && token.actor.hasPlayerOwner;
        });

        if (playerTokens.length === 0) return;

        // Check each player token for range
        for (let playerToken of playerTokens) {
            if (this.isTokenInRange(npcToken, playerToken, auraConfig.range)) {
                // Debug logging for trigger checks
                const now = Date.now();
                const timeSinceLastTrigger = (now - auraConfig.lastTriggered) / 1000;
                const interval = game.settings.get(MODULE_ID, 'dialogueAuraRandomInterval');

                console.log(`AURA: Player in range of "${npcToken.name}": timeSince=${timeSinceLastTrigger.toFixed(1)}s, interval=${interval}s, canTrigger=${timeSinceLastTrigger >= interval}`);

                this.triggerDialogue(auraConfig, npcToken);
            }
        }
    }

    /**
     * Check if two tokens are within range of each other
     */
    isTokenInRange(token1, token2, rangeInFeet) {
        try {
            const gridDistance = canvas.scene.grid.distance || 5;
            const allowedGridSpaces = rangeInFeet / gridDistance;

            const distance = canvas.grid.measureDistance(
                { x: token1.x, y: token1.y },
                { x: token2.x, y: token2.y },
                { gridSpaces: true }
            );

            return distance <= allowedGridSpaces;
        } catch (error) {
            console.error("AURA: Error measuring distance:", error);
            return false;
        }
    }

    /**
     * Trigger dialogue from a roll table
     */
    async triggerDialogue(auraConfig, npcToken) {
        const now = Date.now();
        const timeSinceLastTrigger = (now - auraConfig.lastTriggered) / 1000;
        const interval = game.settings.get(MODULE_ID, 'dialogueAuraRandomInterval');

        // Check if enough time has passed since last trigger
        if (timeSinceLastTrigger < interval) {
            return;
        }

        const table = game.tables.get(auraConfig.tableId);
        if (!table) {
            console.error("AURA: Table no longer exists:", auraConfig.tableId);
            this.activeAuras.delete(auraConfig.tokenId);
            return;
        }

        try {
            console.log(`AURA: Triggering dialogue for "${npcToken.name}" from table "${table.name}"`);

            // Update last triggered time IMMEDIATELY to prevent rapid re-triggering
            auraConfig.lastTriggered = now;

            // Roll the table
            const result = await table.roll();

            if (result.results && result.results.length > 0) {
                const selectedResult = result.results[0];
                const dialogue = selectedResult.text;

                // Display dialogue
                await this.displayDialogue(npcToken, dialogue);
            }

            // Persist the timestamp update to token flags
            const flags = npcToken.document.getFlag(MODULE_ID, 'dialogueAura') || {};
            flags.lastTriggered = now;
            await npcToken.document.setFlag(MODULE_ID, 'dialogueAura', flags);
        } catch (error) {
            console.error("AURA: Error triggering dialogue:", error);
        }
    }

    /**
     * Display dialogue above token and/or in chat
     */
    async displayDialogue(token, text) {
        const showFloating = game.settings.get(MODULE_ID, 'dialogueAuraFloatingText');
        const showChat = game.settings.get(MODULE_ID, 'dialogueAuraChatMessage');

        if (showFloating) {
            this.showFloatingText(token, text);
            // Broadcast floating text to all players
            this.broadcastFloatingText(token, text);
        }

        if (showChat) {
            await this.showChatMessage(token, text);
        }
    }

    /**
     * Display floating text above token
     */
    showFloatingText(token, text) {
        try {
            console.log(`AURA: showFloatingText called for "${token.name}" with text "${text}"`);

            // Create a container for text + background box
            const container = new PIXI.Container();
            container.zIndex = 200;

            // Create background rectangle
            const background = new PIXI.Sprite(PIXI.Texture.WHITE);
            background.tint = 0x1a1a1a;
            background.alpha = 0.85;

            // Create the text
            const floatingText = new PIXI.Text(text, {
                fontFamily: 'Arial, sans-serif',
                fontSize: 20,
                fill: 0xFFFFFF,
                stroke: 0x000000,
                strokeThickness: 3,
                wordWrap: true,
                wordWrapWidth: 280,
                align: 'center',
                fontWeight: 'bold'
            });

            floatingText.anchor.set(0.5, 0.5);
            floatingText.position.set(0, 0);

            // Size background to text with padding
            const padding = 12;
            background.width = floatingText.width + (padding * 2);
            background.height = floatingText.height + (padding * 2);
            background.anchor.set(0.5, 0.5);
            background.position.set(0, 0);

            // Add text and background to container
            container.addChild(background);
            container.addChild(floatingText);

            // Position above the token
            const startY = token.y - 80;
            container.position.set(token.center.x, startY);

            // Add to the correct layer - in Foundry v13, use the drawings layer
            console.log("AURA: Attempting to add text to appropriate layer");
            let addedSuccessfully = false;
            if (canvas.drawings) {
                console.log("AURA: Adding to canvas.drawings");
                canvas.drawings.addChild(container);
                addedSuccessfully = true;
            } else if (canvas.foreground) {
                console.log("AURA: Adding to canvas.foreground");
                canvas.foreground.addChild(container);
                addedSuccessfully = true;
            } else if (canvas.stage) {
                console.log("AURA: Adding to canvas.stage");
                canvas.stage.addChild(container);
                addedSuccessfully = true;
            }

            if (!addedSuccessfully) {
                console.error("AURA: Could not find suitable layer for floating text");
                return;
            }

            // Store reference
            const textId = `float-${token.id}-${Date.now()}`;
            this.displayedTexts.set(textId, container);

            // Animate upward and fade out using simple setTimeout
            const duration = 5000;
            const startTime = Date.now();
            const startAlpha = container.alpha;

            const animateFrame = () => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);

                // Just fade out (no upward movement)
                container.alpha = startAlpha * (1 - progress);

                if (progress < 1) {
                    requestAnimationFrame(animateFrame);
                } else {
                    // Animation complete, cleanup
                    try {
                        if (container.parent) {
                            container.parent.removeChild(container);
                        }
                        container.destroy({ children: true });
                        this.displayedTexts.delete(textId);
                        console.log(`AURA: Cleaned up floating text for "${token.name}"`);
                    } catch (e) {
                        console.log("AURA: Error cleaning up text:", e);
                    }
                }
            };

            requestAnimationFrame(animateFrame);

            console.log(`AURA: Displayed floating text for "${token.name}"`);
        } catch (error) {
            console.error("AURA: Error displaying floating text:", error);
        }
    }

    /**
     * Broadcast floating text to all connected players
     */
    broadcastFloatingText(token, text) {
        try {
            console.log(`AURA: Broadcasting floating text for "${token.name}" to all players`);

            const floatingTextData = {
                action: 'displayFloatingText',
                data: {
                    tokenId: token.id,
                    tokenName: token.name,
                    text: text,
                    position: {
                        x: token.center.x,
                        y: token.y - 80
                    },
                    timestamp: Date.now()
                },
                sender: game.user.id
            };

            // Method 1: Use game.socket.emit (primary method)
            try {
                game.socket.emit(`module.${MODULE_ID}`, floatingTextData);
                console.log(`AURA: Socket emit sent for "${token.name}"`);
            } catch (error) {
                console.error("AURA: Socket emit failed:", error);
            }

            // Method 2: Use game setting as fallback to ensure delivery
            try {
                game.settings.set(MODULE_ID, 'floatingTextData', JSON.stringify(floatingTextData));
                console.log(`AURA: Settings fallback updated for "${token.name}"`);
            } catch (error) {
                console.error("AURA: Settings fallback failed:", error);
            }
        } catch (error) {
            console.error("AURA: Error broadcasting floating text:", error);
        }
    }

    /**
     * Display dialogue in chat message
     */
    async showChatMessage(token, text) {
        try {
            const speaker = ChatMessage.getSpeaker({ token: token.document });

            await ChatMessage.create({
                speaker: speaker,
                content: text,
                type: CONST.CHAT_MESSAGE_TYPES.IC,
                rolls: []
            });

            console.log(`AURA: Posted chat message for "${token.name}"`);
        } catch (error) {
            console.error("AURA: Error posting chat message:", error);
        }
    }

    /**
     * Get aura configuration for a token
     */
    getAuraConfig(tokenId) {
        return this.activeAuras.get(tokenId);
    }

    /**
     * Get all active auras
     */
    getAllAuras() {
        return Array.from(this.activeAuras.values());
    }

    /**
     * Update aura range for a token
     */
    async updateAuraRange(tokenId, newRange) {
        const token = canvas.tokens.get(tokenId);
        if (!token) return false;

        const flags = token.document.getFlag(MODULE_ID, 'dialogueAura') || {};
        flags.range = newRange;
        await token.document.setFlag(MODULE_ID, 'dialogueAura', flags);

        // Update internal map
        const aura = this.activeAuras.get(tokenId);
        if (aura) {
            aura.range = newRange;
        }

        console.log(`AURA: Updated range for "${token.name}" to ${newRange} feet`);
        ui.notifications.info(`Updated aura range to ${newRange} feet`);

        return true;
    }

    /**
     * Enable/disable aura for a token
     */
    async toggleAura(tokenId, enabled) {
        const token = canvas.tokens.get(tokenId);
        if (!token) return false;

        const flags = token.document.getFlag(MODULE_ID, 'dialogueAura') || {};
        flags.enabled = enabled;
        await token.document.setFlag(MODULE_ID, 'dialogueAura', flags);

        // Update internal map
        const aura = this.activeAuras.get(tokenId);
        if (aura) {
            aura.enabled = enabled;
        }

        const status = enabled ? 'enabled' : 'disabled';
        console.log(`AURA: ${status.charAt(0).toUpperCase() + status.slice(1)} aura for "${token.name}"`);
        ui.notifications.info(`Aura ${status} for ${token.name}`);

        return true;
    }

    /**
     * Handle floating text from socket
     */
    handleFloatingTextFromSocket(data) {
        try {
            console.log(`AURA: Received floating text from socket for token "${data.tokenName}"`);

            // Get the token from the scene
            const token = canvas.tokens.get(data.tokenId);
            if (!token) {
                console.warn(`AURA: Token not found for floating text: ${data.tokenId}`);
                return;
            }

            // Display the floating text locally
            this.showFloatingText(token, data.text);
        } catch (error) {
            console.error("AURA: Error handling floating text from socket:", error);
        }
    }
}

// Global aura system instance
let dialogueAuraSystem = null;

// Register context menu hook using document context menu
console.log("AURA: Registering context menu hooks");
Hooks.on('getDocumentContextOptions', (doc, options) => {
    console.log("AURA: getDocumentContextOptions fired for", doc.documentName);

    // Only handle token documents
    if (doc.documentName !== 'Token') return;
    if (!game.user.isGM) return;
    if (!dialogueAuraSystem) return;

    console.log("AURA: Adding dialogue aura options to token context menu");

    // Add separator
    options.push({
        name: "Dialogue Aura",
        icon: '<i class="fas fa-comments"></i>',
        condition: () => false
    });

    // Assign dialogue table
    options.push({
        name: "Assign Dialogue Table",
        icon: '<i class="fas fa-table"></i>',
        callback: () => {
            const token = canvas.tokens.get(doc.object?.id);
            if (!token) {
                ui.notifications.error("Could not find token");
                return;
            }
            showTableSelectionDialog(token);
        }
    });

    // Remove dialogue table
    options.push({
        name: "Remove Dialogue Aura",
        icon: '<i class="fas fa-trash"></i>',
        condition: () => {
            const aura = dialogueAuraSystem.getAuraConfig(doc.object?.id);
            return !!aura;
        },
        callback: () => {
            dialogueAuraSystem.removeTableFromToken(doc.object?.id);
        }
    });

    // Edit aura range
    options.push({
        name: "Edit Aura Range",
        icon: '<i class="fas fa-expand"></i>',
        condition: () => {
            const aura = dialogueAuraSystem.getAuraConfig(doc.object?.id);
            return !!aura;
        },
        callback: () => {
            const token = canvas.tokens.get(doc.object?.id);
            if (!token) return;
            showRangeEditDialog(token);
        }
    });
});

// Initialize on game init
Hooks.once('init', function() {
    console.log("AURA: Init hook fired");
    dialogueAuraSystem = new DialogueAuraSystem();
    dialogueAuraSystem.init();
});

// Setup on game ready
Hooks.once('ready', async function() {
    console.log("AURA: Ready hook fired");
    dialogueAuraSystem.setup();

    // Initialize conversation groups system
    console.log("AURA: Initializing ConversationGroupsSystem");
    window.conversationGroupsSystem = new window.ConversationGroupsSystem(dialogueAuraSystem);
    await window.conversationGroupsSystem.loadConversationGroups();

    // Set up socket listener for floating text
    const socketName = `module.${MODULE_ID}`;
    console.log("AURA: Setting up socket listener for", socketName);
    console.log("AURA: Current user is", game.user.isGM ? "GM" : "Player");

    // Remove old listener if it exists
    game.socket.removeAllListeners(socketName);

    game.socket.on(socketName, (data) => {
        console.log("AURA: Received socket message on", game.user.isGM ? "GM" : "Player", "client", {
            action: data?.action,
            hasData: !!data?.data,
            sender: data?.sender,
            isGM: game.user.isGM
        });

        // Handle floating text display from GM (but not on GM's own client, already displayed locally)
        if (data?.action === 'displayFloatingText' && !game.user.isGM) {
            console.log("AURA: Player processing floating text from socket");
            if (data.data) {
                console.log("AURA: Calling handleFloatingTextFromSocket with token:", data.data.tokenName);
                dialogueAuraSystem.handleFloatingTextFromSocket(data.data);
            } else {
                console.warn("AURA: Floating text socket message missing data field");
            }
        } else if (data?.action === 'displayFloatingText') {
            console.log("AURA: Ignoring floating text message on GM client (already displayed locally)");
        }
    });

    // Export API
    const api = game.modules.get(MODULE_ID).api || {};
    api.dialogueAura = {
        assignTable: (tokenId, tableId, range) => dialogueAuraSystem.assignTableToToken(tokenId, tableId, range),
        removeTable: (tokenId) => dialogueAuraSystem.removeTableFromToken(tokenId),
        getAura: (tokenId) => dialogueAuraSystem.getAuraConfig(tokenId),
        getAllAuras: () => dialogueAuraSystem.getAllAuras(),
        updateRange: (tokenId, range) => dialogueAuraSystem.updateAuraRange(tokenId, range),
        toggleAura: (tokenId, enabled) => dialogueAuraSystem.toggleAura(tokenId, enabled),
        startMonitoring: () => dialogueAuraSystem.startMonitoring(),
        stopMonitoring: () => dialogueAuraSystem.stopMonitoring()
    };
    api.conversationGroups = {
        createGroup: (config) => window.conversationGroupsSystem.createConversationGroup(config),
        deleteGroup: (groupId) => window.conversationGroupsSystem.deleteConversationGroup(groupId),
        getGroup: (groupId) => window.conversationGroupsSystem.getConversationGroup(groupId),
        getAllGroups: () => window.conversationGroupsSystem.getConversationGroups(),
        getNPCConversations: (tokenId) => window.conversationGroupsSystem.getNPCConversations(tokenId),
        getStats: () => window.conversationGroupsSystem.getConversationStats()
    };
    game.modules.get(MODULE_ID).api = api;

    console.log("AURA: API exported");
});

/**
 * Dialog to select a roll table for the token
 */
async function showTableSelectionDialog(token) {
    const auraConfig = dialogueAuraSystem.getAuraConfig(token.id);

    // Build table options
    let tableOptions = '<option value="">-- Select a Table --</option>';
    for (let table of game.tables) {
        const selected = auraConfig && auraConfig.tableId === table.id ? 'selected' : '';
        tableOptions += `<option value="${table.id}" ${selected}>${table.name}</option>`;
    }

    if (game.tables.size === 0) {
        ui.notifications.warn('No roll tables found in the world');
        return;
    }

    const dialogContent = `
        <form>
            <div class="form-group">
                <label for="table-select">Select a Roll Table:</label>
                <select id="table-select" style="width: 100%; margin-bottom: 10px;">
                    ${tableOptions}
                </select>
            </div>
            <div class="form-group">
                <label for="range-input">Dialogue Trigger Range (feet):</label>
                <input type="number" id="range-input" min="5" max="120" step="5"
                       value="${auraConfig ? auraConfig.range : game.settings.get(MODULE_ID, 'dialogueAuraRange')}"
                       style="width: 100%;">
            </div>
        </form>
    `;

    return new Dialog({
        title: `Assign Dialogue Table to ${token.name}`,
        content: dialogContent,
        buttons: {
            assign: {
                icon: '<i class="fas fa-check"></i>',
                label: 'Assign',
                callback: async (html) => {
                    const tableId = html.find('#table-select').val();
                    const range = parseInt(html.find('#range-input').val());

                    if (!tableId) {
                        ui.notifications.warn('Please select a table');
                        return;
                    }

                    await dialogueAuraSystem.assignTableToToken(token.id, tableId, range);
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: 'Cancel'
            }
        },
        default: 'assign'
    }).render(true);
}

/**
 * Dialog to edit aura range
 */
async function showRangeEditDialog(token) {
    const aura = dialogueAuraSystem.getAuraConfig(token.id);
    if (!aura) return;

    const dialogContent = `
        <form>
            <div class="form-group">
                <label for="range-input">Dialogue Trigger Range (feet):</label>
                <input type="number" id="range-input" min="5" max="120" step="5" value="${aura.range}" style="width: 100%;">
            </div>
            <div style="margin-top: 10px; padding: 10px; background: rgba(0,0,0,0.1); border-radius: 5px; font-size: 12px;">
                <p><strong>Table:</strong> ${aura.tableName}</p>
            </div>
        </form>
    `;

    return new Dialog({
        title: `Edit Aura Range - ${token.name}`,
        content: dialogContent,
        buttons: {
            save: {
                icon: '<i class="fas fa-check"></i>',
                label: 'Save',
                callback: async (html) => {
                    const range = parseInt(html.find('#range-input').val());
                    if (range < 5 || range > 120) {
                        ui.notifications.error('Range must be between 5 and 120 feet');
                        return;
                    }
                    await dialogueAuraSystem.updateAuraRange(token.id, range);
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: 'Cancel'
            }
        },
        default: 'save'
    }).render(true);
}

// Monitor scene changes
Hooks.on('canvasReady', function() {
    console.log("AURA: Canvas ready, reloading auras from scene");
    if (dialogueAuraSystem) {
        dialogueAuraSystem.loadAurasFromScene();
    }
});

// Update when tokens are created/deleted
Hooks.on('createToken', function() {
    if (dialogueAuraSystem) {
        dialogueAuraSystem.loadAurasFromScene();
    }
});

Hooks.on('deleteToken', function(token) {
    if (dialogueAuraSystem) {
        dialogueAuraSystem.removeTableFromToken(token.id);
    }
});

console.log("LOADED: Dialogue Aura system fully loaded");
