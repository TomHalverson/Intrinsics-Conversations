import { MODULE_ID } from './constants.js';

// Theme system mirroring Intrinsics Lorebook: a class on each UI root element
// re-points the --icv-* variables defined in the stylesheet. The 'auto' mode
// follows the Lorebook theme setting when that module is active.

const LOREBOOK_ID = 'intrinsics-lorebook';
export const THEMES = ['parchment', 'abyss', 'verdant', 'ember', 'void'];

export function registerThemeSetting() {
    game.settings.register(MODULE_ID, 'theme', {
        name: 'Theme',
        hint: 'Colour theme for the conversation UI. "Match Lorebook" follows the Intrinsics Lorebook theme when that module is enabled.',
        scope: 'client',
        config: true,
        type: String,
        choices: {
            auto: 'Match Lorebook',
            default: 'Default (slate & purple)',
            parchment: 'Parchment',
            abyss: 'Abyssal',
            verdant: 'Verdant',
            ember: 'Ember',
            void: 'Void'
        },
        default: 'auto',
        onChange: () => refreshOpenApps()
    });
}

function currentTheme() {
    let theme = game.settings.get(MODULE_ID, 'theme');
    if (theme === 'auto') {
        theme = 'default';
        if (game.modules.get(LOREBOOK_ID)?.active) {
            try {
                theme = game.settings.get(LOREBOOK_ID, 'theme');
            } catch (e) { /* Lorebook present but setting unavailable */ }
        }
    }
    return THEMES.includes(theme) ? theme : 'default';
}

/** Tag a UI root element with the app class and the active theme. */
export function applyTheme(element) {
    element.classList.add('icv-app');
    const theme = currentTheme();
    for (const t of THEMES) element.classList.toggle(`icv-theme-${t}`, t === theme);
}

/** Re-apply the theme to any UI currently on screen. */
export function refreshOpenApps() {
    for (const el of document.querySelectorAll('.icv-app')) applyTheme(el);
}
