import { MODULE_ID } from './constants.js';
import { getTokenPortrait } from './utils.js';
import { applyTheme } from './theme.js';

/**
 * The JRPG-style conversation strip: a row of token portraits at the bottom of
 * the screen with the current speaker highlighted. The GM is authoritative;
 * state is synced to players through a hidden world setting, which both pushes
 * live updates (onChange) and persists for players who connect mid-scene.
 */
class ConversationDisplay {
    constructor() {
        this.characters = new Map();
        this.currentSpeaker = null;
        this.element = null;
    }

    show() {
        if (this.element) return;
        this.element = document.createElement('div');
        this.element.id = 'intrinsics-conversation-display';
        this.element.className = 'icv-strip';
        applyTheme(this.element);
        document.body.appendChild(this.element);
        this.render();
    }

    hide() {
        this.element?.remove();
        this.element = null;
    }

    addCharacter(token) {
        this.characters.set(token.id, {
            id: token.id,
            name: token.document.name || 'Unknown',
            portrait: getTokenPortrait(token)
        });
        this.show();
        this.render();
        this.#broadcast();
    }

    removeCharacter(tokenId) {
        if (!this.characters.delete(tokenId)) return;
        if (this.currentSpeaker === tokenId) this.currentSpeaker = null;
        if (this.characters.size === 0) this.hide();
        this.render();
        this.#broadcast();
    }

    setSpeaker(tokenId) {
        if (!this.characters.has(tokenId)) return;
        this.currentSpeaker = tokenId;
        this.render();
        this.#broadcast();
    }

    clearSpeaker() {
        this.currentSpeaker = null;
        this.render();
        this.#broadcast();
    }

    clearAll() {
        this.characters.clear();
        this.currentSpeaker = null;
        this.hide();
        this.#broadcast();
    }

    hasCharacter(tokenId) {
        return this.characters.has(tokenId);
    }

    toJSON() {
        return {
            characters: Array.from(this.characters.values()),
            currentSpeaker: this.currentSpeaker,
            isVisible: !!this.element
        };
    }

    /** Player side: apply state received from the GM. */
    applyState(state) {
        this.characters.clear();
        for (const c of state?.characters ?? []) this.characters.set(c.id, c);
        this.currentSpeaker = state?.currentSpeaker ?? null;
        if (this.characters.size > 0 && state?.isVisible) {
            this.show();
            this.render();
        } else {
            this.hide();
        }
    }

    /** Player side: load persisted state once the world is ready. */
    loadFromSetting() {
        try {
            const state = JSON.parse(game.settings.get(MODULE_ID, 'conversationState') || '{}');
            if (state.characters) this.applyState(state);
        } catch (e) {
            console.error(`${MODULE_ID} | error loading conversation state`, e);
        }
    }

    #broadcast() {
        if (!game.user.isGM) return;
        game.settings.set(MODULE_ID, 'conversationState', JSON.stringify(this.toJSON()))
            .catch(e => console.error(`${MODULE_ID} | error broadcasting conversation state`, e));
    }

    render() {
        if (!this.element) return;
        const isGM = game.user.isGM;
        this.element.innerHTML = '';

        if (isGM) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'icv-strip-close';
            closeBtn.title = 'End Conversation';
            closeBtn.innerHTML = '<i class="fas fa-times"></i>';
            closeBtn.addEventListener('click', () => this.clearAll());
            this.element.appendChild(closeBtn);
        }

        const row = document.createElement('div');
        row.className = 'icv-strip-row';
        for (const character of this.characters.values()) {
            const speaking = this.currentSpeaker === character.id;
            const card = document.createElement('div');
            card.className = 'icv-strip-char' + (speaking ? ' speaking' : '') + (isGM ? ' gm' : '');
            card.innerHTML = `
                <div class="icv-strip-portrait">
                    <img src="${character.portrait}" alt="" />
                    ${speaking ? '<div class="icv-strip-bubble"><i class="fas fa-comment"></i></div>' : ''}
                </div>
                <div class="icv-strip-name"></div>
            `;
            card.querySelector('.icv-strip-name').textContent = character.name;
            if (isGM) {
                card.title = speaking ? 'Click to stop speaking' : 'Click to set as speaker';
                card.addEventListener('click', () => {
                    if (this.currentSpeaker === character.id) this.clearSpeaker();
                    else this.setSpeaker(character.id);
                });
            }
            row.appendChild(card);
        }
        this.element.appendChild(row);

        if (!isGM && this.characters.size > 0) {
            const hint = document.createElement('div');
            hint.className = 'icv-strip-hint';
            hint.textContent = 'Controlled by GM';
            this.element.appendChild(hint);
        }
    }
}

export const conversationDisplay = new ConversationDisplay();

export function registerConversationDisplaySettings() {
    game.settings.register(MODULE_ID, 'conversationState', {
        scope: 'world',
        config: false,
        type: String,
        default: '{}',
        onChange: (value) => {
            if (game.user.isGM) return; // the GM is the source of truth
            try {
                conversationDisplay.applyState(JSON.parse(value));
            } catch (e) {
                console.error(`${MODULE_ID} | error parsing conversation state`, e);
            }
        }
    });
}
