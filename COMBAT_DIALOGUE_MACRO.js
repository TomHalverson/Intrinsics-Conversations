/**
 * COMBAT DIALOGUE SETUP MACRO
 * Copy this entire script into a Foundry macro (type: Script)
 * Then run it to create and manage combat dialogue for NPCs
 *
 * Combat Dialogue allows NPCs to automatically roll dialogue from a table
 * when they attack or cast spells in combat.
 */

const api = game.modules.get('intrinsics-conversations')?.api;
if (!api || !api.combatDialogue) {
    ui.notifications.error('Intrinsic\'s Conversations module not found!');
    throw new Error("Module not found");
}

// Get the combat dialogue system directly
const combatDialogueSystem = window.combatDialogueSystem;
if (!combatDialogueSystem) {
    ui.notifications.error('Combat Dialogue system not initialized!');
    throw new Error("System not initialized");
}

// Dark mode styles for all dialogs
const DARK_MODE_STYLES = `
    <style>
        .combat-dialog-container {
            background: #1a1a1a;
            color: #e0e0e0;
            font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
            max-height: 90vh;
            overflow-y: auto;
            padding: 5px;
        }

        .combat-stats {
            margin: 10px 0;
            padding: 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 5px;
        }

        .combat-stats p {
            margin: 5px 0;
            color: #e0e0e0;
        }

        .combat-menu-buttons {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-top: 15px;
        }

        .combat-menu-btn {
            padding: 10px 12px;
            background: linear-gradient(135deg, #d4534f 0%, #a0383a 100%);
            color: #e0e0e0;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            cursor: pointer;
            text-align: left;
            transition: all 0.2s ease;
            font-weight: 500;
        }

        .combat-menu-btn:hover {
            background: linear-gradient(135deg, #e46968 0%, #b0484a 100%);
            border-color: rgba(255, 255, 255, 0.2);
            transform: translateX(2px);
        }

        .combat-menu-btn:active {
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
            border: 2px solid rgba(212, 83, 79, 0.3);
            border-radius: 4px;
            box-sizing: border-box;
            font-family: inherit;
            font-size: 14px;
        }

        .form-group input:focus,
        .form-group select:focus,
        .form-group textarea:focus {
            outline: none;
            border-color: #d4534f;
            box-shadow: 0 0 12px rgba(212, 83, 79, 0.5);
            background: #222222;
        }

        .form-group select {
            background: #1a1a1a !important;
            color: #e0e0e0 !important;
            border: 2px solid rgba(212, 83, 79, 0.3) !important;
            border-radius: 4px !important;
            padding: 8px !important;
        }

        .form-group select option {
            background: #2a2a2a !important;
            color: #e0e0e0 !important;
            padding: 5px !important;
        }

        .form-group select option:checked {
            background: #d4534f !important;
            color: #e0e0e0 !important;
        }

        select {
            background: #1a1a1a !important;
            color: #e0e0e0 !important;
        }

        select option {
            background: #2a2a2a !important;
            color: #e0e0e0 !important;
        }

        select option:checked {
            background: #d4534f !important;
            color: #e0e0e0 !important;
        }

        .token-item {
            margin-bottom: 12px;
            padding: 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 4px;
        }

        .token-item strong {
            color: #ff8080;
        }

        .token-item p {
            margin: 5px 0;
        }

        .token-status {
            display: inline-block;
            padding: 4px 8px;
            background: rgba(212, 83, 79, 0.2);
            border: 1px solid #d4534f;
            border-radius: 3px;
            font-size: 12px;
            color: #ff8080;
            margin-left: 5px;
        }

        .hr {
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

        .token-actions {
            display: flex;
            gap: 4px;
            margin-top: 8px;
        }

        .token-action-btn {
            flex: 1;
            padding: 6px;
            font-size: 11px;
            background: rgba(212, 83, 79, 0.3);
            color: #ff8080;
            border: 1px solid rgba(212, 83, 79, 0.6);
            border-radius: 3px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .token-action-btn:hover {
            background: rgba(212, 83, 79, 0.6);
            border-color: #ff8080;
        }

        .token-action-btn:active {
            background: rgba(212, 83, 79, 0.8);
        }
    </style>
`;

/**
 * Show main menu dialog
 */
function showMainMenu() {
    const tokensWithDialogue = combatDialogueSystem.getTokensWithCombatDialogue();
    const isCombatDialogueEnabled = game.settings.get('intrinsics-conversations', 'combatDialogueEnabled');
    const statusColor = isCombatDialogueEnabled ? '#45b049' : '#d64545';
    const statusText = isCombatDialogueEnabled ? 'Combat Dialogue Enabled' : 'Combat Dialogue Disabled';

    const dialogContent = `
        ${DARK_MODE_STYLES}
        <div class="combat-dialog-container">
            <div class="combat-stats">
                <p><strong>Total NPCs with Combat Dialogue:</strong> ${tokensWithDialogue.length}</p>
                <p style="color: ${statusColor}; font-weight: bold;">${statusText}</p>
            </div>

            <div style="margin: 15px 0; padding: 12px; background: ${isCombatDialogueEnabled ? 'rgba(69, 176, 73, 0.15)' : 'rgba(214, 69, 69, 0.15)'}; border: 2px solid ${statusColor}; border-radius: 5px;">
                <p style="margin: 0; color: #e0e0e0; font-size: 12px;">
                    <strong>What it does:</strong> When a token takes an action in combat (attacks, casts spells, makes checks), their assigned dialogue table is rolled and displayed as floating text and/or chat message with a 30% chance (adjustable).
                </p>
            </div>

            <div class="hr"></div>

            <p style="margin-bottom: 15px;"><strong>What would you like to do?</strong></p>
            <div class="combat-menu-buttons">
                <button class="combat-menu-btn" id="btn-assign">Assign Combat Dialogue to Token</button>
                <button class="combat-menu-btn" id="btn-list">View All Combat Dialogues</button>
                <button class="combat-menu-btn" id="btn-remove">Remove Combat Dialogue</button>
                <button class="combat-menu-btn" id="btn-settings">Settings</button>
            </div>
        </div>
    `;

    const dialog = new Dialog({
        title: "Combat Dialogue Manager",
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
        document.getElementById('btn-assign').addEventListener('click', () => {
            dialog.close();
            showAssignDialog();
        });
        document.getElementById('btn-list').addEventListener('click', () => {
            dialog.close();
            showListDialog();
        });
        document.getElementById('btn-remove').addEventListener('click', () => {
            dialog.close();
            showRemoveDialog();
        });
        document.getElementById('btn-settings').addEventListener('click', () => {
            dialog.close();
            showSettingsDialog();
        });
    }, 100);
}

/**
 * Show dialog to assign combat dialogue to a token
 */
function showAssignDialog() {
    const selectedTokens = canvas.tokens.controlled;

    if (selectedTokens.length === 0) {
        ui.notifications.warn('Please select at least 1 token');
        return;
    }

    // Get all roll tables for options
    let tableOptions = '<option value="">-- Select a Table --</option>';
    for (let table of game.tables) {
        tableOptions += `<option value="${table.id}">${table.name}</option>`;
    }

    if (game.tables.size === 0) {
        ui.notifications.warn('No roll tables found. Create a Roll Table first!');
        return;
    }

    // Build token items with proper name access
    const tokenItems = selectedTokens.map(token => {
        const tokenName = token.name || token.document?.name || 'Unknown Token';
        return `
            <div class="token-item">
                <p style="margin: 0 0 8px 0;"><strong>${tokenName}</strong></p>
                <label style="display: block; margin-bottom: 4px; font-size: 12px; color: #e0e0e0;">Dialogue Table:</label>
                <select id="table-${token.id}" style="width: 100%; padding: 8px !important; height: auto !important; min-height: 36px !important; background: #1a1a1a !important; color: #e0e0e0 !important; border: 2px solid rgba(212, 83, 79, 0.3) !important; border-radius: 4px !important; appearance: none !important; -webkit-appearance: none !important; -moz-appearance: none !important; cursor: pointer !important; font-size: 14px !important;">
                    ${tableOptions}
                </select>
            </div>
        `;
    }).join('');

    const dialogContent = `
        ${DARK_MODE_STYLES}
        <div class="combat-dialog-container" style="width: 100%; box-sizing: border-box; padding: 15px; background: #1a1a1a; color: #e0e0e0; display: flex; flex-direction: column; max-height: 100%;">
            <p style="margin: 0 0 15px 0; flex-shrink: 0;"><strong>Assign Combat Dialogue Tables</strong></p>
            <p class="info-text" style="flex-shrink: 0;">Each selected token will use the assigned table to roll dialogue when attacking or casting spells.</p>

            <div class="hr" style="flex-shrink: 0;"></div>

            <div style="flex: 1; overflow-y: auto; width: 100%; min-height: 0;">
                ${tokenItems}
            </div>
        </div>
    `;

    const dialog = new Dialog({
        title: "Assign Combat Dialogue",
        content: dialogContent,
        width: 600,
        height: 'auto',
        buttons: {
            assign: {
                icon: '<i class="fas fa-check"></i>',
                label: 'Assign',
                callback: async (html) => {
                    let assignedCount = 0;

                    for (let token of selectedTokens) {
                        const tokenName = token.name || token.document?.name || 'Unknown Token';
                        const tableId = html.find(`#table-${token.id}`).val();
                        if (!tableId) {
                            ui.notifications.warn(`Skipped ${tokenName} - no table selected`);
                            continue;
                        }

                        const success = await combatDialogueSystem.assignTableToToken(token.id, tableId, true);
                        if (success) {
                            assignedCount++;
                        }
                    }

                    if (assignedCount > 0) {
                        ui.notifications.info(`Combat dialogue assigned to ${assignedCount} token(s)`);
                    }
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: 'Cancel'
            }
        },
        default: 'assign'
    });

    dialog.render(true);

    // Adjust dialog styling after render
    setTimeout(() => {
        const dialogElement = document.querySelector('[data-appid="' + dialog.appId + '"]');
        if (dialogElement) {
            const content = dialogElement.querySelector('.window-content');
            if (content) {
                content.style.maxHeight = '70vh';
                content.style.overflowY = 'auto';
            }
            // Ensure buttons are visible
            const footer = dialogElement.querySelector('.dialog-buttons');
            if (footer) {
                footer.style.display = 'flex';
                footer.style.justifyContent = 'space-around';
                footer.style.marginTop = '15px';
                footer.style.paddingTop = '15px';
                footer.style.borderTop = '1px solid rgba(255, 255, 255, 0.1)';
            }
        }
    }, 100);
}

/**
 * Show dialog listing all tokens with combat dialogue
 */
function showListDialog() {
    const tokensWithDialogue = combatDialogueSystem.getTokensWithCombatDialogue();

    if (tokensWithDialogue.length === 0) {
        ui.notifications.info('No tokens have combat dialogue assigned');
        return;
    }

    let tokensList = '<div style="max-height: 500px; overflow-y: auto;">';

    for (let config of tokensWithDialogue) {
        const statusBadge = config.enabled ? '<span style="color: #45b049;">✓ ENABLED</span>' : '<span style="color: #d64545;">✗ DISABLED</span>';

        tokensList += `
            <div class="token-item">
                <p><strong>${config.tokenName}</strong> ${statusBadge}</p>
                <p class="info-text"><strong>Table:</strong> ${config.tableName}</p>
                <p class="info-text" style="font-size: 11px;">ID: ${config.tokenId}</p>
            </div>
        `;
    }

    tokensList += '</div>';

    const fullContent = `
        ${DARK_MODE_STYLES}
        <div class="combat-dialog-container">
            ${tokensList}
        </div>
    `;

    new Dialog({
        title: "Combat Dialogues",
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
 * Show dialog to remove combat dialogue from a token
 */
function showRemoveDialog() {
    const tokensWithDialogue = combatDialogueSystem.getTokensWithCombatDialogue();

    if (tokensWithDialogue.length === 0) {
        ui.notifications.info('No tokens with combat dialogue to remove');
        return;
    }

    let options = '<option value="">-- Select a Token --</option>';
    for (let config of tokensWithDialogue) {
        options += `<option value="${config.tokenId}">${config.tokenName}</option>`;
    }

    const dialogContent = `
        ${DARK_MODE_STYLES}
        <div class="combat-dialog-container">
            <div class="form-group">
                <label><strong>Select Token:</strong></label>
                <div class="select-wrapper">
                    <select id="token-select">
                        ${options}
                    </select>
                </div>
            </div>
            <p class="warning-text">[WARNING] This will remove combat dialogue from the token!</p>
        </div>
    `;

    const dialog = new Dialog({
        title: "Remove Combat Dialogue",
        content: dialogContent,
        buttons: {
            remove: {
                icon: '<i class="fas fa-trash"></i>',
                label: 'Remove',
                callback: async (html) => {
                    const tokenId = html.find('#token-select').val();
                    if (!tokenId) {
                        ui.notifications.warn('Please select a token');
                        return;
                    }

                    const config = combatDialogueSystem.getTokenConfig(tokenId);
                    const success = await combatDialogueSystem.removeFromToken(tokenId);
                    if (success) {
                        ui.notifications.info(`Removed combat dialogue from ${config.tokenName}`);
                    }
                }
            },
            removeAll: {
                icon: '<i class="fas fa-trash-alt"></i>',
                label: 'Delete All',
                callback: async () => {
                    // Confirm deletion
                    const confirmed = await new Promise((resolve) => {
                        new Dialog({
                            title: "Confirm Delete All",
                            content: `<p style="color: #ff6b6b; font-weight: bold;">Are you sure you want to remove combat dialogue from ALL ${tokensWithDialogue.length} tokens?</p>`,
                            buttons: {
                                yes: {
                                    label: 'Yes, Delete All',
                                    callback: () => resolve(true)
                                },
                                no: {
                                    label: 'Cancel',
                                    callback: () => resolve(false)
                                }
                            },
                            default: 'no'
                        }).render(true);
                    });

                    if (confirmed) {
                        const count = await combatDialogueSystem.removeAllCombatDialogue();
                        ui.notifications.info(`Removed combat dialogue from ${count} token(s)`);
                    }
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: 'Cancel'
            }
        },
        default: 'cancel'
    });

    dialog.render(true);
}

/**
 * Show settings dialog
 */
function showSettingsDialog() {
    const combatDialogueEnabled = game.settings.get('intrinsics-conversations', 'combatDialogueEnabled');
    const chatDisplayEnabled = game.settings.get('intrinsics-conversations', 'combatDialogueChatDisplay');
    const floatingTextEnabled = game.settings.get('intrinsics-conversations', 'combatDialogueFloatingText');
    const probability = game.settings.get('intrinsics-conversations', 'combatDialogueProbability');

    const dialogContent = `
        ${DARK_MODE_STYLES}
        <div class="combat-dialog-container">
            <p style="margin-bottom: 15px;"><strong>Combat Dialogue Settings</strong></p>

            <div style="padding: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 5px; margin-bottom: 15px;">
                <label style="display: flex; align-items: center; margin: 0; cursor: pointer;">
                    <input type="checkbox" id="setting-enabled" ${combatDialogueEnabled ? 'checked' : ''} style="width: auto; margin-right: 8px;">
                    <strong>Enable Combat Dialogue System</strong>
                </label>
            </div>

            <div style="padding: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 5px; margin-bottom: 15px;">
                <label><strong>Dialogue Trigger Chance:</strong></label>
                <div style="display: flex; align-items: center; gap: 10px; margin-top: 8px;">
                    <input type="range" id="setting-probability" min="0" max="100" step="5" value="${probability}" style="flex: 1; width: auto; height: 6px;">
                    <span id="prob-display" style="min-width: 45px; text-align: right; color: #ff8080; font-weight: bold;">${probability}%</span>
                </div>
                <p class="info-text">Probability (0-100%) that dialogue triggers on attack/spell</p>
            </div>

            <div style="padding: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 5px; margin-bottom: 15px;">
                <label style="display: flex; align-items: center; margin: 0; cursor: pointer;">
                    <input type="checkbox" id="setting-chat" ${chatDisplayEnabled ? 'checked' : ''} style="width: auto; margin-right: 8px;">
                    <strong>Show Dialogue in Chat</strong>
                </label>
                <p class="info-text">Display combat dialogue messages in the chat log</p>
            </div>

            <div style="padding: 12px; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 5px;">
                <label style="display: flex; align-items: center; margin: 0; cursor: pointer;">
                    <input type="checkbox" id="setting-floating" ${floatingTextEnabled ? 'checked' : ''} style="width: auto; margin-right: 8px;">
                    <strong>Show Dialogue as Floating Text</strong>
                </label>
                <p class="info-text">Display combat dialogue as floating text above the token</p>
            </div>
        </div>
    `;

    const dialog = new Dialog({
        title: "Settings",
        content: dialogContent,
        buttons: {
            save: {
                icon: '<i class="fas fa-save"></i>',
                label: 'Save',
                callback: async (html) => {
                    const enabled = html.find('#setting-enabled').prop('checked');
                    const chatDisplay = html.find('#setting-chat').prop('checked');
                    const floatingText = html.find('#setting-floating').prop('checked');
                    const probability = parseInt(html.find('#setting-probability').val());

                    await game.settings.set('intrinsics-conversations', 'combatDialogueEnabled', enabled);
                    await game.settings.set('intrinsics-conversations', 'combatDialogueChatDisplay', chatDisplay);
                    await game.settings.set('intrinsics-conversations', 'combatDialogueFloatingText', floatingText);
                    await game.settings.set('intrinsics-conversations', 'combatDialogueProbability', probability);

                    ui.notifications.info('Settings saved!');
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: 'Cancel'
            }
        },
        default: 'save'
    });

    dialog.render(true);

    // Add range slider event listener
    setTimeout(() => {
        const slider = document.getElementById('setting-probability');
        const display = document.getElementById('prob-display');
        if (slider && display) {
            slider.addEventListener('input', (e) => {
                display.textContent = e.target.value + '%';
            });
        }
    }, 100);
}

// Show the main menu
showMainMenu();
