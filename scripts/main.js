import { ConversationDisplay } from './conversation-display.js';

// Global reference to the conversation display
let conversationDisplay = null;

// Initialize the module
Hooks.once('init', () => {
  console.log('Intrinsic\'s Conversations | Initializing module');
  
  // Register module settings
  game.settings.register('intrinsics-conversations', 'displayPosition', {
    name: 'Display Position',
    hint: 'Choose where the conversation display appears on screen',
    scope: 'client',
    config: true,
    type: String,
    choices: {
      'bottom': 'Bottom',
      'top': 'Top',
      'left': 'Left',
      'right': 'Right'
    },
    default: 'bottom'
  });

  game.settings.register('intrinsics-conversations', 'displayOpacity', {
    name: 'Display Opacity',
    hint: 'Set the opacity of the conversation display (0-100)',
    scope: 'client',
    config: true,
    type: Number,
    range: {
      min: 10,
      max: 100,
      step: 5
    },
    default: 85
  });

  game.settings.register('intrinsics-conversations', 'portraitSize', {
    name: 'Portrait Size',
    hint: 'Size of the character portraits in pixels',
    scope: 'client',
    config: true,
    type: Number,
    range: {
      min: 50,
      max: 200,
      step: 10
    },
    default: 100
  });
});

// Initialize after Foundry is ready
Hooks.once('ready', () => {
  console.log('Intrinsic\'s Conversations | Module ready');
  
  // Show success notification
  ui.notifications.info('Intrinsic\'s Conversations loaded successfully!');
  
  // Create the conversation display instance
  conversationDisplay = new ConversationDisplay();
  
  // Register the display globally for easy access
  game.modules.get('intrinsics-conversations').api = {
    display: conversationDisplay,
    addCharacter: (token) => conversationDisplay.addCharacter(token),
    removeCharacter: (tokenId) => conversationDisplay.removeCharacter(tokenId),
    setSpeaker: (tokenId) => conversationDisplay.setSpeaker(tokenId),
    clearSpeaker: () => conversationDisplay.clearSpeaker(),
    show: () => conversationDisplay.render(true),
    hide: () => conversationDisplay.close(),
    clear: () => conversationDisplay.clearAll()
  };
  
  console.log('Intrinsic\'s Conversations | API registered');
});

// Handle right-click context menu on tokens
Hooks.on('getTokenContext', (html, contextOptions) => {
  console.log('Intrinsic\'s Conversations | Token context menu hook fired');
  
  contextOptions.push({
    name: 'Add to Conversation',
    icon: '<i class="fas fa-comments"></i>',
    condition: (li) => {
      const token = canvas.tokens.get(li.data('token-id'));
      return token && !conversationDisplay?.hasCharacter(token.id);
    },
    callback: (li) => {
      const token = canvas.tokens.get(li.data('token-id'));
      if (token && conversationDisplay) {
        conversationDisplay.addCharacter(token);
        if (!conversationDisplay.rendered) {
          conversationDisplay.render(true);
        }
      }
    }
  });

  contextOptions.push({
    name: 'Remove from Conversation',
    icon: '<i class="fas fa-comment-slash"></i>',
    condition: (li) => {
      const token = canvas.tokens.get(li.data('token-id'));
      return token && conversationDisplay?.hasCharacter(token.id);
    },
    callback: (li) => {
      const token = canvas.tokens.get(li.data('token-id'));
      if (token && conversationDisplay) {
        conversationDisplay.removeCharacter(token.id);
      }
    }
  });
});

// Handle scene controls for additional functionality
Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user.isGM && !game.settings.get('intrinsics-conversations', 'allowPlayers')) return;

  const tokenControls = controls.find(c => c.name === 'token');
  if (tokenControls) {
    tokenControls.tools.push({
      name: 'conversation-display',
      title: 'Toggle Conversation Display',
      icon: 'fas fa-comments',
      toggle: true,
      active: conversationDisplay?.rendered || false,
      onClick: (toggled) => {
        if (conversationDisplay) {
          if (toggled) {
            conversationDisplay.render(true);
          } else {
            conversationDisplay.close();
          }
        }
      }
    });
  }
});

// Handle token deletion
Hooks.on('deleteToken', (token) => {
  if (conversationDisplay) {
    conversationDisplay.removeCharacter(token.id);
  }
});

// Handle scene change
Hooks.on('canvasReady', () => {
  if (conversationDisplay) {
    conversationDisplay.clearAll();
  }
});

// Keybind support
Hooks.on('init', () => {
  game.keybindings.register('intrinsics-conversations', 'toggleDisplay', {
    name: 'Toggle Conversation Display',
    hint: 'Show or hide the conversation display window',
    editable: [
      {
        key: 'KeyC',
        modifiers: ['Control', 'Shift']
      }
    ],
    onDown: () => {
      if (conversationDisplay) {
        if (conversationDisplay.rendered) {
          conversationDisplay.close();
        } else {
          conversationDisplay.render(true);
        }
      }
    }
  });

  game.keybindings.register('intrinsics-conversations', 'clearConversation', {
    name: 'Clear Conversation',
    hint: 'Remove all characters from the conversation display',
    editable: [
      {
        key: 'KeyC',
        modifiers: ['Control', 'Shift', 'Alt']
      }
    ],
    onDown: () => {
      if (conversationDisplay) {
        conversationDisplay.clearAll();
      }
    }
  });
});