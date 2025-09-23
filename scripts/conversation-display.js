export class ConversationDisplay extends Application {
  constructor(options = {}) {
    super(options);
    
    // Store characters in the conversation
    this.characters = new Map();
    this.currentSpeaker = null;
    
    // Animation state
    this.animationFrameId = null;
    
    // Bind methods
    this.onCharacterClick = this.onCharacterClick.bind(this);
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: 'jrpg-conversation-display',
      template: null, // We'll build HTML dynamically
      popOut: false,
      minimizable: false,
      resizable: false,
      classes: ['jrpg-conversation-display'],
      zIndex: 100
    });
  }

  get title() {
    return 'JRPG Conversation Display';
  }

  getData() {
    return {
      characters: Array.from(this.characters.values()),
      currentSpeaker: this.currentSpeaker,
      position: game.settings.get('jrpg-conversation', 'displayPosition'),
      opacity: game.settings.get('jrpg-conversation', 'displayOpacity'),
      portraitSize: game.settings.get('jrpg-conversation', 'portraitSize')
    };
  }

  async _render(force = false, options = {}) {
    await super._render(force, options);
    
    if (this.element) {
      this.updateDisplay();
      this.positionDisplay();
    }
  }

  _getHeaderButtons() {
    const buttons = super._getHeaderButtons();
    
    // Clear all button
    buttons.unshift({
      label: 'Clear All',
      class: 'clear-conversation',
      icon: 'fas fa-trash',
      onclick: () => this.clearAll()
    });

    return buttons;
  }

  activateListeners(html) {
    super.activateListeners(html);
    
    // Character click handlers
    html.find('.conversation-character').on('click', this.onCharacterClick);
    html.find('.conversation-character').on('contextmenu', this.onCharacterRightClick.bind(this));
    
    // Handle settings changes
    Hooks.on('updateSetting', (setting) => {
      if (setting.key.startsWith('jrpg-conversation.')) {
        this.updateDisplay();
        this.positionDisplay();
      }
    });
  }

  async updateDisplay() {
    if (!this.element) return;

    const data = this.getData();
    const html = await this.generateHTML(data);
    
    this.element.html(html);
    this.activateListeners(this.element);
    
    // Apply styling based on settings
    this.element.css({
      'opacity': data.opacity / 100,
      '--portrait-size': `${data.portraitSize}px`
    });
    
    // Update position class
    this.element.removeClass('position-top position-bottom position-left position-right');
    this.element.addClass(`position-${data.position}`);
  }

  async generateHTML(data) {
    if (data.characters.length === 0) {
      return '<div class="conversation-empty">Right-click tokens to add them to the conversation</div>';
    }

    let html = '<div class="conversation-characters">';
    
    for (const character of data.characters) {
      const isCurrentSpeaker = this.currentSpeaker === character.id;
      const speakingClass = isCurrentSpeaker ? 'speaking' : '';
      const pulseClass = isCurrentSpeaker ? 'pulse-glow' : '';
      
      html += `
        <div class="conversation-character ${speakingClass} ${pulseClass}" 
             data-character-id="${character.id}"
             title="${character.name}">
          <div class="character-portrait">
            <img src="${character.portrait}" alt="${character.name}" />
            <div class="character-border"></div>
            ${isCurrentSpeaker ? '<div class="speaker-indicator"><i class="fas fa-comment"></i></div>' : ''}
          </div>
          <div class="character-name">${character.name}</div>
        </div>
      `;
    }
    
    html += '</div>';
    
    return html;
  }

  positionDisplay() {
    if (!this.element) return;
    
    const position = game.settings.get('jrpg-conversation', 'displayPosition');
    const element = this.element[0];
    
    // Reset positioning
    element.style.position = 'fixed';
    element.style.top = 'auto';
    element.style.bottom = 'auto';
    element.style.left = 'auto';
    element.style.right = 'auto';
    element.style.transform = 'none';
    
    switch (position) {
      case 'bottom':
        element.style.bottom = '20px';
        element.style.left = '50%';
        element.style.transform = 'translateX(-50%)';
        break;
      case 'top':
        element.style.top = '20px';
        element.style.left = '50%';
        element.style.transform = 'translateX(-50%)';
        break;
      case 'left':
        element.style.left = '20px';
        element.style.top = '50%';
        element.style.transform = 'translateY(-50%)';
        break;
      case 'right':
        element.style.right = '20px';
        element.style.top = '50%';
        element.style.transform = 'translateY(-50%)';
        break;
    }
  }

  onCharacterClick(event) {
    event.preventDefault();
    const characterId = event.currentTarget.dataset.characterId;
    
    if (this.currentSpeaker === characterId) {
      // If clicking the current speaker, clear the speaker
      this.clearSpeaker();
    } else {
      // Set new speaker
      this.setSpeaker(characterId);
    }
  }

  onCharacterRightClick(event) {
    event.preventDefault();
    const characterId = event.currentTarget.dataset.characterId;
    
    // Create context menu
    new ContextMenu($(event.currentTarget), '.conversation-character', [
      {
        name: 'Remove from Conversation',
        icon: '<i class="fas fa-times"></i>',
        callback: () => this.removeCharacter(characterId)
      },
      {
        name: 'Set as Speaker',
        icon: '<i class="fas fa-comment"></i>',
        callback: () => this.setSpeaker(characterId)
      }
    ]);
  }

  addCharacter(token) {
    if (!token) return;
    
    try {
      // Get token data
      const character = {
        id: token.id,
        name: token.document.name || 'Unknown',
        portrait: this.getTokenPortrait(token),
        token: token
      };
      
      this.characters.set(token.id, character);
      
      console.log(`JRPG Conversation | Added character: ${character.name}`);
      
      // Update display if rendered
      if (this.rendered) {
        this.updateDisplay();
      }
      
      // Show notification
      ui.notifications.info(`Added ${character.name} to conversation`);
      
    } catch (error) {
      console.error('JRPG Conversation | Error adding character:', error);
      ui.notifications.error('Failed to add character to conversation');
    }
  }

  removeCharacter(tokenId) {
    const character = this.characters.get(tokenId);
    if (!character) return;
    
    this.characters.delete(tokenId);
    
    // Clear speaker if this was the current speaker
    if (this.currentSpeaker === tokenId) {
      this.currentSpeaker = null;
    }
    
    console.log(`JRPG Conversation | Removed character: ${character.name}`);
    
    // Update display
    if (this.rendered) {
      this.updateDisplay();
    }
    
    // Close if no characters left
    if (this.characters.size === 0) {
      this.close();
    }
    
    ui.notifications.info(`Removed ${character.name} from conversation`);
  }

  setSpeaker(tokenId) {
    const character = this.characters.get(tokenId);
    if (!character) return;
    
    this.currentSpeaker = tokenId;
    
    console.log(`JRPG Conversation | Set speaker: ${character.name}`);
    
    // Update display
    if (this.rendered) {
      this.updateDisplay();
    }
    
    // Optional: Send chat message
    if (game.user.isGM) {
      ChatMessage.create({
        content: `<em>${character.name} is now speaking</em>`,
        whisper: [game.user.id]
      });
    }
  }

  clearSpeaker() {
    if (this.currentSpeaker) {
      const character = this.characters.get(this.currentSpeaker);
      console.log(`JRPG Conversation | Cleared speaker: ${character?.name || 'Unknown'}`);
    }
    
    this.currentSpeaker = null;
    
    if (this.rendered) {
      this.updateDisplay();
    }
  }

  clearAll() {
    const count = this.characters.size;
    this.characters.clear();
    this.currentSpeaker = null;
    
    console.log(`JRPG Conversation | Cleared all characters (${count})`);
    
    if (this.rendered) {
      this.close();
    }
    
    if (count > 0) {
      ui.notifications.info(`Cleared ${count} character(s) from conversation`);
    }
  }

  hasCharacter(tokenId) {
    return this.characters.has(tokenId);
  }

  getTokenPortrait(token) {
    // Try to get the actor portrait first, then fall back to token image
    if (token.actor?.img && token.actor.img !== 'icons/svg/mystery-man.svg') {
      return token.actor.img;
    }
    
    // Try token document texture source
    if (token.document?.texture?.src) {
      return token.document.texture.src;
    }
    
    // Fallback to token image
    return token.document?.img || token.img || 'icons/svg/mystery-man.svg';
  }

  async close(options = {}) {
    // Clean up any animations
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    
    await super.close(options);
  }

  // API methods for external use
  getCharacters() {
    return Array.from(this.characters.values());
  }

  getCurrentSpeaker() {
    return this.currentSpeaker ? this.characters.get(this.currentSpeaker) : null;
  }

  // Import/Export functionality for saving conversation states
  exportConversation() {
    return {
      characters: Array.from(this.characters.entries()).map(([id, char]) => ({
        id,
        name: char.name,
        portrait: char.portrait
      })),
      currentSpeaker: this.currentSpeaker
    };
  }

  async importConversation(data) {
    this.clearAll();
    
    for (const charData of data.characters) {
      const token = canvas.tokens.get(charData.id);
      if (token) {
        this.addCharacter(token);
      }
    }
    
    if (data.currentSpeaker && this.characters.has(data.currentSpeaker)) {
      this.setSpeaker(data.currentSpeaker);
    }
    
    if (this.characters.size > 0 && !this.rendered) {
      this.render(true);
    }
  }
}