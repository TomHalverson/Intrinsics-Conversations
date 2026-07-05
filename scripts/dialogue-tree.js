import { MODULE_ID, FLAGS, PF2E_SKILLS, RUMOUR_NODE_ID, DEFAULT_RUMOUR_PROMPT, VISITED_PREFIX } from './constants.js';
import { getTokenPortrait, escapeHTML } from './utils.js';
import { applyTheme } from './theme.js';
import { emitSocket, onSocket } from './socket.js';

export const EXAMPLE_TREE = {
    startNodeId: "start",
    nodes: {
        start: {
            speakerText: "Hello, traveler. What brings you to our village?",
            choices: [
                { text: "I'm looking for adventure.", nextNodeId: "adventure" },
                { text: "Convince the guard to let me pass.",
                  check: { skill: "diplomacy", dc: 15 },
                  nextNodeId: "convinced",
                  failNodeId: "rebuffed" },
                { text: "Just passing through.", nextNodeId: "passing" },
                { text: "[Leave]", nextNodeId: null }
            ]
        },
        adventure: {
            speakerText: "Adventure, eh? The old ruins to the north have been stirring lately.",
            choices: [
                { text: "Tell me more about the ruins.", nextNodeId: "ruins" },
                { text: "Thanks, I'll check it out.", nextNodeId: null }
            ]
        },
        passing: {
            speakerText: "Safe travels then.",
            choices: []
        },
        ruins: {
            speakerText: "Goblins moved in last spring. Townsfolk hear strange noises at night.",
            choices: [
                { text: "I'll investigate.", nextNodeId: null }
            ]
        },
        convinced: {
            speakerText: "Hah, you have a silver tongue. Go on then.",
            choices: [{ text: "Thank you.", nextNodeId: null }]
        },
        rebuffed: {
            speakerText: "Save your breath, stranger. Move along.",
            choices: [{ text: "Fine.", nextNodeId: null }]
        }
    }
};

// Minimal greeting-only tree for the "Rumour Starter" button. Pair it with the
// rumours toggle and a RollTable name and the "Ask about any rumours" choice is
// injected automatically between the greeting and [Leave].
export const RUMOUR_STARTER_TREE = {
    startNodeId: "start",
    nodes: {
        start: {
            speakerText: "Well met. What can I do for you?",
            choices: [
                { text: "[Leave]", nextNodeId: null }
            ]
        }
    }
};

export function registerDialogueTreeSettings() {
    game.settings.register(MODULE_ID, 'dialogueGmEcho', {
        name: 'GM Dialogue Echo',
        hint: 'Report the choices players pick in right-click dialogues as a GM-whispered chat summary.',
        scope: 'world', config: true, type: String,
        choices: {
            off: 'Off',
            summary: 'Chat summary (whispered to GMs)'
        },
        default: 'summary'
    });
}

/**
 * GM-side socket handlers. Players can't write flags on unowned NPC actors, so
 * dialogue state updates are relayed through the active GM client; choice picks
 * are echoed to the GM as a whispered chat summary when dialogueGmEcho is on.
 */
export function registerDialogueTreeSocket() {
    onSocket('dialogueStateUpdate', async (data, senderId) => {
        if (game.user !== game.users.activeGM) return;
        if (!data?.actorId || !data?.state || data.userId !== senderId) return;
        const actor = game.actors.get(data.actorId);
        if (!actor) return;
        try {
            await actor.setFlag(MODULE_ID, `${FLAGS.DIALOGUE_STATE}.${data.userId}`, data.state);
        } catch (e) {
            console.error(`${MODULE_ID} | failed to relay dialogue state`, e);
        }
    });

    onSocket('dialogueProgress', (data, senderId) => {
        if (game.user !== game.users.activeGM) return;
        if (game.settings.get(MODULE_ID, 'dialogueGmEcho') === 'off') return;
        const user = game.users.get(senderId);
        if (!user || user.isGM) return;
        const speaker = user.character?.name ?? user.name;
        const outcome = data?.outcome ? ` <em>(${escapeHTML(data.outcome)})</em>` : '';
        ChatMessage.create({
            content: `<span class="icv-gm-echo">${escapeHTML(speaker)} → ${escapeHTML(data?.npcName || 'NPC')}: `
                + `“${escapeHTML(data?.choiceText || '')}”${outcome}</span>`,
            whisper: game.users.filter(u => u.isGM).map(u => u.id)
        }).catch(e => console.error(`${MODULE_ID} | failed to post GM echo`, e));
    });
}

/**
 * Evaluate a node/choice condition against a player's dialogue state. A
 * condition is { flag, value? } or a list of them (AND). value defaults to
 * true; expecting false also matches "flag never set". Flags starting with
 * "__visited__:" test the visited-node memory instead.
 */
export function evaluateCondition(condition, state) {
    if (condition == null || !state) return true;
    const list = Array.isArray(condition) ? condition : [condition];
    return list.every(c => {
        if (!c || typeof c.flag !== 'string' || !c.flag) return true;
        const expected = c.value === undefined ? true : c.value;
        const actual = c.flag.startsWith(VISITED_PREFIX)
            ? state.visited.includes(c.flag.slice(VISITED_PREFIX.length))
            : state.flags[c.flag];
        if (expected === false) return actual === false || actual == null;
        return actual === expected;
    });
}

export function getTreeForToken(token) {
    const actor = token?.actor;
    if (!actor) return null;
    if (!actor.getFlag(MODULE_ID, FLAGS.TREE_ENABLED)) return null;
    const tree = actor.getFlag(MODULE_ID, FLAGS.TREE);
    if (!tree?.nodes || !tree.startNodeId) return null;
    return tree;
}

// If the actor has the rumours toggle on, return a clone of the tree with an
// "Ask about any rumours" choice injected into the start node and a synthetic
// rumour node appended. Returns the original tree untouched otherwise.
function augmentTreeWithRumours(tree, actor) {
    if (!actor?.getFlag?.(MODULE_ID, FLAGS.RUMOURS_ENABLED)) return tree;

    const tableName = actor.getFlag(MODULE_ID, FLAGS.RUMOUR_TABLE);
    const inlineList = actor.getFlag(MODULE_ID, FLAGS.RUMOUR_LIST);
    const hasSource = (typeof tableName === 'string' && tableName.trim())
        || (Array.isArray(inlineList) && inlineList.length);
    if (!hasSource) return tree;  // toggle on but nothing to draw from — skip.

    const clone = structuredClone(tree);
    const startNode = clone.nodes[clone.startNodeId];
    if (!startNode) return tree;
    if (!Array.isArray(startNode.choices)) startNode.choices = [];

    const promptRaw = actor.getFlag(MODULE_ID, FLAGS.RUMOUR_PROMPT);
    const prompt = (typeof promptRaw === 'string' && promptRaw.trim()) ? promptRaw.trim() : DEFAULT_RUMOUR_PROMPT;
    const leadIn = actor.getFlag(MODULE_ID, FLAGS.RUMOUR_LEADIN);

    // Build the synthetic rumour node. "Tell me another" self-loops to re-draw.
    clone.nodes[RUMOUR_NODE_ID] = {
        speakerText: (typeof leadIn === 'string') ? leadIn : '',
        ...(typeof tableName === 'string' && tableName.trim() ? { rumourTable: tableName.trim() } : {}),
        ...(Array.isArray(inlineList) && inlineList.length ? { rumours: inlineList } : {}),
        choices: [
            { text: 'Tell me another.', nextNodeId: RUMOUR_NODE_ID },
            { text: '[Back]', nextNodeId: clone.startNodeId }
        ]
    };

    // Insert the prompt choice before a trailing "leave" option, if present.
    const rumourChoice = { text: prompt, nextNodeId: RUMOUR_NODE_ID };
    const last = startNode.choices[startNode.choices.length - 1];
    if (last && (last.nextNodeId == null || last.nextNodeId === '') && !last.check) {
        startNode.choices.splice(startNode.choices.length - 1, 0, rumourChoice);
    } else {
        startNode.choices.push(rumourChoice);
    }
    return clone;
}

/** Shared shape check for node/choice conditions. Returns an error string or null. */
function conditionError(condition, where) {
    const list = Array.isArray(condition) ? condition : [condition];
    for (const c of list) {
        if (!c || typeof c !== 'object' || typeof c.flag !== 'string' || !c.flag.trim()) {
            return `${where} condition must be { flag, value? } or a list of them`;
        }
    }
    return null;
}

export function validateTree(tree) {
    if (!tree || typeof tree !== 'object') return { ok: false, error: 'tree must be an object' };
    if (!tree.startNodeId) return { ok: false, error: 'missing startNodeId' };
    if (!tree.nodes || typeof tree.nodes !== 'object') return { ok: false, error: 'missing nodes object' };
    if (!tree.nodes[tree.startNodeId]) {
        return { ok: false, error: `startNodeId "${tree.startNodeId}" not found in nodes` };
    }
    for (const [id, node] of Object.entries(tree.nodes)) {
        if (typeof node.speakerText !== 'string') {
            return { ok: false, error: `node "${id}" missing speakerText (must be a string)` };
        }
        if (node.choices != null && !Array.isArray(node.choices)) {
            return { ok: false, error: `node "${id}" choices must be an array` };
        }
        if (node.rumours != null) {
            if (!Array.isArray(node.rumours)) {
                return { ok: false, error: `node "${id}" rumours must be an array of strings` };
            }
            for (const [i, r] of node.rumours.entries()) {
                if (typeof r !== 'string' && typeof r?.text !== 'string') {
                    return { ok: false, error: `node "${id}" rumour ${i} must be a string` };
                }
            }
        }
        if (node.rumourTable != null && typeof node.rumourTable !== 'string') {
            return { ok: false, error: `node "${id}" rumourTable must be a RollTable name (string)` };
        }
        if (node.condition != null) {
            const err = conditionError(node.condition, `node "${id}"`);
            if (err) return { ok: false, error: err };
        }
        if (node.fallbackNodeId != null && !tree.nodes[node.fallbackNodeId]) {
            return { ok: false, error: `node "${id}" fallbackNodeId "${node.fallbackNodeId}" not found` };
        }
        for (const [i, choice] of (node.choices || []).entries()) {
            if (typeof choice.text !== 'string') {
                return { ok: false, error: `node "${id}" choice ${i} missing text` };
            }
            if (choice.nextNodeId != null && !tree.nodes[choice.nextNodeId]) {
                return { ok: false, error: `node "${id}" choice ${i} points to missing node "${choice.nextNodeId}"` };
            }
            if (choice.condition != null) {
                const err = conditionError(choice.condition, `node "${id}" choice ${i}`);
                if (err) return { ok: false, error: err };
            }
            if (choice.setFlags != null) {
                if (typeof choice.setFlags !== 'object' || Array.isArray(choice.setFlags)) {
                    return { ok: false, error: `node "${id}" choice ${i} setFlags must be an object of flag → value` };
                }
                for (const [flag, value] of Object.entries(choice.setFlags)) {
                    if (value !== null && ['object', 'function'].includes(typeof value)) {
                        return { ok: false, error: `node "${id}" choice ${i} setFlags "${flag}" must be a boolean, number or string` };
                    }
                }
            }
            if (choice.once != null && typeof choice.once !== 'boolean') {
                return { ok: false, error: `node "${id}" choice ${i} "once" must be true or false` };
            }
            if (choice.revealLore != null) {
                const list = Array.isArray(choice.revealLore) ? choice.revealLore : [choice.revealLore];
                if (!list.length || !list.every(t => typeof t === 'string' && t.trim())) {
                    return { ok: false, error: `node "${id}" choice ${i} revealLore must be a non-empty string or list of strings` };
                }
            }
            if (choice.check) {
                if (!PF2E_SKILLS.includes(String(choice.check.skill).toLowerCase())) {
                    return { ok: false, error: `node "${id}" choice ${i} has invalid skill "${choice.check.skill}"` };
                }
                if (!Number.isFinite(Number(choice.check.dc))) {
                    return { ok: false, error: `node "${id}" choice ${i} skill check missing numeric DC` };
                }
                if (choice.failNodeId != null && !tree.nodes[choice.failNodeId]) {
                    return { ok: false, error: `node "${id}" choice ${i} failNodeId "${choice.failNodeId}" not found` };
                }
                if (choice.critNodeId != null && !tree.nodes[choice.critNodeId]) {
                    return { ok: false, error: `node "${id}" choice ${i} critNodeId "${choice.critNodeId}" not found` };
                }
                if (choice.fumbleNodeId != null && !tree.nodes[choice.fumbleNodeId]) {
                    return { ok: false, error: `node "${id}" choice ${i} fumbleNodeId "${choice.fumbleNodeId}" not found` };
                }
            } else if (choice.critNodeId !== undefined || choice.fumbleNodeId !== undefined) {
                return { ok: false, error: `node "${id}" choice ${i} has crit/fumble targets but no skill check` };
            }
        }
    }
    return { ok: true };
}

/**
 * Append a line to the Intrinsics Lorebook session log, if that module is
 * present. Soft dependency: a no-op when the Lorebook isn't installed/active.
 * The Lorebook relays player calls to a GM, so this is safe from any client.
 */
function logToSession(msg, kind = 'reveal') {
    if (!msg) return;
    const api = game.modules.get('intrinsics-lorebook')?.api;
    if (!api?.log?.add) return;
    try {
        api.log.add(msg, kind);
    } catch (e) {
        console.error(`${MODULE_ID} | failed to write session log`, e);
    }
}

/**
 * The player-facing CRPG-style dialogue window. Choices can be picked with the
 * mouse or the 1–9 number keys; Escape ends the conversation.
 */
class DialogueRuntime {
    constructor() {
        this.element = null;
        this.currentTree = null;
        this.currentNodeId = null;
        this.token = null;
        // Per-player dialogue memory for the current actor: { flags, visited, chosen }.
        this.state = null;
        // Locks each "<nodeId>:<choiceIdx>" once its skill check has been rolled.
        this.attemptedChecks = new Set();
    }

    start(token, tree, startNodeId = null) {
        const startId = startNodeId || tree?.startNodeId;
        if (!tree?.nodes?.[startId]) {
            ui.notifications.error("Dialogue tree is invalid (missing start node).");
            return;
        }
        this.token = token;
        this.currentTree = augmentTreeWithRumours(tree, token?.actor);
        this.state = this.loadState(token?.actor);
        this.attemptedChecks.clear();
        const resolved = this.resolveNodeId(startId);
        if (resolved == null) {
            // Start node's condition failed with no fallback to land on.
            ui.notifications.info(`${token?.document?.name ?? 'This NPC'} has nothing to say right now.`);
            this.currentTree = null;
            this.token = null;
            this.state = null;
            return;
        }
        this.currentNodeId = resolved;
        this.show();
        this.renderNode();

        // Record that a player opened this conversation. GMs trigger start() to
        // preview/test trees, so only players' conversations are logged.
        if (!game.user.isGM) {
            const speaker = game.user.character?.name ?? game.user.name;
            const npc = token?.document?.name ?? token?.actor?.name ?? 'an NPC';
            logToSession(`${speaker} spoke with ${npc}.`);
        }
    }

    // -- Per-player dialogue state ------------------------------------------

    loadState(actor) {
        const all = actor?.getFlag?.(MODULE_ID, FLAGS.DIALOGUE_STATE) || {};
        const mine = all[game.user.id];
        return {
            flags: { ...(mine?.flags || {}) },
            visited: Array.isArray(mine?.visited) ? [...mine.visited] : [],
            chosen: Array.isArray(mine?.chosen) ? [...mine.chosen] : []
        };
    }

    /**
     * Persist this player's state onto the actor. GMs write directly; players
     * relay through the active GM via socket. With no GM connected the state
     * stays local to this session.
     */
    persistState() {
        const actor = this.token?.actor;
        if (!actor || !this.state) return;
        if (game.user.isGM) {
            actor.setFlag(MODULE_ID, `${FLAGS.DIALOGUE_STATE}.${game.user.id}`, this.state)
                .catch(e => console.error(`${MODULE_ID} | failed to save dialogue state`, e));
        } else if (game.users.activeGM) {
            emitSocket('dialogueStateUpdate', {
                actorId: actor.id,
                userId: game.user.id,
                state: this.state
            });
        }
    }

    markVisited(nodeId) {
        if (!this.state || nodeId.startsWith('__')) return; // skip synthetic nodes
        if (this.state.visited.includes(nodeId)) return;
        this.state.visited.push(nodeId);
        this.persistState();
    }

    applyChoiceEffects(choice, origIdx) {
        if (!this.state) return;
        let changed = false;
        if (choice.setFlags && typeof choice.setFlags === 'object') {
            Object.assign(this.state.flags, choice.setFlags);
            changed = true;
        }
        const key = `${this.currentNodeId}:${origIdx}`;
        if (choice.once && !this.state.chosen.includes(key)) {
            this.state.chosen.push(key);
            changed = true;
        }
        if (changed) this.persistState();

        // Reveal Lorebook entries tied to this choice. The Lorebook dedupes and
        // records each reveal in the session log itself, so no logging here.
        if (choice.revealLore != null) {
            const api = game.modules.get('intrinsics-lorebook')?.api;
            if (api?.lore?.reveal) {
                const targets = Array.isArray(choice.revealLore) ? choice.revealLore : [choice.revealLore];
                for (const target of targets) {
                    if (typeof target === 'string' && target.trim()) {
                        Promise.resolve(api.lore.reveal(target.trim()))
                            .catch(e => console.error(`${MODULE_ID} | lore reveal failed`, e));
                    }
                }
            }
        }
    }

    /**
     * Follow a node's condition/fallback chain to the node that should actually
     * be shown. Returns null when the chain dead-ends (treated as conversation
     * end), or the last id unchanged when the node simply doesn't exist (the
     * missing-node error surfaces in renderNode).
     */
    resolveNodeId(nodeId) {
        let id = nodeId;
        for (let guard = 0; guard < 20; guard++) {
            const node = this.currentTree?.nodes?.[id];
            if (!node) return id;
            if (evaluateCondition(node.condition, this.state)) return id;
            const fallback = node.fallbackNodeId;
            if (fallback == null || fallback === '' || fallback === id) return null;
            id = fallback;
        }
        return null;
    }

    /** Navigate to a target node id (null/'' ends the conversation). */
    goTo(targetId) {
        if (targetId == null || targetId === '') {
            this.end();
            return;
        }
        const resolved = this.resolveNodeId(targetId);
        if (resolved == null) {
            this.end();
            return;
        }
        this.currentNodeId = resolved;
        this.renderNode();
    }

    /** Echo a picked choice to the GM (chat summary), if one is connected. */
    emitProgress(choice, degree) {
        if (game.user.isGM || !game.users.activeGM) return;
        const outcomes = ['Critical failure', 'Failure', 'Success', 'Critical success'];
        let outcome = null;
        if (degree != null && choice.check) {
            outcome = outcomes[degree] ?? null;
            if (outcome && choice.check.secret) outcome += ', secret roll';
        }
        emitSocket('dialogueProgress', {
            tokenId: this.token?.id,
            npcName: this.token?.document?.name ?? this.token?.actor?.name ?? 'NPC',
            nodeId: this.currentNodeId,
            choiceText: choice.text || '',
            outcome
        });
    }

    /** Record a skill check made during the conversation in the session log. */
    logCheck(choice, degree) {
        if (game.user.isGM || !choice.check || degree == null) return;
        const outcomes = ['critically fails', 'fails', 'succeeds at', 'critically succeeds at'];
        const result = outcomes[degree] ?? 'attempts';
        const speaker = game.user.character?.name ?? game.user.name;
        const npc = this.token?.document?.name ?? this.token?.actor?.name ?? 'an NPC';
        const skill = String(choice.check.skill || '');
        const skillLabel = skill.charAt(0).toUpperCase() + skill.slice(1);
        logToSession(
            `${speaker} ${result} a ${skillLabel} check (DC ${choice.check.dc}) talking to ${npc}.`
        );
    }

    show() {
        if (this.element) this.hide();
        const el = document.createElement('div');
        el.id = 'intrinsics-dialogue-modal';
        applyTheme(el);
        el.innerHTML = `
            <div class="idm-backdrop"></div>
            <div class="idm-panel">
                <button class="idm-close" title="Close (Esc)">&times;</button>
                <div class="idm-header">
                    <div class="idm-portrait-wrap"><img class="idm-portrait" alt="" /></div>
                    <div class="idm-name"></div>
                </div>
                <div class="idm-text"></div>
                <div class="idm-choices"></div>
                <div class="idm-hint">Press 1–9 to choose · Esc to leave</div>
            </div>
        `;
        document.body.appendChild(el);
        this.element = el;

        el.querySelector('.idm-close').addEventListener('click', () => this.end());
        el.querySelector('.idm-backdrop').addEventListener('click', () => this.end());
        document.addEventListener('keydown', this._keyHandler = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                this.end();
                return;
            }
            // Number-key selection, skipping disabled (already attempted)
            // choices. Ignored while the user is typing somewhere else.
            const target = e.target;
            if (target instanceof HTMLElement
                && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
            const n = Number(e.key);
            if (n >= 1 && n <= 9 && this.element) {
                const buttons = this.element.querySelectorAll('.idm-choice');
                const btn = buttons[n - 1];
                if (btn && !btn.disabled) btn.click();
            }
        }, { capture: true });
    }

    hide() {
        this.element?.remove();
        this.element = null;
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler, { capture: true });
            this._keyHandler = null;
        }
    }

    end() {
        this.hide();
        this.currentTree = null;
        this.currentNodeId = null;
        this.token = null;
        this.state = null;
        this.attemptedChecks.clear();
    }

    renderNode() {
        if (!this.element || !this.currentTree) return;
        const node = this.currentTree.nodes[this.currentNodeId];
        if (!node) {
            ui.notifications.error(`Dialogue node not found: ${this.currentNodeId}`);
            this.end();
            return;
        }

        this.element.querySelector('.idm-portrait').src = getTokenPortrait(this.token);
        this.element.querySelector('.idm-name').textContent =
            this.token.document.name || this.token.actor?.name || '';

        const textEl = this.element.querySelector('.idm-text');
        const prefix = node.speakerText || '';
        if (node.rumourTable || Array.isArray(node.rumours)) {
            // Rumour node: draw a random entry and splice it into the line.
            // A render-sequence token guards against stale async draws if the
            // player re-rolls (self-looping choice) or navigates away mid-draw.
            const seq = (this._renderSeq = (this._renderSeq || 0) + 1);
            textEl.textContent = prefix ? `${prefix}\n\n…` : '…';
            this.resolveRumour(node).then(rumour => {
                if (seq !== this._renderSeq) return;
                textEl.textContent = prefix ? `${prefix}\n\n“${rumour}”` : `“${rumour}”`;
            });
        } else {
            this._renderSeq = (this._renderSeq || 0) + 1;
            textEl.textContent = prefix;
        }

        this.markVisited(this.currentNodeId);

        const choicesEl = this.element.querySelector('.idm-choices');
        choicesEl.innerHTML = '';

        // Filter out choices whose condition fails or that were already picked
        // (once: true), keeping the original index for state/attempt keys.
        const choices = (Array.isArray(node.choices) ? node.choices : [])
            .map((choice, origIdx) => ({ choice, origIdx }))
            .filter(({ choice, origIdx }) => {
                if (!evaluateCondition(choice.condition, this.state)) return false;
                if (choice.once && this.state?.chosen.includes(`${this.currentNodeId}:${origIdx}`)) return false;
                return true;
            });

        if (choices.length === 0) {
            const btn = document.createElement('button');
            btn.className = 'idm-choice idm-choice-end';
            btn.textContent = '[End conversation]';
            btn.addEventListener('click', () => this.end());
            choicesEl.appendChild(btn);
            return;
        }

        choices.forEach(({ choice, origIdx }, idx) => {
            const attemptKey = `${this.currentNodeId}:${origIdx}`;
            const attempted = this.attemptedChecks.has(attemptKey);

            const btn = document.createElement('button');
            btn.className = 'idm-choice';
            if (attempted) btn.classList.add('idm-choice-attempted');

            const num = document.createElement('span');
            num.className = 'idm-choice-num';
            num.textContent = `${idx + 1}.`;
            btn.appendChild(num);

            if (choice.check) {
                const tag = document.createElement('span');
                tag.className = 'idm-choice-check';
                const skill = String(choice.check.skill || '');
                const skillLabel = skill.charAt(0).toUpperCase() + skill.slice(1);
                tag.textContent = `[${skillLabel} DC ${choice.check.dc}]`;
                btn.appendChild(tag);
            }

            const label = document.createElement('span');
            label.className = 'idm-choice-text';
            label.textContent = choice.text || '';
            btn.appendChild(label);

            if (attempted) {
                const status = document.createElement('span');
                status.className = 'idm-choice-status';
                status.textContent = '(already attempted)';
                btn.appendChild(status);
                btn.disabled = true;
                choicesEl.appendChild(btn);
                return;
            }

            btn.addEventListener('click', async () => {
                if (this.attemptedChecks.has(attemptKey)) return;

                if (choice.check) {
                    this.attemptedChecks.add(attemptKey);
                    // Disable immediately to prevent double-clicks while rolling.
                    btn.disabled = true;
                    btn.classList.add('idm-choice-rolling');
                    if (choice.check.secret) {
                        // Neutral transition for secret rolls — the blind roll's
                        // outcome banner is hidden from the player.
                        this.element.querySelector('.idm-text').textContent = 'You make the attempt…';
                    }

                    const degree = await this.performCheck(choice.check);
                    if (degree == null) {
                        // Roll cancelled or errored — keep the lock so the player
                        // can't retry, but re-render so the UI reflects it cleanly.
                        this.renderNode();
                        return;
                    }
                    this.applyChoiceEffects(choice, origIdx);
                    this.emitProgress(choice, degree);
                    this.logCheck(choice, degree);
                    this.goTo(this.targetForDegree(choice, degree));
                    return;
                }

                this.applyChoiceEffects(choice, origIdx);
                this.emitProgress(choice, null);
                this.goTo(choice.nextNodeId);
            });
            choicesEl.appendChild(btn);
        });
    }

    /**
     * Map a degree of success (0 crit fail … 3 crit success) to the choice's
     * target node. Absent crit/fumble tiers collapse into success/failure;
     * explicit null means "end the conversation".
     */
    targetForDegree(choice, degree) {
        switch (degree) {
            case 3: return choice.critNodeId !== undefined ? choice.critNodeId : choice.nextNodeId;
            case 0: return choice.fumbleNodeId !== undefined ? choice.fumbleNodeId : choice.failNodeId;
            case 2: return choice.nextNodeId;
            default: return choice.failNodeId;
        }
    }

    /** Roll the check and return the PF2e degree of success (0–3), or null. */
    async performCheck(check) {
        const actor = game.user.character;
        if (!actor) {
            ui.notifications.error("Assign a character to your user in User Configuration to make skill checks.");
            return null;
        }
        const skillKey = String(check.skill || '').toLowerCase();
        const skill = actor.skills?.[skillKey];
        if (!skill?.check?.roll) {
            ui.notifications.error(`${actor.name} has no skill "${skillKey}".`);
            return null;
        }
        const dc = Number(check.dc);
        if (!Number.isFinite(dc)) {
            ui.notifications.error(`Skill check has invalid DC.`);
            return null;
        }
        try {
            const roll = await skill.check.roll({
                dc: { value: dc },
                rollMode: check.secret ? 'blindroll' : 'publicroll',
                skipDialog: true
            });
            if (!roll) return null;  // user cancelled the PF2e check dialog
            const degree = Number(roll.options?.degreeOfSuccess);
            if (Number.isInteger(degree) && degree >= 0 && degree <= 3) return degree;
            // Fallback for rolls without PF2e degree data.
            return roll.total >= dc ? 2 : 1;
        } catch (e) {
            console.error(`${MODULE_ID} | skill check error`, e);
            ui.notifications.error(`Skill check failed: ${e.message}`);
            return null;
        }
    }

    // Resolve a single random rumour for a rumour node. An inline `rumours`
    // array (strings) takes precedence; otherwise `rumourTable` is drawn from a
    // Foundry RollTable, looked up by name first, then by id.
    async resolveRumour(node) {
        const list = Array.isArray(node.rumours) ? node.rumours : null;
        if (list && list.length) {
            const pick = list[Math.floor(Math.random() * list.length)];
            return typeof pick === 'string' ? pick : (pick?.text || '');
        }

        if (node.rumourTable) {
            const table = game.tables?.getName(node.rumourTable) || game.tables?.get(node.rumourTable);
            if (!table) {
                return `(No RollTable named "${node.rumourTable}" exists in this world.)`;
            }
            try {
                const draw = await table.draw({ displayChat: !!node.rumourToChat });
                const results = draw?.results || [];
                const texts = results.map(r => {
                    // Field name varies across Foundry versions; cover them all,
                    // then strip any HTML the table cell may contain.
                    const raw = r.text ?? r.description ?? r.name ?? '';
                    return String(raw).replace(/<[^>]*>/g, '').trim();
                }).filter(Boolean);
                return texts.join(' ') || '(The table was drawn, but returned no text.)';
            } catch (e) {
                console.error(`${MODULE_ID} | rumour table draw error`, e);
                return `(Error drawing from "${node.rumourTable}": ${e.message})`;
            }
        }

        return '(This rumour node has no rumours or rumourTable set.)';
    }
}

export const dialogueRuntime = new DialogueRuntime();

// ---------------------------------------------------------------------------
// Player right-click-to-talk. Foundry gates token PIXI events by ownership, so
// `_onClickRight` never fires for non-owners on unowned NPCs. We listen for
// right-click at the DOM level instead and hit-test tokens ourselves.
// ---------------------------------------------------------------------------

function getWorldPosFromEvent(event) {
    // Foundry tracks the current world-space mouse position; it is up to date
    // because the user just moved the cursor over the token to right-click it.
    const mp = canvas?.mousePosition;
    if (mp && Number.isFinite(mp.x) && Number.isFinite(mp.y)) return mp;

    const view = canvas?.app?.canvas || canvas?.app?.view || canvas?.app?.renderer?.view;
    if (!view) return null;
    const rect = view.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const resScale = view.width ? view.width / rect.width : 1;
    try {
        const screenPoint = new PIXI.Point(
            (event.clientX - rect.left) * resScale,
            (event.clientY - rect.top) * resScale
        );
        return canvas.tokens.toLocal(screenPoint);
    } catch (e) {
        return null;
    }
}

function findTokenAtWorldPos(worldPos) {
    if (!worldPos) return null;
    // Iterate top-down: later placeables draw on top.
    const placeables = canvas.tokens.placeables;
    for (let i = placeables.length - 1; i >= 0; i--) {
        const t = placeables[i];
        if (!t.visible) continue;
        const b = t.bounds;
        if (b && b.contains(worldPos.x, worldPos.y)) return t;
        // Fallback: rect from document if bounds missing.
        if (!b) {
            const x = t.x ?? t.document?.x;
            const y = t.y ?? t.document?.y;
            const w = t.w ?? (t.document?.width * canvas.grid.size);
            const h = t.h ?? (t.document?.height * canvas.grid.size);
            if (worldPos.x >= x && worldPos.x <= x + w &&
                worldPos.y >= y && worldPos.y <= y + h) return t;
        }
    }
    return null;
}

function clickIsOnCanvas(event) {
    const elUnder = document.elementFromPoint(event.clientX, event.clientY);
    if (!elUnder) return false;
    if (elUnder.tagName === 'CANVAS') return true;
    if (elUnder.id === 'board') return true;
    if (elUnder.closest?.('#board')) return true;
    return false;
}

function tryOpenDialogueAtCursor(event) {
    if (game.user.isGM) return false; // the GM uses the token HUD instead
    if (!canvas?.ready) return false;
    if (!clickIsOnCanvas(event)) return false;
    const worldPos = getWorldPosFromEvent(event);
    const token = findTokenAtWorldPos(worldPos);
    if (!token) return false;
    const tree = getTreeForToken(token);
    if (!tree) return false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    dialogueRuntime.start(token, tree);
    return true;
}

export function installDialogueRightClickListeners() {
    document.addEventListener('pointerdown', (event) => {
        if (event.button === 2) tryOpenDialogueAtCursor(event);
    }, { capture: true });
    document.addEventListener('contextmenu', (event) => {
        tryOpenDialogueAtCursor(event);
    }, { capture: true });
}
