// DIALOGUE AURA SETUP MACRO
// Copy this entire script into a Foundry macro (type: Script)
// Then run it to set up dialogue auras on selected tokens

const api = game.modules.get('intrinsics-conversations')?.api;
if (!api || !api.dialogueAura) {
    ui.notifications.error('Intrinsic\'s Conversations module not found!');
    throw new Error("Module not found");
}

const selectedTokens = canvas.tokens.controlled;
if (selectedTokens.length === 0) {
    ui.notifications.warn('Please select at least one token!');
    throw new Error("No tokens selected");
}

const token = selectedTokens[0];

// Build table options
let tableOptions = '<option value="">-- Select a Table --</option>';
for (let table of game.tables) {
    tableOptions += `<option value="${table.id}">${table.name}</option>`;
}

if (game.tables.size === 0) {
    ui.notifications.warn('No roll tables found in the world. Create a Roll Table first!');
    throw new Error("No tables");
}

const defaultRange = game.settings.get('intrinsics-conversations', 'dialogueAuraRange');

const dialogContent = `
    <form>
        <div class="form-group">
            <label for="table-select"><strong>Select a Roll Table:</strong></label>
            <select id="table-select" style="width: 100%; margin-bottom: 15px; padding: 5px;">
                ${tableOptions}
            </select>
        </div>
        <div class="form-group">
            <label for="range-input"><strong>Dialogue Trigger Range (feet):</strong></label>
            <input type="number" id="range-input" min="5" max="120" step="5"
                   value="${defaultRange}" style="width: 100%; padding: 5px;">
        </div>
        <hr style="margin: 15px 0;">
        <div style="font-size: 12px; color: #999;">
            <p><strong>How it works:</strong></p>
            <ul style="margin: 5px 0; padding-left: 20px;">
                <li>NPCs speak randomly when players come within range</li>
                <li>Dialogue appears in chat and above the NPC's head</li>
                <li>Different lines each time (random from your table)</li>
            </ul>
        </div>
    </form>
`;

new Dialog({
    title: `Assign Dialogue Table to ${token.name}`,
    content: dialogContent,
    buttons: {
        assign: {
            icon: '<i class="fas fa-check"></i>',
            label: 'Assign Dialogue Aura',
            callback: async (html) => {
                const tableId = html.find('#table-select').val();
                const range = parseInt(html.find('#range-input').val());

                if (!tableId) {
                    ui.notifications.warn('Please select a table');
                    return;
                }

                if (range < 5 || range > 120) {
                    ui.notifications.error('Range must be between 5 and 120 feet');
                    return;
                }

                try {
                    await api.dialogueAura.assignTable(token.id, tableId, range);
                    ui.notifications.info(`Dialogue aura assigned to ${token.name}`);
                } catch (error) {
                    console.error("Error assigning table:", error);
                    ui.notifications.error('Failed to assign dialogue table');
                }
            }
        },
        cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel'
        }
    },
    default: 'assign'
}).render(true);
