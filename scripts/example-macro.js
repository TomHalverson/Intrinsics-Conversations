// Example Macros for JRPG Conversation Display Module
// Copy these to create your own macros in Foundry

// Macro 1: Add Selected Tokens to Conversation
// Usage: Select tokens on canvas, then run this macro
const addSelectedToConversation = () => {
  const api = game.modules.get('jrpg-conversation')?.api;
  if (!api) {
    ui.notifications.error('JRPG Conversation Display module not found!');
    return;
  }

  const selectedTokens = canvas.tokens.controlled;
  if (selectedTokens.length === 0) {
    ui.notifications.warn('Please select some tokens first!');
    return;
  }

  selectedTokens.forEach(token => {
    api.addCharacter(token);
  });

  api.show();
  ui.notifications.info(`Added ${selectedTokens.length} characters to conversation`);
};

// Macro 2: Quick NPC Setup
// Automatically finds common NPC tokens and adds them to conversation
const quickNPCSetup = () => {
  const api = game.modules.get('jrpg-conversation')?.api;
  if (!api) {
    ui.notifications.error('JRPG Conversation Display module not found!');
    return;
  }

  // Common NPC names to look for (customize this list)
  const npcNames = [
    'Shopkeeper', 'Merchant', 'Guard', 'Captain', 'Elder', 'Mayor',
    'Barkeep', 'Innkeeper', 'Priest', 'Wizard', 'Scholar', 'Noble'
  ];

  const foundTokens = canvas.tokens.placeables.filter(token => {
    const name = token.document.name.toLowerCase();
    return npcNames.some(npcName => name.includes(npcName.toLowerCase()));
  });

  if (foundTokens.length === 0) {
    ui.notifications.warn('No matching NPCs found on the scene');
    return;
  }

  foundTokens.forEach(token => {
    api.addCharacter(token);
  });

  api.show();
  ui.notifications.info(`Added ${foundTokens.length} NPCs to conversation`);
};

// Macro 3: Rotate Speaker
// Cycles through characters in conversation, setting next one as speaker
const rotateSpeaker = () => {
  const api = game.modules.get('jrpg-conversation')?.api;
  if (!api) {
    ui.notifications.error('JRPG Conversation Display module not found!');
    return;
  }

  const characters = api.display.getCharacters();
  if (characters.length === 0) {
    ui.notifications.warn('No characters in conversation');
    return;
  }

  const currentSpeaker = api.display.getCurrentSpeaker();
  let nextIndex = 0;

  if (currentSpeaker) {
    const currentIndex = characters.findIndex(char => char.id === currentSpeaker.id);
    nextIndex = (currentIndex + 1) % characters.length;
  }

  const nextSpeaker = characters[nextIndex];
  api.setSpeaker(nextSpeaker.id);
  
  ui.notifications.info(`${nextSpeaker.name} is now speaking`);
};

// Macro 4: Random Speaker
// Sets a random character as the current speaker
const randomSpeaker = () => {
  const api = game.modules.get('jrpg-conversation')?.api;
  if (!api) {
    ui.notifications.error('JRPG Conversation Display module not found!');
    return;
  }

  const characters = api.display.getCharacters();
  if (characters.length === 0) {
    ui.notifications.warn('No characters in conversation');
    return;
  }

  const randomIndex = Math.floor(Math.random() * characters.length);
  const randomCharacter = characters[randomIndex];
  
  api.setSpeaker(randomCharacter.id);
  ui.notifications.info(`${randomCharacter.name} is now speaking`);
};

// Macro 5: Save Conversation State
// Saves current conversation to a journal entry for later restoration
const saveConversationState = async () => {
  const api = game.modules.get('jrpg-conversation')?.api;
  if (!api || !game.user.isGM) {
    ui.notifications.error('GM access required for saving conversation states');
    return;
  }

  const conversationData = api.display.exportConversation();
  if (conversationData.characters.length === 0) {
    ui.notifications.warn('No conversation to save');
    return;
  }

  const sceneName = canvas.scene?.name || 'Unknown Scene';
  const timestamp = new Date().toLocaleString();
  
  const journalData = {
    name: `Conversation State - ${sceneName}`,
    content: `
      <h2>Saved Conversation State</h2>
      <p><strong>Scene:</strong> ${sceneName}</p>
      <p><strong>Saved:</strong> ${timestamp}</p>
      <p><strong>Characters:</strong> ${conversationData.characters.length}</p>
      <div style="display: none;" id="conversation-data">${JSON.stringify(conversationData)}</div>
      <p><em>Use the "Load Conversation State" macro to restore this conversation.</em></p>
    `
  };

  await JournalEntry.create(journalData);
  ui.notifications.info('Conversation state saved to journal');
};

// Macro 6: Load Conversation State  
// Loads a conversation state from a journal entry
const loadConversationState = async () => {
  const api = game.modules.get('jrpg-conversation')?.api;
  if (!api || !game.user.isGM) {
    ui.notifications.error('GM access required for loading conversation states');
    return;
  }

  // Find journal entries with conversation data
  const conversationJournals = game.journal.filter(journal => 
    journal.name.startsWith('Conversation State -') && 
    journal.content.includes('conversation-data')
  );

  if (conversationJournals.length === 0) {
    ui.notifications.warn('No saved conversation states found');
    return;
  }

  // Simple selection (use first found, or extend this for a dialog)
  const journal = conversationJournals[0];
  const dataElement = $(journal.content).find('#conversation-data');
  
  if (dataElement.length === 0) {
    ui.notifications.error('Invalid conversation data format');
    return;
  }

  try {
    const conversationData = JSON.parse(dataElement.text());
    await api.display.importConversation(conversationData);
    ui.notifications.info(`Loaded conversation state: ${journal.name}`);
  } catch (error) {
    console.error('Failed to load conversation state:', error);
    ui.notifications.error('Failed to load conversation state');
  }
};

// Macro 7: Clear and Reset
// Completely clears conversation and closes display
const clearAndReset = () => {
  const api = game.modules.get('jrpg-conversation')?.api;
  if (!api) {
    ui.notifications.error('JRPG Conversation Display module not found!');
    return;
  }

  api.clear();
  api.hide();
  ui.notifications.info('Conversation cleared and display hidden');
};

// Export functions for use (if running as a module)
// In Foundry macros, you would copy individual functions as needed
if (typeof module !== 'undefined') {
  module.exports = {
    addSelectedToConversation,
    quickNPCSetup,
    rotateSpeaker,
    randomSpeaker,
    saveConversationState,
    loadConversationState,
    clearAndReset
  };
}

/* 
MACRO CREATION INSTRUCTIONS:
1. Go to Macro Directory in Foundry
2. Create New Macro
3. Set Type to "Script"
4. Copy one of the functions above into the macro
5. Save with an appropriate name

Example Macro Names:
- "Add Selected to Conversation"
- "Quick NPC Setup"
- "Rotate Speaker"
- "Random Speaker"
- "Save Conversation"
- "Load Conversation"
- "Clear Conversation"
*/