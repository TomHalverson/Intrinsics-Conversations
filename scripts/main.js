console.log("🟢 LOADING: Intrinsic's Conversations script starting");

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
            padding: 20px;
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
        console.log(`🟢 Added character: ${character.name}`);
        
        // Broadcast to all players if this is the GM making changes
        if (broadcast && game.user.isGM) {
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
                this.broadcastConversationState();
            }
        }
    }
    
    setSpeaker(tokenId, broadcast = true) {
        const character = this.characters.get(tokenId);
        if (character) {
            this.currentSpeaker = tokenId;
            this.updateDisplay();
            ui.notifications.info(`${character.name} is now speaking`);
            
            // Broadcast to all players if this is the GM making changes
            if (broadcast && game.user.isGM) {
                this.broadcastConversationState();
            }
        }
    }
    
    clearSpeaker(broadcast = true) {
        this.currentSpeaker = null;
        this.updateDisplay();
        
        // Broadcast to all players if this is the GM making changes
        if (broadcast && game.user.isGM) {
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
            this.broadcastConversationState();
        }
    }
    
    // Broadcast conversation state using multiple methods for reliability
    broadcastConversationState() {
        if (!game.user.isGM) {
            console.log("🔴 SOCKET: Not GM, skipping broadcast");
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
        
        console.log("🟢 SOCKET: Broadcasting conversation state", conversationState);
        
        // Method 1: Use game.socket.emit (standard approach)
        try {
            game.socket.emit(`module.${MODULE_ID}`, {
                action: 'syncConversation',
                data: conversationState,
                sender: game.user.id
            });
            console.log("🟢 SOCKET: Method 1 - game.socket.emit sent");
        } catch (error) {
            console.error("🔴 SOCKET: Method 1 failed", error);
        }
        
        // Method 2: Use socketlib if available (fallback)
        try {
            if (window.socketlib) {
                window.socketlib.system.emit('intrinsicsConversations', conversationState);
                console.log("🟢 SOCKET: Method 2 - socketlib sent");
            }
        } catch (error) {
            console.error("🔴 SOCKET: Method 2 failed", error);
        }
        
        // Method 3: Use game setting as ultimate fallback
        try {
            game.settings.set(MODULE_ID, 'conversationState', JSON.stringify(conversationState));
            console.log("🟢 SOCKET: Method 3 - game setting updated");
        } catch (error) {
            console.error("🔴 SOCKET: Method 3 failed", error);
        }
    }
    
    // Receive conversation state from GM
    receiveConversationState(conversationState) {
        console.log("🟢 SOCKET: Player applying received conversation state", conversationState);
        
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
            
            this.currentSpeaker = conversationState.currentSpeaker;
            
            // Show display if GM has it visible
            if (conversationState.isVisible) {
                console.log("🟢 SOCKET: Player showing conversation display");
                this.show();
            } else {
                console.log("🟢 SOCKET: Player hiding conversation display");
                this.hide();
            }
            
            // Show notification to player
            const speakerName = conversationState.currentSpeaker ? 
                this.characters.get(conversationState.currentSpeaker)?.name : 'No one';
            ui.notifications.info(`Conversation synced - Speaking: ${speakerName}`);
            
        } else {
            console.log("🟢 SOCKET: Player hiding display (no characters)");
            this.hide();
        }
    }
    
    getTokenPortrait(token) {
        if (token.actor && token.actor.img && token.actor.img !== 'icons/svg/mystery-man.svg') {
            return token.actor.img;
        }
        return token.document.texture.src || 'icons/svg/mystery-man.svg';
    }
    
    updateDisplay() {
        if (!this.element) return;
        
        if (this.characters.size === 0) {
            this.element.innerHTML = '<div style="padding: 20px; text-align: center; font-style: italic; color: rgba(255,255,255,0.7);">No active conversation</div>';
            return;
        }
        
        let html = '<div style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap; justify-content: center;">';
        
        for (const character of this.characters.values()) {
            const isCurrentSpeaker = this.currentSpeaker === character.id;
            const glowStyle = isCurrentSpeaker ? 
                'box-shadow: 0 0 25px #ffd700, 0 0 40px rgba(255, 215, 0, 0.4); border-color: #ffd700; animation: pulse 2s infinite;' : 
                '';
            
            html += `
                <div style="text-align: center; cursor: pointer; transition: all 0.3s ease; padding: 10px; border-radius: 12px; background: rgba(255,255,255,0.05);" 
                     data-character-id="${character.id}"
                     onmouseover="this.style.transform='translateY(-5px) scale(1.05)'; this.style.background='rgba(135, 206, 235, 0.2)'" 
                     onmouseout="this.style.transform='translateY(0) scale(1)'; this.style.background='rgba(255,255,255,0.05)'">
                    <div style="width: 90px; height: 90px; border-radius: 50%; overflow: hidden; margin-bottom: 10px; border: 3px solid rgba(255,255,255,0.6); position: relative; ${glowStyle}">
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
                    0%, 100% { box-shadow: 0 0 25px #ffd700, 0 0 40px rgba(255, 215, 0, 0.4); }
                    50% { box-shadow: 0 0 35px #ffd700, 0 0 60px rgba(255, 215, 0, 0.8); }
                }
                @keyframes bounce {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-3px); }
                }
            `;
            document.head.appendChild(styles);
        }
        
        this.element.innerHTML = html;
        
        // Add click handlers only for GM
        if (game.user.isGM) {
            this.element.querySelectorAll('[data-character-id]').forEach(el => {
                el.addEventListener('click', () => {
                    const characterId = el.dataset.characterId;
                    if (this.currentSpeaker === characterId) {
                        this.clearSpeaker();
                    } else {
                        this.setSpeaker(characterId);
                    }
                });
            });
        }
    }
    
    hasCharacter(tokenId) {
        return this.characters.has(tokenId);
    }
}

// Global conversation display instance
let conversationDisplay = null;

// Register game setting for fallback communication
Hooks.once('init', function() {
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
                    if (data.timestamp && data.characters) {
                        console.log("🟢 SETTING: Player received conversation update via setting", data);
                        conversationDisplay.receiveConversationState(data);
                    }
                } catch (error) {
                    console.error("🔴 SETTING: Error parsing conversation state", error);
                }
            }
        }
    });
});

Hooks.once('ready', function() {
    console.log("🟢 READY: Intrinsic's Conversations ready hook fired");
    console.log(`🟢 USER: ${game.user.name} (${game.user.isGM ? 'GM' : 'Player'})`);
    
    try {
        ui.notifications.info("Intrinsic's Conversations loaded successfully!");
        
        conversationDisplay = new SimpleConversationDisplay();
        
        // Set up socket listener using correct event name format
        const socketName = `module.${MODULE_ID}`;
        console.log("🟢 SOCKET: Setting up socket listener for", socketName);
        
        game.socket.on(socketName, (data) => {
            console.log("🟢 SOCKET: Received socket message", data);
            
            // Players should receive sync messages from GM
            if (!game.user.isGM && data.action === 'syncConversation') {
                console.log("🟢 SOCKET: Player processing conversation sync");
                conversationDisplay.receiveConversationState(data.data);
            } else {
                console.log("🔴 SOCKET: Message ignored", {
                    isGM: game.user.isGM,
                    action: data.action,
                    sender: data.sender
                });
            }
        });
        
        // Test socket after a delay
        setTimeout(() => {
            if (game.user.isGM) {
                console.log("🟢 TEST: GM sending test socket message");
                game.socket.emit(socketName, {
                    action: 'test',
                    data: { message: 'Connection test from GM' },
                    sender: game.user.id
                });
            }
        }, 3000);
        
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
                    console.log("🟢 TEST: Manual socket test");
                    game.socket.emit(socketName, {
                        action: 'manualTest',
                        data: { message: 'Manual test from GM' },
                        sender: game.user.id
                    });
                }
            },
            forceSync: function() {
                if (game.user.isGM) {
                    console.log("🟢 FORCE: Manual conversation sync");
                    conversationDisplay.broadcastConversationState();
                }
            },
            test: function() {
                console.log("🟢 API: Test function called");
                ui.notifications.info("API test successful!");
                return "success";
            }
        };
        
        console.log("🟢 API: Created successfully");
        
    } catch (error) {
        console.error("🔴 ERROR in ready hook:", error);
    }
});

// GM-ONLY: Add buttons to Token HUD
Hooks.on('renderTokenHUD', function(hud, html, data) {
    // Only show buttons for GM
    if (!game.user.isGM) {
        console.log("🟢 TOKEN HUD: Skipping buttons for player:", game.user.name);
        return;
    }
    
    console.log("🟢 TOKEN HUD: Adding GM conversation buttons");
    
    try {
        const token = canvas.tokens.get(data._id);
        if (!token || !conversationDisplay) {
            return;
        }
        
        const $html = html.jquery ? html : $(html);
        
        // Create button container
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'conversation-buttons';
        buttonContainer.style.cssText = `
            position: absolute !important;
            bottom: -55px !important;
            left: 50% !important;
            transform: translateX(-50%) !important;
            display: flex !important;
            gap: 10px !important;
            background: rgba(0, 0, 0, 0.95) !important;
            border-radius: 12px !important;
            padding: 10px !important;
            border: 2px solid rgba(255, 255, 255, 0.6) !important;
            backdrop-filter: blur(8px) !important;
            z-index: 99999 !important;
            box-shadow: 0 6px 25px rgba(0, 0, 0, 0.7) !important;
            pointer-events: auto !important;
        `;
        
        // Helper function to create buttons
        function createButton(text, color, title, clickHandler) {
            const button = document.createElement('button');
            button.innerHTML = text;
            button.title = title;
            button.style.cssText = `
                background: ${color} !important;
                border: none !important;
                border-radius: 8px !important;
                padding: 10px 12px !important;
                color: white !important;
                cursor: pointer !important;
                font-size: 16px !important;
                font-weight: bold !important;
                transition: all 0.2s ease !important;
                box-shadow: 0 3px 6px rgba(0,0,0,0.4) !important;
                min-width: 40px !important;
                position: relative !important;
                z-index: 100000 !important;
                pointer-events: auto !important;
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
                    console.error("🔴 Error in button click:", error);
                }
            });
            
            return button;
        }
        
        // Add appropriate buttons
        if (!conversationDisplay.hasCharacter(token.id)) {
            const addButton = createButton(
                '<i class="fas fa-plus"></i>',
                'linear-gradient(45deg, #4a90e2, #357abd)',
                'Add to Conversation',
                () => {
                    console.log("🟢 GM: Adding token and broadcasting");
                    conversationDisplay.addCharacter(token);
                    conversationDisplay.show();
                }
            );
            buttonContainer.appendChild(addButton);
        } else {
            const removeButton = createButton(
                '<i class="fas fa-minus"></i>',
                'linear-gradient(45deg, #e24a4a, #bd3535)',
                'Remove from Conversation',
                () => {
                    console.log("🟢 GM: Removing token and broadcasting");
                    conversationDisplay.removeCharacter(token.id);
                }
            );
            buttonContainer.appendChild(removeButton);
            
            const speakerIcon = conversationDisplay.currentSpeaker === token.id ? 'fa-comment-slash' : 'fa-comment';
            const speakerTitle = conversationDisplay.currentSpeaker === token.id ? 'Clear Speaker' : 'Set as Speaker';
            const speakerButton = createButton(
                `<i class="fas ${speakerIcon}"></i>`,
                'linear-gradient(45deg, #ffd700, #ffed4a)',
                speakerTitle,
                () => {
                    console.log("🟢 GM: Toggling speaker and broadcasting");
                    if (conversationDisplay.currentSpeaker === token.id) {
                        conversationDisplay.clearSpeaker();
                    } else {
                        conversationDisplay.setSpeaker(token.id);
                    }
                }
            );
            speakerButton.style.color = '#333 !important';
            buttonContainer.appendChild(speakerButton);
        }
        
        const toggleButton = createButton(
            `<i class="fas fa-eye${conversationDisplay.element ? '-slash' : ''}"></i>`,
            'linear-gradient(45deg, #9b59b6, #8e44ad)',
            conversationDisplay.element ? 'Hide Display' : 'Show Display',
            () => {
                console.log("🟢 GM: Toggling display and broadcasting");
                if (conversationDisplay.element) {
                    conversationDisplay.hide();
                } else {
                    conversationDisplay.show();
                }
                conversationDisplay.broadcastConversationState();
            }
        );
        buttonContainer.appendChild(toggleButton);
        
        const hudElement = $html[0] || $html;
        hudElement.appendChild(buttonContainer);
        
        console.log("🟢 TOKEN HUD: GM buttons added successfully");
        
    } catch (error) {
        console.error("🔴 ERROR adding Token HUD buttons:", error);
    }
});

console.log("🟢 LOADED: Script file processed");