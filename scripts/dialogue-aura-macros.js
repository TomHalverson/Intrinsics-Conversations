// Example Macros for Dialogue Aura Feature
// Copy these to create your own macros in Foundry

/**
 * MACRO 1: Assign Table to Selected NPC
 *
 * Assigns a dialogue table to the first selected token
 * Shows a dialog to choose the table and range
 */
const assignTableToSelected = async () => {
  const api = game.modules.get('intrinsics-conversations')?.api;
  if (!api || !api.dialogueAura) {
    ui.notifications.error('Intrinsic\'s Conversations module or Dialogue Aura feature not found!');
    return;
  }

  const selectedTokens = canvas.tokens.controlled;
  if (selectedTokens.length === 0) {
    ui.notifications.warn('Please select a token first!');
    return;
  }

  const token = selectedTokens[0];

  // Build table options
  let tableOptions = '<option value="">-- Select a Table --</option>';
  for (let table of game.tables) {
    tableOptions += `<option value="${table.id}">${table.name}</option>`;
  }

  if (game.tables.size === 0) {
    ui.notifications.warn('No roll tables found in the world');
    return;
  }

  const defaultRange = game.settings.get('intrinsics-conversations', 'dialogueAuraRange');

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
        <input type="number" id="range-input" min="5" max="120" step="5" value="${defaultRange}" style="width: 100%;">
      </div>
    </form>
  `;

  new Dialog({
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

          await api.dialogueAura.assignTable(token.id, tableId, range);
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: 'Cancel'
      }
    },
    default: 'assign'
  }).render(true);
};

/**
 * MACRO 2: Quick Aura Setup - Mass Assign
 *
 * Bulk assigns a dialogue table to multiple NPCs at once
 * Useful for quickly setting up an entire scene
 */
const quickAuraSetup = async () => {
  const api = game.modules.get('intrinsics-conversations')?.api;
  if (!api || !api.dialogueAura) {
    ui.notifications.error('Module not found!');
    return;
  }

  const selectedTokens = canvas.tokens.controlled;
  if (selectedTokens.length === 0) {
    ui.notifications.warn('Please select at least one token!');
    return;
  }

  // Build table options
  let tableOptions = '<option value="">-- Select a Table --</option>';
  for (let table of game.tables) {
    tableOptions += `<option value="${table.id}">${table.name}</option>`;
  }

  if (game.tables.size === 0) {
    ui.notifications.warn('No roll tables found in the world');
    return;
  }

  const defaultRange = game.settings.get('intrinsics-conversations', 'dialogueAuraRange');

  const dialogContent = `
    <form>
      <div class="form-group">
        <label><strong>Assigning to ${selectedTokens.length} token(s)</strong></label>
      </div>
      <div class="form-group">
        <label for="table-select">Select a Roll Table:</label>
        <select id="table-select" style="width: 100%; margin-bottom: 10px;">
          ${tableOptions}
        </select>
      </div>
      <div class="form-group">
        <label for="range-input">Dialogue Trigger Range (feet):</label>
        <input type="number" id="range-input" min="5" max="120" step="5" value="${defaultRange}" style="width: 100%;">
      </div>
    </form>
  `;

  new Dialog({
    title: 'Quick Aura Setup - Bulk Assign',
    content: dialogContent,
    buttons: {
      assign: {
        icon: '<i class="fas fa-check"></i>',
        label: 'Assign to All',
        callback: async (html) => {
          const tableId = html.find('#table-select').val();
          const range = parseInt(html.find('#range-input').val());

          if (!tableId) {
            ui.notifications.warn('Please select a table');
            return;
          }

          let count = 0;
          for (let token of selectedTokens) {
            await api.dialogueAura.assignTable(token.id, tableId, range);
            count++;
          }

          ui.notifications.info(`Assigned table to ${count} token(s)`);
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: 'Cancel'
      }
    },
    default: 'assign'
  }).render(true);
};

/**
 * MACRO 3: Remove Aura from Selected
 *
 * Removes dialogue aura from all selected tokens
 */
const removeAuraFromSelected = async () => {
  const api = game.modules.get('intrinsics-conversations')?.api;
  if (!api || !api.dialogueAura) {
    ui.notifications.error('Module not found!');
    return;
  }

  const selectedTokens = canvas.tokens.controlled;
  if (selectedTokens.length === 0) {
    ui.notifications.warn('Please select at least one token!');
    return;
  }

  let removed = 0;
  for (let token of selectedTokens) {
    const aura = api.dialogueAura.getAura(token.id);
    if (aura) {
      await api.dialogueAura.removeTable(token.id);
      removed++;
    }
  }

  if (removed === 0) {
    ui.notifications.warn('No auras found on selected tokens');
  } else {
    ui.notifications.info(`Removed ${removed} aura(s)`);
  }
};

/**
 * MACRO 4: Show All Active Auras
 *
 * Displays a list of all NPCs with active dialogue auras
 */
const showActiveAuras = () => {
  const api = game.modules.get('intrinsics-conversations')?.api;
  if (!api || !api.dialogueAura) {
    ui.notifications.error('Module not found!');
    return;
  }

  const auras = api.dialogueAura.getAllAuras();
  if (auras.length === 0) {
    ui.notifications.info('No active dialogue auras');
    return;
  }

  let html = '<div style="max-height: 400px; overflow-y: auto;">';
  html += '<table style="width: 100%; border-collapse: collapse;">';
  html += '<thead><tr style="background: #333; color: #fff;">';
  html += '<th style="padding: 8px; text-align: left; border-bottom: 2px solid #666;">Token</th>';
  html += '<th style="padding: 8px; text-align: left; border-bottom: 2px solid #666;">Table</th>';
  html += '<th style="padding: 8px; text-align: center; border-bottom: 2px solid #666;">Range</th>';
  html += '</tr></thead>';
  html += '<tbody>';

  for (let aura of auras) {
    const token = canvas.tokens.get(aura.tokenId);
    const tokenName = token ? token.name : 'Unknown';
    html += `<tr style="border-bottom: 1px solid #ddd;">`;
    html += `<td style="padding: 8px;">${tokenName}</td>`;
    html += `<td style="padding: 8px;">${aura.tableName}</td>`;
    html += `<td style="padding: 8px; text-align: center;">${aura.range} ft</td>`;
    html += `</tr>`;
  }

  html += '</tbody></table></div>';

  new Dialog({
    title: 'Active Dialogue Auras',
    content: html,
    buttons: {
      close: {
        icon: '<i class="fas fa-times"></i>',
        label: 'Close'
      }
    }
  }).render(true);
};

/**
 * MACRO 5: Toggle Aura Monitoring
 *
 * Starts or stops the dialogue aura monitoring system
 */
const toggleAuraMonitoring = () => {
  const api = game.modules.get('intrinsics-conversations')?.api;
  if (!api || !api.dialogueAura) {
    ui.notifications.error('Module not found!');
    return;
  }

  // We don't have a way to check if monitoring is active from the API,
  // so we'll provide a simpler approach
  new Dialog({
    title: 'Aura Monitoring Control',
    content: 'Choose an action:',
    buttons: {
      start: {
        icon: '<i class="fas fa-play"></i>',
        label: 'Start Monitoring',
        callback: () => {
          api.dialogueAura.startMonitoring();
          ui.notifications.info('Started dialogue aura monitoring');
        }
      },
      stop: {
        icon: '<i class="fas fa-stop"></i>',
        label: 'Stop Monitoring',
        callback: () => {
          api.dialogueAura.stopMonitoring();
          ui.notifications.info('Stopped dialogue aura monitoring');
        }
      },
      close: {
        icon: '<i class="fas fa-times"></i>',
        label: 'Cancel'
      }
    }
  }).render(true);
};

/**
 * MACRO 6: Update Aura Range
 *
 * Quickly update the range for selected tokens' auras
 */
const updateAuraRange = async () => {
  const api = game.modules.get('intrinsics-conversations')?.api;
  if (!api || !api.dialogueAura) {
    ui.notifications.error('Module not found!');
    return;
  }

  const selectedTokens = canvas.tokens.controlled;
  if (selectedTokens.length === 0) {
    ui.notifications.warn('Please select at least one token!');
    return;
  }

  const tokensWithAuras = selectedTokens.filter(t => api.dialogueAura.getAura(t.id));
  if (tokensWithAuras.length === 0) {
    ui.notifications.warn('Selected tokens have no auras');
    return;
  }

  const firstAura = api.dialogueAura.getAura(tokensWithAuras[0].id);

  const dialogContent = `
    <form>
      <div class="form-group">
        <label><strong>Updating ${tokensWithAuras.length} aura(s)</strong></label>
      </div>
      <div class="form-group">
        <label for="range-input">New Range (feet):</label>
        <input type="number" id="range-input" min="5" max="120" step="5" value="${firstAura.range}" style="width: 100%;">
      </div>
    </form>
  `;

  new Dialog({
    title: 'Update Aura Range',
    content: dialogContent,
    buttons: {
      update: {
        icon: '<i class="fas fa-check"></i>',
        label: 'Update All',
        callback: async (html) => {
          const range = parseInt(html.find('#range-input').val());

          if (range < 5 || range > 120) {
            ui.notifications.error('Range must be between 5 and 120 feet');
            return;
          }

          let count = 0;
          for (let token of tokensWithAuras) {
            await api.dialogueAura.updateRange(token.id, range);
            count++;
          }

          ui.notifications.info(`Updated ${count} aura(s) to ${range} feet`);
        }
      },
      cancel: {
        icon: '<i class="fas fa-times"></i>',
        label: 'Cancel'
      }
    },
    default: 'update'
  }).render(true);
};

/**
 * MACRO 7: Create Demo Auras
 *
 * For testing - automatically creates auras for all selected tokens
 * using a default table (or first available table)
 */
const createDemoAuras = async () => {
  const api = game.modules.get('intrinsics-conversations')?.api;
  if (!api || !api.dialogueAura) {
    ui.notifications.error('Module not found!');
    return;
  }

  if (game.tables.size === 0) {
    ui.notifications.error('No roll tables available. Please create a roll table first.');
    return;
  }

  const selectedTokens = canvas.tokens.controlled;
  if (selectedTokens.length === 0) {
    ui.notifications.warn('Please select at least one token!');
    return;
  }

  // Use first available table
  const defaultTable = game.tables.contents[0];
  const defaultRange = game.settings.get('intrinsics-conversations', 'dialogueAuraRange');

  let count = 0;
  for (let token of selectedTokens) {
    await api.dialogueAura.assignTable(token.id, defaultTable.id, defaultRange);
    count++;
  }

  ui.notifications.info(`Created ${count} demo aura(s) using table "${defaultTable.name}"`);
};

