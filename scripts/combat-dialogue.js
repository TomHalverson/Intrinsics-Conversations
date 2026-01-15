console.log("LOADING: Combat Dialogue system starting");

const MODULE_ID = 'intrinsics-conversations';

/**
 * Combat Dialogue System
 * Automatically rolls dialogue when tokens attack or cast spells
 */
class CombatDialogueSystem {
    constructor() {
        this.combatDialogueMap = new Map(); // Map of tokenId -> combat dialogue config
        this.lastRolledTime = new Map(); // Prevent spam per-token
        this.lastGlobalActionTime = 0; // Track last action globally
        this.spamThrottleMs = 500; // Min ms between dialogue rolls per token
        this.globalActionThrottleMs = 1500; // Min ms between global actions
    }

    /**
     * Initialize the combat dialogue system
     */
    init() {
        console.log("COMBAT: Initializing combat dialogue system");

        // Register settings
        game.settings.register(MODULE_ID, 'combatDialogueEnabled', {
            name: 'Enable Combat Dialogue',
            hint: 'Enable the combat dialogue feature for NPCs',
            scope: 'world',
            config: true,
            type: Boolean,
            default: true
        });

        game.settings.register(MODULE_ID, 'combatDialogueChatDisplay', {
            name: 'Show Combat Dialogue in Chat',
            hint: 'Display combat dialogue messages in the chat log',
            scope: 'world',
            config: true,
            type: Boolean,
            default: true
        });

        game.settings.register(MODULE_ID, 'combatDialogueFloatingText', {
            name: 'Show Combat Dialogue Floating Text',
            hint: 'Display combat dialogue as floating text above the token',
            scope: 'world',
            config: true,
            type: Boolean,
            default: true
        });

        game.settings.register(MODULE_ID, 'combatDialogueProbability', {
            name: 'Combat Dialogue Chance (%)',
            hint: 'Probability (0-100) that dialogue will trigger on attack/spell',
            scope: 'world',
            config: true,
            type: Number,
            default: 30,
            range: { min: 0, max: 100, step: 5 }
        });

        // Register token flag storage for combat dialogue
        game.settings.register(MODULE_ID, 'combatDialogueData', {
            scope: 'world',
            config: false,
            type: String,
            default: '{}'
        });

        // Register floating text broadcast setting
        game.settings.register(MODULE_ID, 'combatFloatingTextData', {
            scope: 'world',
            config: false,
            type: String,
            default: '{}',
            onChange: (value) => {
                // Non-GMs listen for floating text broadcasts
                if (!game.user.isGM && window.combatDialogueSystem) {
                    try {
                        const data = JSON.parse(value);
                        if (data?.action === 'displayCombatFloatingText' && data?.data) {
                            window.combatDialogueSystem.handleFloatingTextFromBroadcast(data.data);
                        }
                    } catch (error) {
                        console.error("COMBAT: Error parsing floating text data:", error);
                    }
                }
            }
        });
    }

    /**
     * Setup the system (called in ready hook)
     */
    setup() {
        console.log("COMBAT: Setting up combat dialogue system");
        this.loadCombatDialogueData();
        this.registerHooks();
        this.registerSocketListener();
    }

    /**
     * Register socket listener for floating text broadcasts
     */
    registerSocketListener() {
        const socketName = `module.${MODULE_ID}`;
        game.socket.on(socketName, (data) => {
            // Non-GMs receive floating text from GM
            if (data?.action === 'displayCombatFloatingText' && !game.user.isGM && data?.data) {
                console.log("COMBAT: Received floating text broadcast for", data.data.tokenName);
                this.handleFloatingTextFromBroadcast(data.data);
            }
        });
    }

    /**
     * Load combat dialogue data from settings
     */
    loadCombatDialogueData() {
        try {
            const data = JSON.parse(game.settings.get(MODULE_ID, 'combatDialogueData'));
            this.combatDialogueMap.clear();
            for (const [tokenId, config] of Object.entries(data)) {
                this.combatDialogueMap.set(tokenId, config);
            }
            console.log("COMBAT: Loaded combat dialogue data for", this.combatDialogueMap.size, "tokens");
        } catch (error) {
            console.error("COMBAT: Error loading combat dialogue data:", error);
        }
    }

    /**
     * Save combat dialogue data to settings
     */
    async saveCombatDialogueData() {
        try {
            const data = {};
            for (const [tokenId, config] of this.combatDialogueMap) {
                data[tokenId] = config;
            }
            await game.settings.set(MODULE_ID, 'combatDialogueData', JSON.stringify(data));
            console.log("COMBAT: Saved combat dialogue data");
        } catch (error) {
            console.error("COMBAT: Error saving combat dialogue data:", error);
        }
    }

    /**
     * Register hooks for combat events (PF2e only)
     */
    registerHooks() {
        console.log("COMBAT: Registering hooks for PF2e");

        // PF2e: Primary hook for strike rolls and spell casts
        Hooks.on('pf2e.afterRoll', async (roll, actor, item) => {
            console.log("COMBAT: pf2e.afterRoll fired", { itemType: item?.type, actorName: actor?.name });
            // Only trigger for strikes and spells
            if (item && (item.type === 'melee' || item.type === 'spell')) {
                await this.handleAction(actor, item);
            }
        });

        // PF2e: Alternative hook for strikes specifically (more reliable)
        Hooks.on('pf2e.endTurn', async () => {
            console.log("COMBAT: pf2e.endTurn fired");
        });

        // Fallback: Listen for chat messages that indicate strikes/spells
        Hooks.on('createChatMessage', async (message) => {
            if (!game.settings.get(MODULE_ID, 'combatDialogueEnabled')) {
                return;
            }

            if (!game.combat || !game.combat.active) {
                return;
            }

            // Only GM should process dialogue triggers
            if (!game.user.isGM) {
                return;
            }

            // PF2e strike and spell messages have specific flags
            if (message.flags?.pf2e?.origin?.type) {
                console.log("COMBAT: PF2e action detected via chat", message.flags.pf2e.origin.type);

                // Check global action throttle to prevent multiple responses
                if (!this.shouldRollGlobalAction()) {
                    console.log("COMBAT: Global action throttle prevents dialogue");
                    return;
                }

                const speaker = message.speaker;
                if (speaker?.actor) {
                    const actor = game.actors.get(speaker.actor);
                    if (actor) {
                        const token = actor.getActiveTokens()?.[0];
                        if (token && this.shouldRoll(token.id)) {
                            const config = this.combatDialogueMap.get(token.id);
                            if (config?.tableId && config.enabled) {
                                console.log("COMBAT: Rolling dialogue from PF2e chat message for", token.name);
                                await this.rollAndDisplayDialogue(token, config.tableId, 'action');
                            }
                        }
                    }
                }
            }
        });
    }

    /**
     * Handle strike/spell actions (PF2e only)
     */
    async handleAction(actor, item) {
        try {
            if (!game.settings.get(MODULE_ID, 'combatDialogueEnabled')) {
                return;
            }

            if (!game.combat || !game.combat.active) {
                return;
            }

            if (!actor) return;

            const token = actor.getActiveTokens()?.[0];
            if (!token) return;

            // Throttle and check probability
            if (!this.shouldRoll(token.id)) {
                return;
            }

            const config = this.combatDialogueMap.get(token.id);
            if (!config || !config.tableId || !config.enabled) {
                return;
            }

            const actionType = item.type === 'spell' ? 'spell' : 'strike';
            console.log("COMBAT: Rolling dialogue for", actionType, "by", token.name);
            await this.rollAndDisplayDialogue(token, config.tableId, actionType);
        } catch (error) {
            console.error("COMBAT: Error handling action:", error);
        }
    }

    /**
     * Check if enough time has passed since the last global action
     * This prevents multiple dialogue responses to a single attack/spell
     */
    shouldRollGlobalAction() {
        const now = Date.now();
        if (now - this.lastGlobalActionTime < this.globalActionThrottleMs) {
            return false;
        }

        this.lastGlobalActionTime = now;
        return true;
    }

    /**
     * Check if we should roll (throttle spam + probability check)
     */
    shouldRoll(tokenId) {
        const now = Date.now();
        const lastTime = this.lastRolledTime.get(tokenId) || 0;

        // Check throttle first
        if (now - lastTime < this.spamThrottleMs) {
            return false;
        }

        // Check probability
        const probability = game.settings.get(MODULE_ID, 'combatDialogueProbability');
        const roll = Math.random() * 100;

        if (roll > probability) {
            console.log("COMBAT: Dialogue check failed (roll:", roll.toFixed(1), "% > chance:", probability, "%)");
            return false;
        }

        this.lastRolledTime.set(tokenId, now);
        return true;
    }

    /**
     * Roll the dialogue table and display the result
     */
    async rollAndDisplayDialogue(token, tableId, actionType) {
        try {
            const table = game.tables.get(tableId);
            if (!table) {
                console.error("COMBAT: Table not found:", tableId);
                return;
            }

            // Roll the table
            const result = await table.roll();
            const text = result.results[0]?.text || result.results[0]?.value || '';

            if (!text) {
                console.warn("COMBAT: No dialogue text in table result");
                return;
            }

            // Display as floating text if enabled
            if (game.settings.get(MODULE_ID, 'combatDialogueFloatingText')) {
                this.displayFloatingText(token, text);
                // Broadcast floating text to all players
                this.broadcastFloatingText(token, text);
            }

            // Display in chat if enabled
            if (game.settings.get(MODULE_ID, 'combatDialogueChatDisplay')) {
                this.displayChatMessage(token, text, actionType);
            }
        } catch (error) {
            console.error("COMBAT: Error rolling and displaying dialogue:", error);
        }
    }

    /**
     * Handle floating text received from broadcast (for non-GMs)
     */
    handleFloatingTextFromBroadcast(data) {
        try {
            // Find the token on the canvas
            const token = canvas.tokens.get(data.tokenId);
            if (!token) {
                console.warn("COMBAT: Could not find token for floating text:", data.tokenId);
                return;
            }

            // Use the actual position from the broadcast
            const x = data.position?.x || token.center?.x || (token.x + token.width / 2);
            const y = data.position?.y || token.center?.y || (token.y + token.height / 2);

            // Display the floating text
            this.displayFloatingTextAtPosition(data.text, x, y);
        } catch (error) {
            console.error("COMBAT: Error handling floating text broadcast:", error);
        }
    }

    /**
     * Display floating text at a specific position
     */
    displayFloatingTextAtPosition(text, x, y) {
        try {
            const plainText = text.replace ? text.replace(/<[^>]*>/g, '') : text;
            console.log("COMBAT: displayFloatingTextAtPosition called", { text: plainText });

            // Check if canvas exists
            if (!canvas?.ready) {
                console.warn("COMBAT: Canvas not ready, retrying in 100ms");
                setTimeout(() => {
                    if (canvas?.ready) {
                        this.displayFloatingTextAtPosition(plainText, x, y);
                    }
                }, 100);
                return;
            }

            // Create container for everything
            const container = new PIXI.Container();
            container.zIndex = 1000;

            // Create text - plain text, no HTML
            const floatingText = new PIXI.Text(plainText, {
                fontFamily: 'Arial',
                fontSize: 22,
                fontWeight: 'bold',
                fill: 0xFFFFFF,
                stroke: 0x000000,
                strokeThickness: 4,
                wordWrap: true,
                wordWrapWidth: 220,
                align: 'center'
            });

            floatingText.anchor.set(0.5, 0.5);
            floatingText.position.set(0, 0);

            // Create semi-transparent background box
            const background = new PIXI.Graphics();
            background.beginFill(0x1a1a1a, 0.9);
            const padding = 8;
            const bgWidth = Math.max(floatingText.width + (padding * 2), 120);
            const bgHeight = floatingText.height + (padding * 2);
            background.drawRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight);
            background.endFill();
            background.position.set(0, 0);

            // Add children (background first, text on top)
            container.addChild(background);
            container.addChild(floatingText);

            // Position above token
            container.position.set(x, y - 80);

            // Add to stage
            if (canvas.stage) {
                canvas.stage.addChild(container);
                console.log("COMBAT: Added floating text to canvas.stage");
            } else {
                console.error("COMBAT: No canvas.stage available");
                return;
            }

            // Animation: move up and fade out
            const duration = 3000;
            const startTime = Date.now();
            const startY = container.y;
            let animationId = null;

            const animate = () => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);

                // Move up smoothly
                container.y = startY - (progress * 50);
                // Fade out smoothly
                container.alpha = Math.max(0, 1 - progress);

                if (progress < 1) {
                    animationId = requestAnimationFrame(animate);
                } else {
                    // Cleanup when done
                    if (animationId) {
                        cancelAnimationFrame(animationId);
                    }
                    try {
                        if (container.parent) {
                            container.parent.removeChild(container);
                            console.log("COMBAT: Removed floating text from parent");
                        }
                        container.destroy({ children: true });
                        console.log("COMBAT: Floating text destroyed");
                    } catch (e) {
                        console.warn("COMBAT: Error cleaning up floating text:", e.message);
                    }
                }
            };

            // Start animation
            animationId = requestAnimationFrame(animate);
            console.log("COMBAT: Floating text animation started successfully");

        } catch (error) {
            console.error("COMBAT: Error displaying floating text at position:", error);
        }
    }

    /**
     * Display dialogue as floating text above the token
     */
    displayFloatingText(token, text) {
        try {
            // Remove HTML tags from text for floating text display
            const plainText = text.replace(/<[^>]*>/g, '');
            console.log("COMBAT: displayFloatingText called", { tokenName: token?.name, text: plainText });

            // Get token center position
            const tokenX = token.center?.x || (token.x + token.width / 2);
            const tokenY = token.center?.y || (token.y + token.height / 2);

            // Create container for everything
            const container = new PIXI.Container();
            container.zIndex = 1000;

            // Create text - plain text, no HTML
            const floatingText = new PIXI.Text(plainText, {
                fontFamily: 'Arial',
                fontSize: 22,
                fontWeight: 'bold',
                fill: 0xFFFFFF,
                stroke: 0x000000,
                strokeThickness: 4,
                wordWrap: true,
                wordWrapWidth: 220,
                align: 'center'
            });

            floatingText.anchor.set(0.5, 0.5);
            floatingText.position.set(0, 0);

            // Create semi-transparent background box
            const background = new PIXI.Graphics();
            background.beginFill(0x1a1a1a, 0.9);
            const padding = 8;
            const bgWidth = Math.max(floatingText.width + (padding * 2), 120);
            const bgHeight = floatingText.height + (padding * 2);
            background.drawRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight);
            background.endFill();
            background.position.set(0, 0);

            // Add children (background first, text on top)
            container.addChild(background);
            container.addChild(floatingText);

            // Position above token
            container.position.set(tokenX, tokenY - 80);

            // Add to stage (most reliable layer)
            if (canvas.stage) {
                canvas.stage.addChild(container);
                console.log("COMBAT: Added floating text to canvas.stage");
            } else {
                console.error("COMBAT: No canvas.stage available");
                return;
            }

            // Animation: move up and fade out
            const duration = 3000;
            const startTime = Date.now();
            const startY = container.y;
            let animationId = null;

            const animate = () => {
                const elapsed = Date.now() - startTime;
                const progress = Math.min(elapsed / duration, 1);

                // Move up smoothly
                container.y = startY - (progress * 50);
                // Fade out smoothly
                container.alpha = Math.max(0, 1 - progress);

                if (progress < 1) {
                    animationId = requestAnimationFrame(animate);
                } else {
                    // Cleanup when done
                    if (animationId) {
                        cancelAnimationFrame(animationId);
                    }
                    try {
                        if (container.parent) {
                            container.parent.removeChild(container);
                            console.log("COMBAT: Removed floating text from parent");
                        }
                        container.destroy({ children: true });
                        console.log("COMBAT: Floating text destroyed for", token.name);
                    } catch (e) {
                        console.warn("COMBAT: Error cleaning up floating text:", e.message);
                    }
                }
            };

            // Start animation
            animationId = requestAnimationFrame(animate);
            console.log("COMBAT: Floating text animation started successfully");

        } catch (error) {
            console.error("COMBAT: Error displaying floating text:", error);
        }
    }

    /**
     * Broadcast floating text to all players via socket
     */
    broadcastFloatingText(token, text) {
        try {
            const plainText = text.replace(/<[^>]*>/g, '');

            const floatingTextData = {
                action: 'displayCombatFloatingText',
                data: {
                    tokenId: token.id,
                    tokenName: token.name,
                    text: plainText,
                    position: { x: token.center?.x || (token.x + token.width / 2), y: token.center?.y || (token.y + token.height / 2) },
                    timestamp: Date.now()
                },
                sender: game.user.id
            };

            // Method 1: socket.emit
            game.socket.emit(`module.${MODULE_ID}`, floatingTextData);
            console.log("COMBAT: Broadcast floating text via socket for", token.name);

            // Method 2: game setting fallback for reliability
            game.settings.set(MODULE_ID, 'combatFloatingTextData', JSON.stringify(floatingTextData)).catch(e => {
                console.warn("COMBAT: Could not broadcast via settings:", e.message);
            });
        } catch (error) {
            console.error("COMBAT: Error broadcasting floating text:", error);
        }
    }

    /**
     * Display dialogue in chat
     */
    async displayChatMessage(token, text, actionType) {
        try {
            const speaker = ChatMessage.getSpeaker({ token: token.document });
            const actionLabel = actionType === 'spell' ? 'casts a spell' : 'attacks';

            const content = `<p><em>"${text}"</em></p>`;

            await ChatMessage.create({
                speaker: speaker,
                content: content,
                type: CONST.CHAT_MESSAGE_TYPES.IC,
                flavor: `${token.name} ${actionLabel}...`
            });

            console.log("COMBAT: Posted chat message for", token.name);
        } catch (error) {
            console.error("COMBAT: Error posting chat message:", error);
        }
    }

    /**
     * Assign a combat dialogue table to a token
     */
    async assignTableToToken(tokenId, tableId, enabled = true) {
        const token = canvas.tokens.get(tokenId);
        if (!token) {
            console.error("COMBAT: Token not found:", tokenId);
            return false;
        }

        const table = game.tables.get(tableId);
        if (!table) {
            console.error("COMBAT: Roll table not found:", tableId);
            return false;
        }

        const config = {
            tableId: tableId,
            tableName: table.name,
            tokenId: tokenId,
            tokenName: token.name,
            enabled: enabled
        };

        this.combatDialogueMap.set(tokenId, config);
        await this.saveCombatDialogueData();

        console.log("COMBAT: Assigned table", table.name, "to token", token.name);
        return true;
    }

    /**
     * Remove combat dialogue from a token
     */
    async removeFromToken(tokenId) {
        if (this.combatDialogueMap.has(tokenId)) {
            const config = this.combatDialogueMap.get(tokenId);
            this.combatDialogueMap.delete(tokenId);
            await this.saveCombatDialogueData();
            console.log("COMBAT: Removed combat dialogue from token", config.tokenName);
            return true;
        }
        return false;
    }

    /**
     * Remove combat dialogue from all tokens
     */
    async removeAllCombatDialogue() {
        const count = this.combatDialogueMap.size;
        this.combatDialogueMap.clear();
        await this.saveCombatDialogueData();
        console.log("COMBAT: Removed combat dialogue from all tokens");
        return count;
    }

    /**
     * Toggle combat dialogue on/off for a token
     */
    async toggleForToken(tokenId) {
        const config = this.combatDialogueMap.get(tokenId);
        if (!config) {
            return false;
        }

        config.enabled = !config.enabled;
        this.combatDialogueMap.set(tokenId, config);
        await this.saveCombatDialogueData();

        console.log("COMBAT: Toggled combat dialogue for token", config.tokenName, "to", config.enabled);
        return config.enabled;
    }

    /**
     * Get combat dialogue config for a token
     */
    getTokenConfig(tokenId) {
        return this.combatDialogueMap.get(tokenId);
    }

    /**
     * Get all tokens with combat dialogue
     */
    getTokensWithCombatDialogue() {
        return Array.from(this.combatDialogueMap.values());
    }
}

// Create global instance
window.combatDialogueSystem = new CombatDialogueSystem();

// Register with API
Hooks.on('init', () => {
    window.combatDialogueSystem.init();
});

Hooks.on('ready', () => {
    window.combatDialogueSystem.setup();

    // Expose API
    const api = game.modules.get(MODULE_ID)?.api || {};
    api.combatDialogue = {
        assignTableToToken: (tokenId, tableId, enabled) => window.combatDialogueSystem.assignTableToToken(tokenId, tableId, enabled),
        removeFromToken: (tokenId) => window.combatDialogueSystem.removeFromToken(tokenId),
        toggleForToken: (tokenId) => window.combatDialogueSystem.toggleForToken(tokenId),
        getTokenConfig: (tokenId) => window.combatDialogueSystem.getTokenConfig(tokenId),
        getTokensWithCombatDialogue: () => window.combatDialogueSystem.getTokensWithCombatDialogue()
    };
    game.modules.get(MODULE_ID).api = api;
});
