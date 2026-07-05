import { MODULE_ID } from './constants.js';

/** Prefer token art over the actor avatar, skipping the default mystery-man. */
export function getTokenPortrait(token) {
    const tokenTexture = token?.document?.texture?.src;
    if (tokenTexture && tokenTexture !== 'icons/svg/mystery-man.svg') return tokenTexture;
    if (token?.actor?.img && token.actor.img !== 'icons/svg/mystery-man.svg') return token.actor.img;
    return 'icons/svg/mystery-man.svg';
}

export function stripHTML(text) {
    if (!text) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = text;
    return (tmp.textContent || '').trim();
}

export function escapeHTML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A random element of a non-empty array, or null. */
export function pickRandom(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Read a RollTable's result rows into an array of plain-text strings. Used only
 * by the one-time migration from table-based combat/ambient dialogue to inline
 * JSON lines. Looks the table up by id first, then by name; HTML in cells is
 * stripped. Returns [] when the table is missing or empty.
 */
export function tableToLines(tableIdOrName) {
    if (!tableIdOrName) return [];
    const table = game.tables?.get(tableIdOrName) || game.tables?.getName?.(tableIdOrName);
    if (!table) return [];
    const results = table.results?.contents ?? table.results ?? [];
    return results
        .map(r => stripHTML(r.text ?? r.description ?? r.name ?? ''))
        .filter(Boolean);
}

/** Distance between two tokens in scene units (feet), v13-safe with v11/12 fallback. */
export function tokenDistanceFeet(tokenA, tokenB) {
    try {
        if (canvas.grid.measurePath) {
            return canvas.grid.measurePath([tokenA.center, tokenB.center]).distance;
        }
        return canvas.grid.measureDistance(tokenA.center, tokenB.center);
    } catch (e) {
        console.error(`${MODULE_ID} | error measuring distance`, e);
        return Infinity;
    }
}

export function isTokenInRange(tokenA, tokenB, rangeInFeet) {
    return tokenDistanceFeet(tokenA, tokenB) <= rangeInFeet;
}

/** Tokens owned by a currently-connected non-GM player. */
export function getActivePlayerTokens() {
    const activePlayers = game.users.filter(u => !u.isGM && u.active);
    if (!activePlayers.length) return [];
    return canvas.tokens.placeables.filter(token => {
        if (!token?.actor) return false;
        return activePlayers.some(user =>
            token.document.testUserPermission?.(user, 'OWNER')
            || token.actor.testUserPermission?.(user, 'OWNER'));
    });
}

/** In-character chat style, across Foundry versions. */
function icChatStyle() {
    return CONST.CHAT_MESSAGE_STYLES?.IC ?? CONST.CHAT_MESSAGE_TYPES?.IC;
}

export async function postTokenChatMessage(token, content, flavor = null) {
    try {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ token: token.document }),
            content,
            style: icChatStyle(),
            ...(flavor ? { flavor } : {})
        });
    } catch (e) {
        console.error(`${MODULE_ID} | error posting chat message`, e);
    }
}

/**
 * Speech-bubble style floating text above a token. Single implementation shared
 * by ambient dialogue, combat dialogue and conversation groups. Local only —
 * callers broadcast via socket to show it on other clients.
 */
export function showFloatingText(token, text) {
    const plainText = stripHTML(text);
    if (!plainText || !canvas?.ready) return;

    const container = new PIXI.Container();
    container.zIndex = 1000;

    const floatingText = new PIXI.Text(plainText, {
        fontFamily: 'Signika, Arial, sans-serif',
        fontSize: 18,
        fontWeight: 'bold',
        fill: 0xFFFFFF,
        stroke: 0x000000,
        strokeThickness: 3,
        wordWrap: true,
        wordWrapWidth: 240,
        align: 'center'
    });
    floatingText.anchor.set(0.5, 0.5);

    const padding = 10;
    const background = new PIXI.Graphics();
    background.beginFill(0x1a1a1a, 0.85);
    background.drawRoundedRect(
        -(floatingText.width / 2 + padding), -(floatingText.height / 2 + padding),
        floatingText.width + padding * 2, floatingText.height + padding * 2, 6);
    background.endFill();

    container.addChild(background, floatingText);
    container.position.set(token.center.x, token.y - 40);

    const layer = canvas.interface ?? canvas.stage;
    layer.addChild(container);

    // Drift upward and fade out over the duration, then clean up.
    const duration = 5000;
    const startTime = Date.now();
    const startY = container.y;
    const animate = () => {
        const progress = Math.min((Date.now() - startTime) / duration, 1);
        container.y = startY - progress * 30;
        container.alpha = 1 - progress;
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            try {
                container.parent?.removeChild(container);
                container.destroy({ children: true });
            } catch (e) { /* already destroyed with the canvas */ }
        }
    };
    requestAnimationFrame(animate);
}
