/**
 * CONVERSATION GROUPS SETUP MACRO
 * Copy this entire script into a Foundry macro (type: Script)
 * Then run it to create and manage multi-NPC conversations
 *
 * Conversation Modes:
 * - Random: Each NPC rolls from their own table
 * - Turn-Taking: NPCs take turns rolling from a shared table
 * - Scripted: Pre-written dialogue in a specific order
 */

const api = game.modules.get('intrinsics-conversations')?.api;
if (!api || !api.conversationGroups) {
    ui.notifications.error('Intrinsic\'s Conversations module not found!');
    throw new Error("Module not found");
}

// Get the conversation groups system directly
const conversationGroups = window.conversationGroupsSystem;
if (!conversationGroups) {
    ui.notifications.error('Conversation Groups system not initialized!');
    throw new Error("System not initialized");
}

// Dark mode styles for all dialogs
const DARK_MODE_STYLES = `
    <style>
        .conv-dialog-container {
            background: #1a1a1a;
            color: #e0e0e0;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            max-height: 90vh;
            overflow-y: auto;
            padding: 5px;
        }

        .conv-stats {
            margin: 10px 0;
            padding: 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 5px;
        }

        .conv-stats p {
            margin: 5px 0;
            color: #e0e0e0;
        }

        .conv-menu-buttons {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 15px;
        }

        .conv-menu-btn {
            padding: 10px 12px;
            background: linear-gradient(135deg, #3d6b9e 0%, #2a4a7a 100%);
            color: #e0e0e0;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            cursor: pointer;
            text-align: left;
            transition: all 0.2s ease;
            font-weight: 500;
        }

        .conv-menu-btn:hover {
            background: linear-gradient(135deg, #4a7cb8 0%, #3a5a8a 100%);
            border-color: rgba(255, 255, 255, 0.2);
            transform: translateX(2px);
        }

        .conv-menu-btn:active {
            transform: translateX(0px);
        }

        .form-group {
            margin-bottom: 15px;
        }

        .form-group label {
            display: block;
            margin-bottom: 5px;
            color: #e0e0e0;
            font-weight: 500;
        }

        .form-group input,
        .form-group select,
        .form-group textarea {
            width: 100%;
            padding: 10px;
            background: #1a1a1a;
            color: #e0e0e0;
            border: 2px solid rgba(61, 107, 158, 0.3);
            border-radius: 4px;
            box-sizing: border-box;
            font-family: inherit;
            font-size: 14px;
        }

        .form-group select {
            min-height: 40px;
            height: auto;
        }

        .form-group input:focus,
        .form-group select:focus,
        .form-group textarea:focus {
            outline: none;
            border-color: #3d6b9e;
            box-shadow: 0 0 12px rgba(61, 107, 158, 0.5);
            background: #222222;
        }

        .form-group select {
            background: #1a1a1a !important;
            color: #e0e0e0 !important;
            border: 2px solid rgba(61, 107, 158, 0.3) !important;
            border-radius: 4px !important;
            padding: 8px !important;
        }

        .form-group select:focus {
            outline: none !important;
            border-color: #3d6b9e !important;
            box-shadow: 0 0 12px rgba(61, 107, 158, 0.5) !important;
            background: #222222 !important;
        }

        .form-group select option {
            background: #2a2a2a !important;
            color: #e0e0e0 !important;
            padding: 5px !important;
        }

        .form-group select option:checked {
            background: #3d6b9e !important;
            color: #e0e0e0 !important;
        }

        /* Additional select styling for Foundry compatibility */
        select {
            background: #1a1a1a !important;
            color: #e0e0e0 !important;
        }

        select option {
            background: #2a2a2a !important;
            color: #e0e0e0 !important;
        }

        select option:checked {
            background: #3d6b9e !important;
            color: #e0e0e0 !important;
        }

        .mode-option {
            padding: 12px;
            margin-bottom: 8px;
            background: rgba(255, 255, 255, 0.05);
            border: 2px solid rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .mode-option:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: #3d6b9e;
        }

        .mode-option.selected {
            background: rgba(61, 107, 158, 0.2);
            border-color: #3d6b9e;
        }

        .mode-option-title {
            font-weight: 600;
            margin-bottom: 4px;
            color: #e0e0e0;
        }

        .mode-option-desc {
            font-size: 12px;
            color: #a0a0a0;
        }

        .mode-section {
            padding: 12px;
            background: rgba(255, 255, 255, 0.02);
            border-left: 3px solid #3d6b9e;
            margin-top: 10px;
            border-radius: 4px;
        }

        .mode-section h4 {
            margin-top: 0;
            color: #3d9bff;
            font-size: 14px;
        }

        .npc-assignment {
            padding: 10px;
            margin-bottom: 8px;
            background: rgba(255, 255, 255, 0.03);
            border-radius: 3px;
        }

        .npc-assignment label {
            margin-bottom: 5px;
            font-size: 13px;
        }

        hr {
            border: none;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
            margin: 15px 0;
        }

        .info-text {
            font-size: 12px;
            color: #a0a0a0;
            margin: 10px 0;
        }

        .warning-text {
            color: #ff6b6b;
            font-weight: bold;
            margin-top: 10px;
        }

        .group-item {
            margin-bottom: 12px;
            padding: 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 4px;
        }

        .group-item strong {
            color: #3d9bff;
        }

        .group-item p {
            margin: 5px 0;
        }

        .npc-order-section {
            padding: 12px;
            background: rgba(255, 255, 255, 0.02);
            border-left: 3px solid #3d6b9e;
            margin-top: 10px;
            border-radius: 4px;
        }

        .npc-order-section h4 {
            margin-top: 0;
            color: #3d9bff;
            font-size: 14px;
        }

        .npc-order-list {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 4px;
            padding: 8px;
            margin-top: 10px;
        }

        .npc-order-item {
            display: flex;
            align-items: center;
            padding: 8px;
            margin-bottom: 6px;
            background: rgba(255, 255, 255, 0.04);
            border-radius: 3px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .npc-order-item:last-child {
            margin-bottom: 0;
        }

        .npc-order-number {
            min-width: 30px;
            padding: 4px 8px;
            background: #3d6b9e;
            color: #e0e0e0;
            border-radius: 3px;
            text-align: center;
            font-weight: 600;
            margin-right: 8px;
        }

        .npc-order-name {
            flex: 1;
            color: #e0e0e0;
        }

        .npc-order-button {
            padding: 4px 8px;
            margin: 0 2px;
            background: rgba(61, 107, 158, 0.4);
            color: #3d9bff;
            border: 1px solid rgba(61, 107, 158, 0.6);
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s ease;
        }

        .npc-order-button:hover {
            background: rgba(61, 107, 158, 0.6);
            border-color: #3d9bff;
        }

        .npc-order-button:active {
            background: rgba(61, 107, 158, 0.8);
        }

        /* Select wrapper for better styling */
        .select-wrapper {
            position: relative;
            display: block;
        }

        .select-wrapper::after {
            content: '▼';
            position: absolute;
            top: 50%;
            right: 10px;
            transform: translateY(-50%);
            pointer-events: none;
            color: #e0e0e0;
            font-size: 12px;
        }

        .select-wrapper select {
            padding-right: 30px;
        }
    </style>
`;

/**
 * Show main menu dialog
 */
function showMainMenu() {
    const stats = conversationGroups.getConversationStats();
    const isPaused = game.settings.get('intrinsics-conversations', 'globalPause');
    const pauseButtonColor = isPaused ? '#d64545' : '#45b049';
    const pauseButtonText = isPaused ? 'Conversations Paused: Click to Resume' : 'Conversations Running: Click to Pause';

    const dialogContent = `
        ${DARK_MODE_STYLES}
        <div class="conv-dialog-container">
            <div class="conv-stats">
                <p><strong>Total Groups:</strong> ${stats.total}</p>
                <p><strong>Enabled:</strong> ${stats.enabled} | <strong>Disabled:</strong> ${stats.disabled}</p>
                <p><strong>Scripted:</strong> ${stats.scripted} | <strong>Random:</strong> ${stats.random} | <strong>Turn-Taking:</strong> ${stats.turnTaking}</p>
            </div>

            <div style="margin: 15px 0; padding: 12px; background: ${isPaused ? 'rgba(214, 69, 69, 0.15)' : 'rgba(69, 176, 73, 0.15)'}; border: 2px solid ${pauseButtonColor}; border-radius: 5px; text-align: center;">
                <button class="conv-menu-btn" id="btn-pause" style="width: 100%; background: ${pauseButtonColor}; margin: 0;">
                    ${pauseButtonText}
                </button>
            </div>

            <hr>

            <p style="margin-bottom: 15px;"><strong>What would you like to do?</strong></p>
            <div id="menu-buttons" class="conv-menu-buttons">
                <button class="conv-menu-btn" id="btn-create">Create New Conversation Group</button>
                <button class="conv-menu-btn" id="btn-list">View All Conversation Groups</button>
                <button class="conv-menu-btn" id="btn-delete">Delete Conversation Group</button>

            </div>
        </div>
    `;

    const dialog = new Dialog({
        title: "Conversation Groups Manager",
        content: dialogContent,
        buttons: {
            close: {
                icon: '<i class="fas fa-times"></i>',
                label: 'Close'
            }
        },
        default: 'close'
    });

    dialog.render(true);

    // Add button event handlers
    setTimeout(() => {
        document.getElementById('btn-pause').addEventListener('click', async () => {
            const currentPause = game.settings.get('intrinsics-conversations', 'globalPause');
            await game.settings.set('intrinsics-conversations', 'globalPause', !currentPause);
            dialog.close();
            setTimeout(() => showMainMenu(), 100);
            const newState = !currentPause ? 'PAUSED' : 'RESUMED';
            ui.notifications.info(`Conversations ${newState}`);
        });
        document.getElementById('btn-create').addEventListener('click', () => {
            dialog.close();
            showCreateGroupDialog();
        });
        document.getElementById('btn-list').addEventListener('click', () => {
            dialog.close();
            showListGroupsDialog();
        });
        document.getElementById('btn-delete').addEventListener('click', () => {
            dialog.close();
            showDeleteGroupDialog();
        });
        document.getElementById('btn-quick-demo').addEventListener('click', () => {
            dialog.close();
            showQuickDemoSetup();
        });
    }, 100);
}

/**
 * Show dialog to create a new conversation group
 */
function showCreateGroupDialog() {
    // Get selected tokens
    const selectedTokens = canvas.tokens.controlled;
    if (selectedTokens.length === 0) {
        ui.notifications.warn('Please select at least 1 token to create a conversation group');
        return;
    }

    // Get all roll tables for options
    let tableOptions = '<option value="">-- Select a Table --</option>';
    for (let table of game.tables) {
        tableOptions += `<option value="${table.id}">${table.name}</option>`;
    }

    const dialogContent = `
        ${DARK_MODE_STYLES}
        <div class="conv-dialog-container">
            <div class="form-group">
                <label><strong>Conversation Name:</strong></label>
                <input type="text" id="group-name" placeholder="e.g., 'Tavern Patrons'" style="margin-bottom: 10px;">
            </div>

            <div class="form-group">
                <label><strong>Conversation Mode:</strong></label>
                <div id="mode-options" style="margin-top: 10px;">
                    <div class="mode-option selected" data-mode="random">
                        <div class="mode-option-title">RANDOM Mode</div>
                        <div class="mode-option-desc">Each NPC randomly selects from their own table</div>
                    </div>
                    <div class="mode-option" data-mode="turn-taking">
                        <div class="mode-option-title">TURN-TAKING Mode</div>
                        <div class="mode-option-desc">NPCs take turns rolling from a shared table</div>
                    </div>
                    <div class="mode-option" data-mode="scripted">
                        <div class="mode-option-title">SCRIPTED Mode</div>
                        <div class="mode-option-desc">Hard-select from table by index (no randomness)</div>
                    </div>
                    
                </div>
                <input type="hidden" id="mode-select" value="random">
            </div>

            <div class="form-group">
                <label><strong>Detection Range (feet):</strong></label>
                <input type="number" id="range-input" min="5" max="120" step="5" value="30" style="margin-bottom: 15px;">
            </div>

            <div class="form-group">
                <label><strong>Conversation Delay (seconds):</strong></label>
                <input type="number" id="delay-input" min="1" max="60" step="1" value="10" style="margin-bottom: 15px;">
                <p class="info-text">Time to wait between conversation triggers (overrides global setting)</p>
            </div>

            <hr>

            <div class="npc-order-section" id="npc-order-customize" style="display: none;">
                <h4>Customize Speaking Order</h4>
                <p class="info-text">Click the up/down arrows to reorder how NPCs take turns speaking</p>
                <div class="npc-order-list" id="npc-order-list">
                    ${selectedTokens.map((token, idx) => `
                        <div class="npc-order-item" data-npc-id="${token.id}" data-order-index="${idx}">
                            <div class="npc-order-number">${idx + 1}</div>
                            <div class="npc-order-name">${token.name}</div>
                            <button type="button" class="npc-order-button npc-order-up" ${idx === 0 ? 'disabled style="opacity: 0.5;"' : ''}>UP</button>
                            <button type="button" class="npc-order-button npc-order-down" ${idx === selectedTokens.length - 1 ? 'disabled style="opacity: 0.5;"' : ''}>DOWN</button>
                        </div>
                    `).join('')}
                </div>
            </div>

            <p class="info-text"><strong>Selected NPCs:</strong> ${selectedTokens.map(t => t.name).join(', ')}</p>

            <div id="random-mode" class="mode-section">
                <h4>[RANDOM] Assign Dialogue Tables</h4>
                <p class="info-text">Each NPC will randomly select from their assigned table</p>
                ${selectedTokens.map(token => `
                    <div class="npc-assignment">
                        <label><strong>${token.name}:</strong></label>
                        <div class="select-wrapper">
                            <select id="table-${token.id}">
                                ${tableOptions}
                            </select>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div id="turn-taking-mode" class="mode-section" style="display: none;">
                <h4>[TURN-TAKING] Shared Dialogue Table</h4>
                <p class="info-text">All NPCs will take turns rolling from this table</p>
                <div class="npc-assignment">
                    <label><strong>Table for All NPCs:</strong></label>
                    <div class="select-wrapper">
                        <select id="shared-table">
                            ${tableOptions}
                        </select>
                    </div>
                </div>
            </div>

            <div id="scripted-mode" class="mode-section" style="display: none;">
                <h4>[SCRIPTED] Hard-Select Dialogue from Table</h4>
                <p class="info-text">Incrementally select lines from a table by index (no random rolling)</p>
                <div class="npc-assignment">
                    <label><strong>Dialogue Table:</strong></label>
                    <div class="select-wrapper">
                        <select id="scripted-table">
                            ${tableOptions}
                        </select>
                    </div>
                </div>
            </div>

            
        </div>
    `;

    const dialog = new Dialog({
        title: "Create Conversation Group",
        content: dialogContent,
        buttons: {
            create: {
                icon: '<i class="fas fa-check"></i>',
                label: 'Create Group',
                callback: async (html) => {
                    const name = html.find('#group-name').val();
                    const mode = html.find('#mode-select').val();
                    const range = parseInt(html.find('#range-input').val());

                    if (!name) {
                        ui.notifications.warn('Please enter a name for the conversation group');
                        return;
                    }

                    // Collect NPC order from the UI
                    let npcOrder = selectedTokens.map(t => t.id);
                    const npcOrderItems = html.find('.npc-order-item');
                    if (npcOrderItems.length > 0) {
                        npcOrder = [];
                        npcOrderItems.each(function() {
                            npcOrder.push($(this).attr('data-npc-id'));
                        });
                    }

                    const delay = parseInt(html.find('#delay-input').val());

                    const groupConfig = {
                        name: name,
                        mode: mode,
                        range: range,
                        delay: delay,
                        npcs: npcOrder
                    };

                    if (mode === 'random') {
                        // Collect table assignments
                        groupConfig.tablesByNPC = {};
                        let allTablesSelected = true;

                        for (let token of selectedTokens) {
                            const tableId = html.find(`#table-${token.id}`).val();
                            if (!tableId) {
                                ui.notifications.warn(`Please select a table for ${token.name}`);
                                allTablesSelected = false;
                                break;
                            }
                            groupConfig.tablesByNPC[token.id] = tableId;
                        }

                        if (!allTablesSelected) return;
                    } else if (mode === 'turn-taking') {
                        // Collect shared table
                        const tableId = html.find('#shared-table').val();
                        if (!tableId) {
                            ui.notifications.warn('Please select a dialogue table');
                            return;
                        }
                        groupConfig.sharedTableId = tableId;
                    } else if (mode === 'scripted') {
                        // Collect shared table for hard-selecting by index
                        const tableId = html.find('#scripted-table').val();
                        if (!tableId) {
                            ui.notifications.warn('Please select a dialogue table');
                            return;
                        }
                        groupConfig.sharedTableId = tableId;
                    } else if (mode === 'scripted-custom') {
                        // Collect dialogue
                        groupConfig.dialogue = [];

                        for (let token of selectedTokens) {
                            const text = html.find(`#dialogue-${token.id}`).val();
                            if (!text) {
                                ui.notifications.warn(`Please enter dialogue for ${token.name}`);
                                return;
                            }
                            groupConfig.dialogue.push({
                                speaker: token.id,
                                text: text
                            });
                        }
                    }

                    const groupId = await conversationGroups.createConversationGroup(groupConfig);
                    if (groupId) {
                        ui.notifications.info('Conversation group created successfully!');
                    }
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: 'Cancel'
            }
        },
        default: 'create'
    });

    dialog.render(true);

    // Add mode switching
    setTimeout(() => {
        const modeInput = document.getElementById('mode-select');
        const modeOptions = document.querySelectorAll('.mode-option');
        const randomSection = document.getElementById('random-mode');
        const turnTakingSection = document.getElementById('turn-taking-mode');
        const scriptedSection = document.getElementById('scripted-mode');
        const scriptedCustomSection = document.getElementById('scripted-custom-mode');
        const npcOrderCustomize = document.getElementById('npc-order-customize');

        modeOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                const mode = option.getAttribute('data-mode');

                // Update selected state
                modeOptions.forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');

                // Update hidden input
                modeInput.value = mode;

                // Show/hide appropriate section
                randomSection.style.display = mode === 'random' ? 'block' : 'none';
                turnTakingSection.style.display = mode === 'turn-taking' ? 'block' : 'none';
                scriptedSection.style.display = mode === 'scripted' ? 'block' : 'none';
                scriptedCustomSection.style.display = mode === 'scripted-custom' ? 'block' : 'none';

                // Show NPC order customization for modes that use ordering
                npcOrderCustomize.style.display = (mode === 'turn-taking' || mode === 'scripted' || mode === 'scripted-custom') ? 'block' : 'none';
            });
        });

        // Add NPC order reordering functionality
        const npcOrderList = document.getElementById('npc-order-list');
        if (npcOrderList) {
            npcOrderList.addEventListener('click', (e) => {
                const button = e.target;
                if (!button.classList.contains('npc-order-button')) return;

                const item = button.closest('.npc-order-item');
                const items = Array.from(npcOrderList.querySelectorAll('.npc-order-item'));
                const currentIndex = items.indexOf(item);

                if (button.classList.contains('npc-order-up') && currentIndex > 0) {
                    // Swap with previous item
                    const prevItem = items[currentIndex - 1];
                    npcOrderList.insertBefore(item, prevItem);
                    updateNPCOrderNumbers();
                    updateNPCOrderButtons();
                } else if (button.classList.contains('npc-order-down') && currentIndex < items.length - 1) {
                    // Swap with next item
                    const nextItem = items[currentIndex + 1];
                    npcOrderList.insertBefore(nextItem, item);
                    updateNPCOrderNumbers();
                    updateNPCOrderButtons();
                }
            });
        }

        function updateNPCOrderNumbers() {
            const items = npcOrderList.querySelectorAll('.npc-order-item');
            items.forEach((item, idx) => {
                item.setAttribute('data-order-index', idx);
                item.querySelector('.npc-order-number').textContent = idx + 1;
            });
        }

        function updateNPCOrderButtons() {
            const items = npcOrderList.querySelectorAll('.npc-order-item');
            items.forEach((item, idx) => {
                const upBtn = item.querySelector('.npc-order-up');
                const downBtn = item.querySelector('.npc-order-down');

                if (idx === 0) {
                    upBtn.disabled = true;
                    upBtn.style.opacity = '0.5';
                } else {
                    upBtn.disabled = false;
                    upBtn.style.opacity = '1';
                }

                if (idx === items.length - 1) {
                    downBtn.disabled = true;
                    downBtn.style.opacity = '0.5';
                } else {
                    downBtn.disabled = false;
                    downBtn.style.opacity = '1';
                }
            });
        }
    }, 100);
}

/**
 * Show dialog listing all conversation groups
 */
function showListGroupsDialog() {
    const groups = conversationGroups.getConversationGroups();

    if (groups.length === 0) {
        ui.notifications.info('No conversation groups created yet');
        return;
    }

    let groupsList = '<div style="max-height: 500px; overflow-y: auto;">';

    for (let group of groups) {
        const npcNames = group.npcs.map(id => {
            const token = canvas.tokens.get(id);
            return token ? token.name : id;
        }).join(', ');

        let modeDisplay = '[RANDOM] Random';
        if (group.mode === 'scripted') modeDisplay = '[SCRIPTED] Scripted (Table)';
        else if (group.mode === 'scripted-custom') modeDisplay = '[SCRIPTED CUSTOM] Scripted (Custom)';
        else if (group.mode === 'turn-taking') modeDisplay = '[TURN-TAKING] Turn-Taking';

        groupsList += `
            <div class="group-item">
                <p><strong>${group.name}</strong></p>
                <p style="font-size: 12px;">
                    <strong>Mode:</strong> ${modeDisplay} |
                    <strong>Range:</strong> ${group.range} ft |
                    <strong>Delay:</strong> ${group.delay} sec |
                    <strong>Status:</strong> ${group.enabled ? '[ON] Enabled' : '[OFF] Disabled'}
                </p>
                <p class="info-text"><strong>NPCs:</strong> ${npcNames}</p>
                <p class="info-text">ID: ${group.groupId}</p>
            </div>
        `;
    }

    groupsList += '</div>';

    const fullContent = `
        ${DARK_MODE_STYLES}
        <div class="conv-dialog-container">
            ${groupsList}
        </div>
    `;

    new Dialog({
        title: "Conversation Groups",
        content: fullContent,
        buttons: {
            close: {
                icon: '<i class="fas fa-times"></i>',
                label: 'Close'
            }
        },
        default: 'close'
    }).render(true);
}

/**
 * Show dialog to delete a conversation group
 */
function showDeleteGroupDialog() {
    const groups = conversationGroups.getConversationGroups();

    if (groups.length === 0) {
        ui.notifications.info('No conversation groups to delete');
        return;
    }

    let options = '<option value="">-- Select a Group to Delete --</option>';
    for (let group of groups) {
        options += `<option value="${group.groupId}">${group.name}</option>`;
    }

    const dialogContent = `
        ${DARK_MODE_STYLES}
        <div class="conv-dialog-container">
            <div class="form-group">
                <label><strong>Select Conversation Group:</strong></label>
                <div class="select-wrapper">
                    <select id="group-select">
                        ${options}
                    </select>
                </div>
            </div>
            <p class="warning-text">[WARNING] This cannot be undone!</p>
        </div>
    `;

    new Dialog({
        title: "Delete Conversation Group",
        content: dialogContent,
        buttons: {
            delete: {
                icon: '<i class="fas fa-trash"></i>',
                label: 'Delete',
                callback: async (html) => {
                    const groupId = html.find('#group-select').val();
                    if (!groupId) {
                        ui.notifications.warn('Please select a group to delete');
                        return;
                    }

                    await conversationGroups.deleteConversationGroup(groupId);
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: 'Cancel'
            }
        },
        default: 'cancel'
    }).render(true);
}

/**
 * Quick demo setup
 */
function showQuickDemoSetup() {
    const selectedTokens = canvas.tokens.controlled;

    if (selectedTokens.length === 0) {
        ui.notifications.warn('Please select at least 1 token for the demo');
        return;
    }

    // Get available tables
    let tableOptions = '';
    for (let table of game.tables) {
        tableOptions += `<option value="${table.id}">${table.name}</option>`;
    }

    if (game.tables.size === 0) {
        ui.notifications.warn('No roll tables found. Create a Roll Table first!');
        return;
    }

    const dialogContent = `
        ${DARK_MODE_STYLES}
        <div class="conv-dialog-container">
            <p style="margin-bottom: 15px;"><strong>Quick Demo Setup</strong></p>
            <p class="info-text">Choose which mode you'd like to demo:</p>

            <div class="form-group">
                <label><strong>Demo Mode:</strong></label>
                <div id="demo-mode-options" style="margin-top: 10px;">
                    <div class="mode-option selected" data-demo-mode="random">
                        <div class="mode-option-title">RANDOM Mode</div>
                        <div class="mode-option-desc">Each NPC rolls from same table randomly</div>
                    </div>
                    <div class="mode-option" data-demo-mode="turn-taking">
                        <div class="mode-option-title">TURN-TAKING Mode</div>
                        <div class="mode-option-desc">NPCs take turns rolling from shared table</div>
                    </div>
                </div>
                <input type="hidden" id="demo-mode-select" value="random">
            </div>

            <div class="form-group">
                <label><strong>Select Dialogue Table:</strong></label>
                <div class="select-wrapper">
                    <select id="demo-table">
                        ${tableOptions}
                    </select>
                </div>
            </div>

            <div class="form-group">
                <label><strong>Detection Range (feet):</strong></label>
                <input type="number" id="demo-range" min="5" max="120" step="5" value="30">
            </div>

            <p class="info-text">
                <strong>Selected NPCs:</strong> ${selectedTokens.map(t => t.name).join(', ')}
            </p>
        </div>
    `;

    const dialog = new Dialog({
        title: "Quick Demo Setup",
        content: dialogContent,
        buttons: {
            create: {
                icon: '<i class="fas fa-play"></i>',
                label: 'Create Demo',
                callback: async (html) => {
                    const demoMode = html.find('#demo-mode-select').val();
                    const tableId = html.find('#demo-table').val();
                    const range = parseInt(html.find('#demo-range').val());

                    if (!tableId) {
                        ui.notifications.warn('Please select a table');
                        return;
                    }

                    const table = game.tables.get(tableId);
                    const groupConfig = {
                        name: `${table.name} Demo (${selectedTokens.length} NPCs)`,
                        mode: demoMode,
                        range: range,
                        npcs: selectedTokens.map(t => t.id)
                    };

                    if (demoMode === 'random') {
                        groupConfig.tablesByNPC = {};
                        for (let token of selectedTokens) {
                            groupConfig.tablesByNPC[token.id] = tableId;
                        }
                    } else if (demoMode === 'turn-taking') {
                        groupConfig.sharedTableId = tableId;
                    }

                    const groupId = await conversationGroups.createConversationGroup(groupConfig);
                    if (groupId) {
                        ui.notifications.info('Demo conversation created! NPCs will speak when players come within range.');
                    }
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: 'Cancel'
            }
        },
        default: 'create'
    });

    dialog.render(true);

    // Add mode switching for demo
    setTimeout(() => {
        const demoModeInput = document.getElementById('demo-mode-select');
        const demoModeOptions = document.querySelectorAll('[data-demo-mode]');

        demoModeOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                const mode = option.getAttribute('data-demo-mode');

                demoModeOptions.forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');

                demoModeInput.value = mode;
            });
        });
    }, 100);
}

// Show the main menu
showMainMenu();
