console.log("LOADING: Intrinsic's Conversations script starting");

// Socket communication - using correct Foundry socket system
const MODULE_ID = 'intrinsics-conversations';

// Simple conversation display
class SimpleConversationDisplay {
    constructor() {
        this.characters = new Map();
        this.currentSpeaker = null;
        this.element = null;
    }
    
    show() {
        if (this.element) return;
        
        this.element = document.createElement('div');
        this.element.id = 'intrinsics-conversation-display';
        this.element.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.85);
            border-radius: 15px;
            padding: 35px 20px 20px 20px;
            z-index: 1000;
            color: white;
            font-family: 'Signika', sans-serif;
            backdrop-filter: blur(8px);
            border: 2px solid rgba(255, 255, 255, 0.3);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
            min-width: 200px;
        `;
        
        document.body.appendChild(this.element);
        this.updateDisplay();
    }
    
    hide() {
        if (this.element) {
            this.element.remove();
            this.element = null;
        }
    }
    
    addCharacter(token, broadcast = true) {
        const character = {
            id: token.id,
            name: token.document.name || 'Unknown',
            portrait: this.getTokenPortrait(token),
            tokenData: {
                id: token.id,
                name: token.document.name,
                img: token.document.texture.src,
                actorImg: token.actor?.img
            }
        };
        
        this.characters.set(token.id, character);
        this.updateDisplay();
        
        ui.notifications.info(`Added ${character.name} to conversation`);
        console.log(`Added character: ${character.name}`);
        
        // Broadcast to all players if this is the GM making changes
        if (broadcast && game.user.isGM) {
            console.log("BROADCAST: Adding character");
            this.broadcastConversationState();
        }
    }
    
    removeCharacter(tokenId, broadcast = true) {
        const character = this.characters.get(tokenId);
        if (character) {
            this.characters.delete(tokenId);
            if (this.currentSpeaker === tokenId) {
                this.currentSpeaker = null;
            }
            this.updateDisplay();
            ui.notifications.info(`Removed ${character.name} from conversation`);
            
            if (this.characters.size === 0) {
                this.hide();
            }
            
            // Broadcast to all players if this is the GM making changes
            if (broadcast && game.user.isGM) {
                console.log("BROADCAST: Removing character");
                this.broadcastConversationState();
            }
        }
    }
    
    setSpeaker(tokenId, broadcast = true) {
        const character = this.characters.get(tokenId);
        if (character) {
            console.log(`SPEAKER: Setting speaker to ${character.name} (${tokenId}), broadcast: ${broadcast}, isGM: ${game.user.isGM}`);
            
            this.currentSpeaker = tokenId;
            this.updateDisplay();
            ui.notifications.info(`${character.name} is now speaking`);
            
            // IMPORTANT: Always broadcast speaker changes if GM
            if (broadcast && game.user.isGM) {
                console.log("BROADCAST: Setting speaker - broadcasting now");
                this.broadcastConversationState();
            }
        } else {
            console.error("SPEAKER: Character not found for tokenId:", tokenId);
        }
    }
    
    clearSpeaker(broadcast = true) {
        console.log(`SPEAKER: Clearing speaker, broadcast: ${broadcast}, isGM: ${game.user.isGM}`);
        
        this.currentSpeaker = null;
        this.updateDisplay();
        ui.notifications.info("No one is speaking");
        
        // IMPORTANT: Always broadcast speaker changes if GM
        if (broadcast && game.user.isGM) {
            console.log("BROADCAST: Clearing speaker - broadcasting now");
            this.broadcastConversationState();
        }
    }
    
    clearAll(broadcast = true) {
        const count = this.characters.size;
        this.characters.clear();
        this.currentSpeaker = null;
        this.hide();
        
        if (count > 0) {
            ui.notifications.info(`Cleared ${count} character(s) from conversation`);
        }
        
        // Broadcast to all players if this is the GM making changes
        if (broadcast && game.user.isGM) {
            console.log("BROADCAST: Clearing all");
            this.broadcastConversationState();
        }
    }
    
    // Broadcast conversation state using multiple methods for reliability
    broadcastConversationState() {
        if (!game.user.isGM) {
            console.log("SOCKET: Not GM, skipping broadcast");
            return;
        }
        
        const conversationState = {
            characters: Array.from(this.characters.entries()).map(([id, char]) => ({
                id,
                name: char.name,
                portrait: char.portrait,
                tokenData: char.tokenData
            })),
            currentSpeaker: this.currentSpeaker,
            isVisible: !!this.element,
            timestamp: Date.now()
        };
        
        console.log("SOCKET: Broadcasting conversation state", {
            characters: conversationState.characters.length,
            currentSpeaker: conversationState.currentSpeaker,
            speakerName: conversationState.currentSpeaker ? this.characters.get(conversationState.currentSpeaker)?.name : 'None',
            isVisible: conversationState.isVisible
        });
        
        // Method 1: Use game.socket.emit (standard approach)
        try {
            game.socket.emit(`module.${MODULE_ID}`, {
                action: 'syncConversation',
                data: conversationState,
                sender: game.user.id
            });
            console.log("SOCKET: Method 1 - game.socket.emit sent successfully");
        } catch (error) {
            console.error("SOCKET: Method 1 failed", error);
        }
        
        // Method 3: Use game setting as ultimate fallback
        try {
            game.settings.set(MODULE_ID, 'conversationState', JSON.stringify(conversationState));
            console.log("SOCKET: Method 3 - game setting updated successfully");
        } catch (error) {
            console.error("SOCKET: Method 3 failed", error);
        }
    }
    
    // Receive conversation state from GM
    receiveConversationState(conversationState) {
        console.log("SOCKET: Player receiving conversation state", {
            characters: conversationState.characters?.length || 0,
            currentSpeaker: conversationState.currentSpeaker,
            isVisible: conversationState.isVisible
        });
        
        // Clear current state
        this.characters.clear();
        this.currentSpeaker = null;
        
        // Apply new state
        if (conversationState.characters && conversationState.characters.length > 0) {
            conversationState.characters.forEach(charData => {
                this.characters.set(charData.id, {
                    id: charData.id,
                    name: charData.name,
                    portrait: charData.portrait,
                    tokenData: charData.tokenData
                });
            });
            
            // IMPORTANT: Set the current speaker
            this.currentSpeaker = conversationState.currentSpeaker;
            console.log("SOCKET: Player set currentSpeaker to:", this.currentSpeaker);
            
            // Show display if GM has it visible
            if (conversationState.isVisible) {
                console.log("SOCKET: Player showing conversation display");
                this.show(); // This will call updateDisplay() if not already shown
                // IMPORTANT: Always update display even if already visible
                this.updateDisplay();
            } else {
                console.log("SOCKET: Player hiding conversation display");
                this.hide();
            }
            
            // Show notification to player with current speaker
            const speakerName = conversationState.currentSpeaker ? 
                this.characters.get(conversationState.currentSpeaker)?.name : 'No one';
            ui.notifications.info(`Conversation synced - Speaking: ${speakerName}`);
            console.log("SOCKET: Player notification sent for speaker:", speakerName);
            
        } else {
            console.log("SOCKET: Player hiding display (no characters)");
            this.hide();
        }
    }
    
    getTokenPortrait(token) {
        // Prioritize token texture (token art) over actor avatar
        const tokenTexture = token.document.texture.src;
        
        // Use token texture if it exists and isn't the default mystery man
        if (tokenTexture && tokenTexture !== 'icons/svg/mystery-man.svg') {
            return tokenTexture;
        }
        
        // Fall back to actor image if token texture is default or missing
        if (token.actor && token.actor.img && token.actor.img !== 'icons/svg/mystery-man.svg') {
            return token.actor.img;
        }
        
        // Final fallback to mystery man
        return 'icons/svg/mystery-man.svg';
    }
    
    updateDisplay() {
        if (!this.element) return;
        
        console.log("DISPLAY: Updating display, currentSpeaker:", this.currentSpeaker);
        
        if (this.characters.size === 0) {
            this.element.innerHTML = '<div style="padding: 20px; text-align: center; font-style: italic; color: rgba(255,255,255,0.7);">No active conversation</div>';
            return;
        }
        
        // Add close button at the top (only visible for GMs)
        let html = '';
        if (game.user.isGM) {
            html += `
                <button id="conversation-close-btn" style="
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    background: linear-gradient(45deg, #e24a4a, #bd3535);
                    border: none;
                    border-radius: 50%;
                    width: 28px;
                    height: 28px;
                    color: white;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: bold;
                    transition: all 0.2s ease;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 10;
                " title="Close Conversation">
                    <i class="fas fa-times"></i>
                </button>
            `;
        }
        
        html += '<div style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap; justify-content: center;">';
        
        for (const character of this.characters.values()) {
            const isCurrentSpeaker = this.currentSpeaker === character.id;
            console.log(`DISPLAY: Character ${character.name} (${character.id}) - isCurrentSpeaker: ${isCurrentSpeaker}`);
            
            const glowStyle = isCurrentSpeaker ? 
                'box-shadow: 0 0 25px #ffd700, 0 0 40px rgba(255, 215, 0, 0.4); border-color: #ffd700; animation: pulse 2s infinite;' : 
                'border-color: rgba(255,255,255,0.6);';
            
            html += `
                <div style="text-align: center; cursor: ${game.user.isGM ? 'pointer' : 'default'}; transition: all 0.3s ease; padding: 10px; border-radius: 12px; background: rgba(255,255,255,0.05);" 
                     data-character-id="${character.id}"
                     ${game.user.isGM ? `onmouseover="this.style.transform='translateY(-5px) scale(1.05)'; this.style.background='rgba(135, 206, 235, 0.2)'" onmouseout="this.style.transform='translateY(0) scale(1)'; this.style.background='rgba(255,255,255,0.05)'"` : ''}>
                    <div style="width: 90px; height: 90px; border-radius: 50%; overflow: hidden; margin-bottom: 10px; border: 3px solid; position: relative; ${glowStyle}">
                        <img src="${character.portrait}" alt="${character.name}" 
                             style="width: 100%; height: 100%; object-fit: cover;" />
                        ${isCurrentSpeaker ? '<div style="position: absolute; top: -8px; right: -8px; width: 24px; height: 24px; background: linear-gradient(45deg, #ffd700, #ffed4a); border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.4); animation: bounce 1s infinite;"><i class="fas fa-comment" style="font-size: 12px; color: #000;"></i></div>' : ''}
                    </div>
                    <div style="font-size: 13px; font-weight: 600; max-width: 90px; word-wrap: break-word; line-height: 1.2; ${isCurrentSpeaker ? 'color: #ffd700; text-shadow: 0 0 10px rgba(255, 215, 0, 0.6);' : 'color: #fff; text-shadow: 1px 1px 3px rgba(0,0,0,0.8);'}">${character.name}</div>
                </div>
            `;
        }
        
        html += '</div>';
        
        // Add role indicator for non-GMs
        if (!game.user.isGM && this.characters.size > 0) {
            html += '<div style="text-align: center; margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 11px; color: rgba(255,255,255,0.5); font-style: italic;">Controlled by GM</div>';
        }
        
        // Add CSS animations if not already added
        if (!document.querySelector('#conversation-styles')) {
            const styles = document.createElement('style');
            styles.id = 'conversation-styles';
            styles.textContent = `
                @keyframes pulse {
                    0%, 100% { box-shadow: 0 0 25px #ffd700, 0 0 40px rgba(255, 215, 0, 0.4) !important; border-color: #ffd700 !important; }
                    50% { box-shadow: 0 0 35px #ffd700, 0 0 60px rgba(255, 215, 0, 0.8) !important; border-color: #ffed4a !important; }
                }
                @keyframes bounce {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-3px); }
                }
            `;
            document.head.appendChild(styles);
        }
        
        this.element.innerHTML = html;
        console.log("DISPLAY: HTML updated, adding click handlers for GM:", game.user.isGM);
        
        // Add click handler for close button (GM only)
        if (game.user.isGM) {
            const closeBtn = this.element.querySelector('#conversation-close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('mouseenter', () => {
                    closeBtn.style.transform = 'scale(1.15) rotate(90deg)';
                    closeBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.6)';
                });
                
                closeBtn.addEventListener('mouseleave', () => {
                    closeBtn.style.transform = 'scale(1) rotate(0deg)';
                    closeBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
                });
                
                closeBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log("DISPLAY: Close button clicked, clearing conversation");
                    this.clearAll(true); // broadcast = true
                });
                
                console.log("DISPLAY: Close button handler added");
            }
        }
        
        // Add click handlers only for GM
        if (game.user.isGM) {
            this.element.querySelectorAll('[data-character-id]').forEach(el => {
                el.addEventListener('click', (e) => {
                    const characterId = el.dataset.characterId;
                    console.log("DISPLAY: GM clicked character portrait:", characterId);
                    
                    if (this.currentSpeaker === characterId) {
                        console.log("DISPLAY: Clearing speaker (was already speaking)");
                        this.clearSpeaker(true); // broadcast = true
                    } else {
                        console.log("DISPLAY: Setting new speaker");
                        this.setSpeaker(characterId, true); // broadcast = true
                    }
                });
            });
            console.log("DISPLAY: GM click handlers added");
        } else {
            console.log("DISPLAY: Player mode - no click handlers added");
        }
    }
    
    hasCharacter(tokenId) {
        return this.characters.has(tokenId);
    }
}

// Global conversation display instance
let conversationDisplay = null;

// Register game settings and module configurations
Hooks.once('init', function() {
    // Existing conversation state setting
    game.settings.register(MODULE_ID, 'conversationState', {
        scope: 'world',
        config: false,
        type: String,
        default: '{}',
        onChange: (value) => {
            // Only players should listen to setting changes
            if (!game.user.isGM && conversationDisplay) {
                try {
                    const data = JSON.parse(value);
                    if (data.timestamp && data.characters !== undefined) {
                        console.log("SETTING: Player received conversation update via setting");
                        conversationDisplay.receiveConversationState(data);
                    }
                } catch (error) {
                    console.error("SETTING: Error parsing conversation state", error);
                }
            }
        }
    });
    
    // NEW: HUD button position setting
    game.settings.register(MODULE_ID, 'hudPosition', {
        name: 'Conversation Button Position',
        hint: 'Choose where conversation buttons appear relative to token HUD',
        scope: 'world',
        config: true,
        type: String,
        choices: {
            'auto': 'Auto (Smart positioning)',
            'bottom': 'Below HUD',
            'bottom-far': 'Far Below HUD (extra spacing)',
            'top': 'Above HUD',
            'left': 'Left of HUD',
            'right': 'Right of HUD'
        },
        default: 'auto',
        onChange: () => {
            ui.notifications.info("Button position updated - will apply to next HUD render");
        }
    });
    
    // NEW: Button style setting
    game.settings.register(MODULE_ID, 'buttonStyle', {
        name: 'Button Style',
        hint: 'Choose the visual style for conversation buttons',
        scope: 'world',
        config: true,
        type: String,
        choices: {
            'compact': 'Compact (icon only)',
            'full': 'Full (icon with text)',
            'text': 'Text only'
        },
        default: 'compact'
    });
});

Hooks.once('ready', function() {
    console.log("READY: Intrinsic's Conversations ready hook fired");
    console.log(`USER: ${game.user.name} (${game.user.isGM ? 'GM' : 'Player'})`);
    
    try {
        ui.notifications.info("Intrinsic's Conversations loaded successfully!");
        
        conversationDisplay = new SimpleConversationDisplay();
        
        // Set up socket listener using correct event name format
        const socketName = `module.${MODULE_ID}`;
        console.log("SOCKET: Setting up socket listener for", socketName);
        
        game.socket.on(socketName, (data) => {
            console.log("SOCKET: Received socket message", {
                action: data.action,
                sender: data.sender,
                isGM: game.user.isGM
            });
            
            // Players should receive sync messages from GM
            if (!game.user.isGM && data.action === 'syncConversation') {
                console.log("SOCKET: Player processing conversation sync");
                conversationDisplay.receiveConversationState(data.data);
            } else if (data.action === 'test' || data.action === 'manualTest') {
                console.log("SOCKET: Received test message:", data.data);
            } else {
                console.log("SOCKET: Message ignored", {
                    isGM: game.user.isGM,
                    action: data.action
                });
            }
        });
        
        // Set up API
        game.modules.get(MODULE_ID).api = {
            display: conversationDisplay,
            addCharacter: function(token) { return conversationDisplay.addCharacter(token); },
            removeCharacter: function(tokenId) { return conversationDisplay.removeCharacter(tokenId); },
            setSpeaker: function(tokenId) { return conversationDisplay.setSpeaker(tokenId); },
            clearSpeaker: function() { return conversationDisplay.clearSpeaker(); },
            show: function() { return conversationDisplay.show(); },
            hide: function() { return conversationDisplay.hide(); },
            clear: function() { return conversationDisplay.clearAll(); },
            // Test functions
            testSocket: function() {
                if (game.user.isGM) {
                    console.log("TEST: Manual socket test");
                    game.socket.emit(socketName, {
                        action: 'manualTest',
                        data: { message: 'Manual test from GM' },
                        sender: game.user.id
                    });
                }
            },
            forceSync: function() {
                if (game.user.isGM) {
                    console.log("FORCE: Manual conversation sync");
                    conversationDisplay.broadcastConversationState();
                }
            },
            test: function() {
                console.log("API: Test function called");
                ui.notifications.info("API test successful!");
                return "success";
            }
        };
        
        console.log("API: Created successfully");
        
    } catch (error) {
        console.error("ERROR in ready hook:", error);
    }
});

// Enhanced Token HUD with dynamic positioning
Hooks.on('renderTokenHUD', async function(hud, html, data) {
    // Only show buttons for GM
    if (!game.user.isGM) {
        return;
    }
    
    // Small delay to ensure other modules have rendered their elements
    await new Promise(resolve => setTimeout(resolve, 30));
    
    try {
        const token = canvas.tokens.get(data._id);
        if (!token || !conversationDisplay) {
            return;
        }
        
        const $html = html.jquery ? html : $(html);
        const hudElement = $html[0] || $html;
        
        // Get user preferences
        const positionMode = game.settings.get(MODULE_ID, 'hudPosition');
        const buttonStyle = game.settings.get(MODULE_ID, 'buttonStyle');
        
        // Analyze HUD structure for intelligent positioning
        const hudBounds = hudElement.getBoundingClientRect();
        const hudHeight = hudElement.offsetHeight || 70;
        const hudWidth = hudElement.offsetWidth || 150;
        
        // Check for various HUD elements that might affect positioning
        const hasAttributeBars = hudElement.querySelector('.attribute-bars') || 
                                 hudElement.querySelector('.col.right') ||
                                 hudElement.querySelector('[class*="resource"]');
        
        const hasStatusEffects = hudElement.querySelector('.status-effects') ||
                                hudElement.querySelector('[class*="effect"]');
        
        const hasPF2eElements = hudElement.querySelector('[class*="pf2e"]') ||
                               hudElement.querySelector('.distance-number');
        
        // Check if Token Action HUD or similar module is present
        const hasTokenActionHUD = document.querySelector('#token-action-hud') ||
                                 document.querySelector('.tah-container');
        
        // Determine optimal position
        let positionStyle = '';
        
        switch(positionMode) {
            case 'bottom':
                // Standard bottom position
                positionStyle = `
                    bottom: -75px !important;
                    left: 50% !important;
                    transform: translateX(-50%) !important;
                `;
                break;
            
            case 'bottom-far':
                // Extra spacing below for complex HUDs
                positionStyle = `
                    bottom: -100px !important;
                    left: 50% !important;
                    transform: translateX(-50%) !important;
                `;
                break;
            
            case 'right':
                positionStyle = `
                    top: 50% !important;
                    left: ${hudWidth + 15}px !important;
                    transform: translateY(-50%) !important;
                `;
                break;
            
            case 'left':
                positionStyle = `
                    top: 50% !important;
                    right: ${hudWidth + 15}px !important;
                    transform: translateY(-50%) !important;
                `;
                break;
            
            case 'top':
                positionStyle = `
                    top: -55px !important;
                    left: 50% !important;
                    transform: translateX(-50%) !important;
                `;
                break;
            
            case 'auto':
            default:
                // Intelligent positioning based on detected elements
                if (hasTokenActionHUD) {
                    // If Token Action HUD is present, go far to the side
                    positionStyle = `
                        top: 50% !important;
                        left: ${hudWidth + 80}px !important;
                        transform: translateY(-50%) !important;
                    `;
                } else if (hasAttributeBars || hasStatusEffects || hasPF2eElements) {
                    // If there are bottom elements, add extra spacing
                    const bottomOffset = hasAttributeBars && hasStatusEffects ? -110 : -90;
                    positionStyle = `
                        bottom: ${bottomOffset}px !important;
                        left: 50% !important;
                        transform: translateX(-50%) !important;
                    `;
                } else {
                    // Clean HUD, use standard bottom position
                    positionStyle = `
                        bottom: -75px !important;
                        left: 50% !important;
                        transform: translateX(-50%) !important;
                    `;
                }
                break;
        }
        
        // Create button container with dynamic positioning
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'intrinsics-conversation-buttons';
        buttonContainer.style.cssText = `
            position: absolute !important;
            ${positionStyle}
            display: flex !important;
            gap: 8px !important;
            background: rgba(0, 0, 0, 0.95) !important;
            border-radius: 12px !important;
            padding: 8px !important;
            border: 2px solid rgba(255, 255, 255, 0.6) !important;
            backdrop-filter: blur(8px) !important;
            z-index: 99999 !important;
            box-shadow: 0 6px 25px rgba(0, 0, 0, 0.7) !important;
            pointer-events: auto !important;
            white-space: nowrap !important;
        `;
        
        // Helper function to create buttons with configurable style
        function createButton(iconClass, text, color, title, clickHandler) {
            const button = document.createElement('button');
            
            // Determine button content based on style setting
            let buttonContent = '';
            switch(buttonStyle) {
                case 'full':
                    buttonContent = `<i class="${iconClass}"></i> <span style="margin-left: 5px;">${text}</span>`;
                    break;
                case 'text':
                    buttonContent = text;
                    break;
                case 'compact':
                default:
                    buttonContent = `<i class="${iconClass}"></i>`;
                    break;
            }
            
            button.innerHTML = buttonContent;
            button.title = title;
            button.style.cssText = `
                background: ${color} !important;
                border: none !important;
                border-radius: 8px !important;
                padding: ${buttonStyle === 'full' ? '8px 14px' : '10px 12px'} !important;
                color: white !important;
                cursor: pointer !important;
                font-size: ${buttonStyle === 'text' ? '13px' : '16px'} !important;
                font-weight: bold !important;
                transition: all 0.2s ease !important;
                box-shadow: 0 3px 6px rgba(0,0,0,0.4) !important;
                min-width: ${buttonStyle === 'compact' ? '40px' : 'auto'} !important;
                position: relative !important;
                z-index: 100000 !important;
                pointer-events: auto !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
            `;
            
            button.addEventListener('mouseenter', () => {
                button.style.transform = 'scale(1.15)';
                button.style.boxShadow = '0 5px 12px rgba(0,0,0,0.6)';
            });
            
            button.addEventListener('mouseleave', () => {
                button.style.transform = 'scale(1)';
                button.style.boxShadow = '0 3px 6px rgba(0,0,0,0.4)';
            });
            
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                try {
                    clickHandler();
                    setTimeout(() => hud.clear(), 100);
                } catch (error) {
                    console.error("Error in button click:", error);
                    ui.notifications.error("Error executing action");
                }
            });
            
            return button;
        }
        
        // Add conversation management buttons
        if (!conversationDisplay.hasCharacter(token.id)) {
            const addButton = createButton(
                'fas fa-plus',
                'Add',
                'linear-gradient(45deg, #4a90e2, #357abd)',
                'Add to Conversation',
                () => {
                    console.log("HUD: Adding token to conversation");
                    conversationDisplay.addCharacter(token);
                    conversationDisplay.show();
                }
            );
            buttonContainer.appendChild(addButton);
        } else {
            const removeButton = createButton(
                'fas fa-minus',
                'Remove',
                'linear-gradient(45deg, #e24a4a, #bd3535)',
                'Remove from Conversation',
                () => {
                    console.log("HUD: Removing token from conversation");
                    conversationDisplay.removeCharacter(token.id);
                }
            );
            buttonContainer.appendChild(removeButton);
            
            // Add speaker button if character is in conversation
            const isSpeaking = conversationDisplay.currentSpeaker === token.id;
            const speakerButton = createButton(
                isSpeaking ? 'fas fa-microphone-slash' : 'fas fa-microphone',
                isSpeaking ? 'Stop' : 'Speak',
                isSpeaking ? 
                    'linear-gradient(45deg, #666, #444)' : 
                    'linear-gradient(45deg, #ffd700, #ffb347)',
                isSpeaking ? 'Stop Speaking' : 'Set as Speaker',
                () => {
                    if (isSpeaking) {
                        console.log("HUD: Clearing speaker");
                        conversationDisplay.clearSpeaker();
                    } else {
                        console.log("HUD: Setting as speaker");
                        conversationDisplay.setSpeaker(token.id);
                    }
                }
            );
            buttonContainer.appendChild(speakerButton);
        }
        
        // Append button container to HUD
        hudElement.appendChild(buttonContainer);
        
        console.log("HUD: Conversation buttons added with position mode:", positionMode);
        
    } catch (error) {
        console.error("ERROR adding Token HUD buttons:", error);
    }
});

// Add debug command to console for testing positions
window.intrinsicsConversations = {
    testPosition: function(position) {
        game.settings.set(MODULE_ID, 'hudPosition', position);
        console.log(`Position changed to: ${position}. Click on a token to see the new button position.`);
    },
    getSettings: function() {
        return {
            position: game.settings.get(MODULE_ID, 'hudPosition'),
            buttonStyle: game.settings.get(MODULE_ID, 'buttonStyle')
        };
    }
};

console.log("LOADED: Intrinsic's Conversations module fully loaded");
console.log("TIP: Use window.intrinsicsConversations.testPosition('bottom-far') to test different positions");