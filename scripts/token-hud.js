import { MODULE_ID } from './constants.js';
import { conversationDisplay } from './conversation-display.js';
import { openDialogueHub } from './dialogue-hub.js';
import { applyTheme } from './theme.js';

/**
 * The single Token HUD extension for the module (GM only): quick buttons for
 * the conversation strip plus one button opening the Dialogue Hub.
 */
export function registerTokenHudSettings() {
    game.settings.register(MODULE_ID, 'hudPosition', {
        name: 'Conversation Button Position',
        hint: 'Where the conversation buttons appear relative to the token HUD',
        scope: 'client',
        config: true,
        type: String,
        choices: {
            'bottom': 'Below HUD',
            'bottom-far': 'Far Below HUD (extra spacing)',
            'top': 'Above HUD',
            'left': 'Left of HUD',
            'right': 'Right of HUD'
        },
        default: 'bottom'
    });
}

function makeHudButton(icon, title, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `icv-hud-btn ${className || ''}`;
    button.title = title;
    button.innerHTML = `<i class="${icon}"></i>`;
    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            onClick();
        } catch (err) {
            console.error(`${MODULE_ID} | HUD button error`, err);
            ui.notifications.error('Error executing action');
        }
    });
    return button;
}

export function registerTokenHudHook() {
    Hooks.on('renderTokenHUD', (hud, html, data) => {
        if (!game.user.isGM) return;
        const token = hud.object ?? canvas.tokens.get(data._id);
        if (!token) return;

        // v13 passes an HTMLElement; older versions pass jQuery.
        const hudElement = html instanceof HTMLElement ? html : html[0];
        hudElement.querySelector('.icv-hud')?.remove();

        const container = document.createElement('div');
        container.className = `icv-hud position-${game.settings.get(MODULE_ID, 'hudPosition')}`;
        applyTheme(container);

        const closeHud = () => hud.clear();

        if (!conversationDisplay.hasCharacter(token.id)) {
            container.appendChild(makeHudButton('fas fa-plus', 'Add to Conversation', 'add', () => {
                conversationDisplay.addCharacter(token);
                closeHud();
            }));
        } else {
            container.appendChild(makeHudButton('fas fa-minus', 'Remove from Conversation', 'remove', () => {
                conversationDisplay.removeCharacter(token.id);
                closeHud();
            }));
            const isSpeaking = conversationDisplay.currentSpeaker === token.id;
            container.appendChild(makeHudButton(
                isSpeaking ? 'fas fa-microphone-slash' : 'fas fa-microphone',
                isSpeaking ? 'Stop Speaking' : 'Set as Speaker',
                isSpeaking ? 'speaker active' : 'speaker',
                () => {
                    if (isSpeaking) conversationDisplay.clearSpeaker();
                    else conversationDisplay.setSpeaker(token.id);
                    closeHud();
                }
            ));
        }

        container.appendChild(makeHudButton('fas fa-comments', 'Dialogue (tree, ambient, combat, groups)', 'dialogue', () => {
            openDialogueHub(token);
            closeHud();
        }));

        hudElement.appendChild(container);
    });
}
