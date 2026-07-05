import { MODULE_ID, FLAGS } from './constants.js';
import { getTokenPortrait, escapeHTML } from './utils.js';
import { applyTheme } from './theme.js';
import { getTreeForToken, dialogueRuntime, validateTree } from './dialogue-tree.js';
import { openDialogueEditor } from './dialogue-editor.js';
import { ambientDialogue } from './ambient-dialogue.js';
import { combatDialogue, COMBAT_TRIGGERS } from './combat-dialogue.js';
import { conversationGroups, GROUP_MODES } from './conversation-groups.js';

let activeHub = null;

/**
 * The GM's one-stop panel for everything dialogue-related on a token — a real
 * (draggable, resizable) ApplicationV2 window styled like the tree editor.
 * Tabs:
 *   Tree    — branching right-click dialogue (opens the full editor)
 *   Ambient — proximity-triggered lines from a RollTable
 *   Combat  — barks on attack/cast, damage, death and combat start
 *   Groups  — multi-NPC ambient conversations (world-level, seeded with this token)
 */
export function openDialogueHub(token) {
    activeHub?.close();
    activeHub = new DialogueHubApp(token);
    activeHub.render(true);
    return activeHub;
}

class DialogueHubApp extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: 'intrinsics-dialogue-hub',
        classes: ['icv-app'],
        window: {
            title: 'Dialogue',
            icon: 'fas fa-comments',
            resizable: true
        },
        position: { width: 680, height: 620 }
    };

    constructor(token, options = {}) {
        super(options);
        this.token = token;
    }

    get title() {
        return `Dialogue — ${this.token.name}`;
    }

    async _renderHTML() {
        const el = document.createElement('div');
        el.className = 'idh-panel';
        this.#build(el);
        return el;
    }

    _replaceHTML(result, content) {
        content.replaceChildren(result);
    }

    _onRender() {
        applyTheme(this.element);
    }

    _onClose() {
        if (activeHub === this) activeHub = null;
    }

    #build(el) {
        const token = this.token;
        const close = () => this.close();

        el.innerHTML = `
            <div class="idh-header">
                <img class="idh-portrait" alt="" />
                <div>
                    <div class="idh-title">Dialogue</div>
                    <div class="idh-subtitle"></div>
                </div>
            </div>
            <div class="idh-tabs">
                <button class="idh-tab" data-tab="tree" type="button"><i class="fas fa-comments"></i> Tree</button>
                <button class="idh-tab" data-tab="ambient" type="button"><i class="fas fa-broadcast-tower"></i> Ambient</button>
                <button class="idh-tab" data-tab="combat" type="button"><i class="fas fa-fist-raised"></i> Combat</button>
                <button class="idh-tab" data-tab="groups" type="button"><i class="fas fa-users"></i> Groups</button>
            </div>
            <div class="idh-body"></div>
            <div class="idh-status"></div>
        `;

        el.querySelector('.idh-portrait').src = getTokenPortrait(token);
        el.querySelector('.idh-subtitle').textContent = token.name;

        const body = el.querySelector('.idh-body');
        const statusEl = el.querySelector('.idh-status');
        const setStatus = (msg, kind) => {
            statusEl.textContent = msg || '';
            statusEl.className = `idh-status ${kind || ''}`;
        };

        let activeTab = 'tree';
        const renderers = { tree: renderTreeTab, ambient: renderAmbientTab, combat: renderCombatTab, groups: renderGroupsTab };

        function selectTab(tab) {
            activeTab = tab;
            for (const btn of el.querySelectorAll('.idh-tab')) {
                btn.classList.toggle('active', btn.dataset.tab === tab);
            }
            setStatus('');
            body.innerHTML = '';
            renderers[tab]();
        }
        for (const btn of el.querySelectorAll('.idh-tab')) {
            btn.addEventListener('click', () => selectTab(btn.dataset.tab));
        }

        // -- Shared form helpers ---------------------------------------------------

        function tableOptions(selectedId) {
            const opts = ['<option value="">— No table —</option>'];
            for (const table of game.tables) {
                const sel = table.id === selectedId ? ' selected' : '';
                opts.push(`<option value="${table.id}"${sel}>${escapeHTML(table.name)}</option>`);
            }
            return opts.join('');
        }

        function actionButton(label, icon, className, onClick) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `idh-btn ${className || ''}`;
            btn.innerHTML = `<i class="${icon}"></i> ${label}`;
            btn.addEventListener('click', onClick);
            return btn;
        }

        // -- Tree tab ----------------------------------------------------------------

        function renderTreeTab() {
            const actor = token.actor;
            if (!actor) {
                body.innerHTML = '<div class="idh-empty">This token has no actor.</div>';
                return;
            }
            const enabled = !!actor.getFlag(MODULE_ID, FLAGS.TREE_ENABLED);
            const tree = actor.getFlag(MODULE_ID, FLAGS.TREE);
            const validity = tree ? validateTree(tree) : null;
            const nodeCount = tree?.nodes ? Object.keys(tree.nodes).length : 0;

            const section = document.createElement('div');
            section.className = 'idh-section';
            section.innerHTML = `
                <label class="idh-toggle">
                    <input type="checkbox" ${enabled ? 'checked' : ''} />
                    <span>Enabled — players right-click this token to talk</span>
                </label>
                <div class="idh-info">${
                    !tree ? 'No dialogue tree yet — open the editor to create one.'
                    : !validity.ok ? `⚠ Tree is invalid: ${escapeHTML(validity.error)}`
                    : `${nodeCount} node(s).${actor.getFlag(MODULE_ID, FLAGS.RUMOURS_ENABLED) ? ' Rumours on.' : ''}`
                }</div>
                <div class="idh-actions"></div>
            `;
            section.querySelector('input').addEventListener('change', async (e) => {
                await actor.setFlag(MODULE_ID, FLAGS.TREE_ENABLED, e.target.checked);
                setStatus(e.target.checked ? 'Dialogue enabled.' : 'Dialogue disabled.', 'ok');
            });
            const actions = section.querySelector('.idh-actions');
            actions.appendChild(actionButton('Open Tree Editor', 'fas fa-edit', 'primary', () => {
                close();
                openDialogueEditor(actor);
            }));
            if (tree && validity?.ok) {
                actions.appendChild(actionButton('Test Dialogue', 'fas fa-play', '', () => {
                    dialogueRuntime.start(token, getTreeForToken(token) ?? tree);
                }));
            }
            body.appendChild(section);
        }

        // -- Ambient tab ---------------------------------------------------------------

        function renderAmbientTab() {
            if (!token.actor) {
                body.innerHTML = '<div class="idh-empty">This token has no actor.</div>';
                return;
            }
            const config = ambientDialogue.getAuraConfig(token.id);
            const defaultRange = game.settings.get(MODULE_ID, 'dialogueAuraRange');
            const lines = Array.isArray(config?.lines) ? config.lines : [];

            const section = document.createElement('div');
            section.className = 'idh-section';
            section.innerHTML = `
                <label class="idh-toggle">
                    <input class="idh-ambient-enabled" type="checkbox" ${(config?.enabled ?? true) ? 'checked' : ''} />
                    <span>Enabled — speaks a random line when players come within range</span>
                </label>
                <div class="idh-field">
                    <label>Lines — one per row</label>
                    <textarea class="idh-ambient-lines" rows="6" placeholder="What this NPC mutters when players come near&#10;(one line per row — a random one is picked each time)"></textarea>
                </div>
                <div class="idh-field">
                    <label>Trigger range (feet)</label>
                    <input class="idh-ambient-range" type="number" min="5" max="120" step="5" value="${config?.range ?? defaultRange}" />
                </div>
                <div class="idh-info">Lines repeat at most every ${game.settings.get(MODULE_ID, 'dialogueAuraRandomInterval')}s (module settings).</div>
                <div class="idh-actions"></div>
            `;
            section.querySelector('.idh-ambient-lines').value = lines.join('\n');
            const actions = section.querySelector('.idh-actions');
            actions.appendChild(actionButton('Save', 'fas fa-check', 'primary', async () => {
                const linesArr = section.querySelector('.idh-ambient-lines').value
                    .split('\n').map(s => s.trim()).filter(Boolean);
                const range = parseInt(section.querySelector('.idh-ambient-range').value) || defaultRange;
                const enabled = section.querySelector('.idh-ambient-enabled').checked;
                if (!linesArr.length) { setStatus('Add at least one line first.', 'error'); return; }
                if (await ambientDialogue.assignLinesToToken(token.id, linesArr, range)) {
                    if (!enabled) await ambientDialogue.toggleAura(token.id, false);
                    setStatus('Ambient dialogue saved.', 'ok');
                }
            }));
            actions.appendChild(actionButton('Test Now', 'fas fa-play', '', async () => {
                await ambientDialogue.testToken(token.id);
            }));
            if (config) {
                actions.appendChild(actionButton('Remove', 'fas fa-trash', 'danger', async () => {
                    await ambientDialogue.removeFromToken(token.id);
                    selectTab('ambient');
                    setStatus('Ambient dialogue removed.', 'ok');
                }));
            }
            body.appendChild(section);
        }

        // -- Combat tab ---------------------------------------------------------------

        function renderCombatTab() {
            if (!token.actor) {
                body.innerHTML = '<div class="idh-empty">This token has no actor.</div>';
                return;
            }
            const config = combatDialogue.getTokenConfig(token.id);
            const chance = game.settings.get(MODULE_ID, 'combatDialogueProbability');

            const section = document.createElement('div');
            section.className = 'idh-section';
            section.innerHTML = `
                <label class="idh-toggle">
                    <input class="idh-combat-enabled" type="checkbox" ${(config?.enabled ?? true) ? 'checked' : ''} />
                    <span>Enabled — can speak on combat triggers</span>
                </label>
                <div class="idh-field">
                    <label>Lines per trigger — one per row</label>
                    <div class="idh-combat-triggers"></div>
                </div>
                <div class="idh-info">Attack/cast and damage barks fire ${chance}% of the time (module settings); death and combat-start barks always fire. Triggers during active combat only.</div>
                <div class="idh-actions"></div>
            `;

            const triggersEl = section.querySelector('.idh-combat-triggers');
            const textareas = {};
            for (const [key, def] of Object.entries(COMBAT_TRIGGERS)) {
                const row = document.createElement('div');
                row.className = 'idh-combat-row';
                row.innerHTML = `
                    <label title="${escapeHTML(def.hint)}">${escapeHTML(def.label)}</label>
                    <textarea rows="3" placeholder="One line per row…"></textarea>
                `;
                const ta = row.querySelector('textarea');
                ta.value = (config?.lines?.[key] ?? []).join('\n');
                const testBtn = actionButton('', 'fas fa-play', 'icon', async () => {
                    await combatDialogue.testToken(token.id, key);
                });
                testBtn.title = `Test the "${def.label}" bark now`;
                row.appendChild(testBtn);
                textareas[key] = ta;
                triggersEl.appendChild(row);
            }

            const actions = section.querySelector('.idh-actions');
            actions.appendChild(actionButton('Save', 'fas fa-check', 'primary', async () => {
                const lines = {};
                for (const [key, ta] of Object.entries(textareas)) {
                    const arr = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
                    if (arr.length) lines[key] = arr;
                }
                if (!Object.keys(lines).length) {
                    setStatus('Add at least one line first.', 'error');
                    return;
                }
                const enabled = section.querySelector('.idh-combat-enabled').checked;
                if (await combatDialogue.assignLinesToToken(token.id, lines, enabled)) {
                    setStatus('Combat dialogue saved.', 'ok');
                }
            }));
            if (config) {
                actions.appendChild(actionButton('Remove', 'fas fa-trash', 'danger', async () => {
                    await combatDialogue.removeFromToken(token.id);
                    selectTab('combat');
                    setStatus('Combat dialogue removed.', 'ok');
                }));
            }
            body.appendChild(section);
        }

        // -- Groups tab ---------------------------------------------------------------

        function tokenName(tokenId) {
            return canvas.tokens.get(tokenId)?.name ?? '(missing token)';
        }

        function renderGroupsTab() {
            const groups = conversationGroups.getConversationGroups();

            const section = document.createElement('div');
            section.className = 'idh-section';

            const header = document.createElement('div');
            header.className = 'idh-row-header';
            header.innerHTML = `<span>${groups.length} conversation group(s) in this world</span>`;
            header.appendChild(actionButton('New Group', 'fas fa-plus', 'primary', () => {
                renderGroupForm(null);
            }));
            section.appendChild(header);

            const list = document.createElement('div');
            list.className = 'idh-group-list';
            if (!groups.length) {
                list.innerHTML = '<div class="idh-empty">No groups yet. Groups let several NPCs hold an ambient conversation when players approach.</div>';
            }
            for (const group of groups) {
                const involvesToken = group.npcs.includes(token.id);
                const item = document.createElement('div');
                item.className = 'idh-group-item' + (involvesToken ? ' highlight' : '');
                item.innerHTML = `
                    <div class="idh-group-info">
                        <span class="idh-group-name">${escapeHTML(group.name)}</span>
                        <span class="idh-group-meta">${escapeHTML(group.mode)} · ${group.npcs.length} NPC(s) · every ${group.delay}s${involvesToken ? ' · includes this token' : ''}</span>
                    </div>
                    <div class="idh-group-controls"></div>
                `;
                const controls = item.querySelector('.idh-group-controls');

                const toggleBtn = actionButton(group.enabled ? 'On' : 'Off', group.enabled ? 'fas fa-toggle-on' : 'fas fa-toggle-off',
                    group.enabled ? 'ok' : '', async () => {
                        await conversationGroups.toggleConversation(group.groupId, !group.enabled);
                        selectTab('groups');
                    });
                toggleBtn.title = group.enabled ? 'Enabled — click to pause' : 'Paused — click to enable';
                controls.appendChild(toggleBtn);

                const playBtn = actionButton('', 'fas fa-play', 'icon', async () => {
                    setStatus(`Playing "${group.name}"…`, 'info');
                    await conversationGroups.manuallyTriggerConversation(group.groupId);
                    setStatus(`Finished "${group.name}".`, 'ok');
                });
                playBtn.title = 'Play full conversation now';
                controls.appendChild(playBtn);

                const resetBtn = actionButton('', 'fas fa-undo', 'icon', async () => {
                    await conversationGroups.resetConversation(group.groupId);
                    setStatus(`"${group.name}" reset to the start.`, 'ok');
                });
                resetBtn.title = 'Reset to first line';
                controls.appendChild(resetBtn);

                const editBtn = actionButton('', 'fas fa-edit', 'icon', () => renderGroupForm(group));
                editBtn.title = 'Edit group';
                controls.appendChild(editBtn);

                const deleteBtn = actionButton('', 'fas fa-trash', 'icon danger', async () => {
                    if (!confirm(`Delete conversation group "${group.name}"?`)) return;
                    await conversationGroups.deleteConversationGroup(group.groupId);
                    selectTab('groups');
                });
                deleteBtn.title = 'Delete group';
                controls.appendChild(deleteBtn);

                list.appendChild(item);
            }
            section.appendChild(list);
            body.innerHTML = '';
            body.appendChild(section);
        }

        /** Create/edit form for a conversation group. */
        function renderGroupForm(existing) {
            const draft = existing ? structuredClone(existing) : {
                name: '',
                mode: 'turn-taking',
                npcs: [token.id],
                dialogue: [],
                tablesByNPC: {},
                sharedTableId: null,
                range: 30,
                delay: game.settings.get(MODULE_ID, 'dialogueAuraRandomInterval')
            };

            const form = document.createElement('div');
            form.className = 'idh-section';
            form.innerHTML = `
                <div class="idh-row-header">
                    <span>${existing ? `Edit "${escapeHTML(existing.name)}"` : 'New conversation group'}</span>
                </div>
                <div class="idh-field">
                    <label>Name</label>
                    <input class="idh-g-name" type="text" placeholder="e.g. Market gossip" />
                </div>
                <div class="idh-field">
                    <label>Mode</label>
                    <select class="idh-g-mode">${
                        Object.entries(GROUP_MODES).map(([k, label]) =>
                            `<option value="${k}"${k === draft.mode ? ' selected' : ''}>${escapeHTML(label)}</option>`).join('')
                    }</select>
                </div>
                <div class="idh-field idh-g-shared-wrap">
                    <label>Shared roll table</label>
                    <select class="idh-g-shared"></select>
                </div>
                <div class="idh-field">
                    <div class="idh-row-header">
                        <label>NPCs (speaking order)</label>
                        <button class="idh-g-add-npcs idh-btn" type="button"><i class="fas fa-plus"></i> Add selected tokens</button>
                    </div>
                    <div class="idh-g-npcs"></div>
                </div>
                <div class="idh-field idh-g-lines-wrap">
                    <div class="idh-row-header">
                        <label>Script lines</label>
                        <button class="idh-g-add-line idh-btn" type="button"><i class="fas fa-plus"></i> Add line</button>
                    </div>
                    <div class="idh-g-lines"></div>
                </div>
                <div class="idh-field-grid">
                    <div class="idh-field">
                        <label>Trigger range (feet)</label>
                        <input class="idh-g-range" type="number" min="5" max="120" step="5" />
                    </div>
                    <div class="idh-field">
                        <label>Delay between lines (seconds)</label>
                        <input class="idh-g-delay" type="number" min="2" max="120" step="1" />
                    </div>
                </div>
                <div class="idh-actions">
                    <button class="idh-g-save idh-btn primary" type="button"><i class="fas fa-check"></i> ${existing ? 'Save changes' : 'Create group'}</button>
                    <button class="idh-g-cancel idh-btn" type="button">Back to list</button>
                </div>
            `;

            form.querySelector('.idh-g-name').value = draft.name;
            form.querySelector('.idh-g-shared').innerHTML = tableOptions(draft.sharedTableId);
            form.querySelector('.idh-g-range').value = draft.range;
            form.querySelector('.idh-g-delay').value = draft.delay;

            const modeSelect = form.querySelector('.idh-g-mode');
            const sharedWrap = form.querySelector('.idh-g-shared-wrap');
            const linesWrap = form.querySelector('.idh-g-lines-wrap');
            const npcsEl = form.querySelector('.idh-g-npcs');
            const linesEl = form.querySelector('.idh-g-lines');

            function syncModeVisibility() {
                const mode = modeSelect.value;
                sharedWrap.style.display = (mode === 'scripted' || mode === 'turn-taking') ? '' : 'none';
                linesWrap.style.display = mode === 'scripted-custom' ? '' : 'none';
                renderNpcRows(); // per-NPC table selects only exist in random mode
            }
            modeSelect.addEventListener('change', syncModeVisibility);

            function renderNpcRows() {
                npcsEl.innerHTML = '';
                if (!draft.npcs.length) {
                    npcsEl.innerHTML = '<div class="idh-empty">No NPCs — select tokens on the canvas and click "Add selected tokens".</div>';
                    return;
                }
                draft.npcs.forEach((npcId, idx) => {
                    const row = document.createElement('div');
                    row.className = 'idh-g-npc-row';
                    row.innerHTML = `
                        <span class="idh-g-npc-num">${idx + 1}.</span>
                        <span class="idh-g-npc-name">${escapeHTML(tokenName(npcId))}</span>
                        ${modeSelect.value === 'random' ? `<select class="idh-g-npc-table">${tableOptions(draft.tablesByNPC[npcId])}</select>` : ''}
                        <button class="idh-g-npc-up" type="button" title="Move up">↑</button>
                        <button class="idh-g-npc-down" type="button" title="Move down">↓</button>
                        <button class="idh-g-npc-del" type="button" title="Remove">×</button>
                    `;
                    row.querySelector('.idh-g-npc-table')?.addEventListener('change', (e) => {
                        if (e.target.value) draft.tablesByNPC[npcId] = e.target.value;
                        else delete draft.tablesByNPC[npcId];
                    });
                    row.querySelector('.idh-g-npc-up').addEventListener('click', () => {
                        if (idx === 0) return;
                        [draft.npcs[idx - 1], draft.npcs[idx]] = [draft.npcs[idx], draft.npcs[idx - 1]];
                        renderNpcRows();
                    });
                    row.querySelector('.idh-g-npc-down').addEventListener('click', () => {
                        if (idx === draft.npcs.length - 1) return;
                        [draft.npcs[idx + 1], draft.npcs[idx]] = [draft.npcs[idx], draft.npcs[idx + 1]];
                        renderNpcRows();
                    });
                    row.querySelector('.idh-g-npc-del').addEventListener('click', () => {
                        draft.npcs.splice(idx, 1);
                        delete draft.tablesByNPC[npcId];
                        draft.dialogue = draft.dialogue.filter(l => l.speaker !== npcId);
                        renderNpcRows();
                        renderLineRows();
                    });
                    npcsEl.appendChild(row);
                });
            }

            form.querySelector('.idh-g-add-npcs').addEventListener('click', () => {
                const selected = canvas.tokens.controlled;
                if (!selected.length) {
                    setStatus('Select one or more tokens on the canvas first.', 'error');
                    return;
                }
                for (const t of selected) {
                    if (!draft.npcs.includes(t.id)) draft.npcs.push(t.id);
                }
                renderNpcRows();
                renderLineRows();
            });

            function speakerOptions(selectedId) {
                return draft.npcs.map(id =>
                    `<option value="${id}"${id === selectedId ? ' selected' : ''}>${escapeHTML(tokenName(id))}</option>`).join('');
            }

            function renderLineRows() {
                linesEl.innerHTML = '';
                if (!draft.dialogue.length) {
                    linesEl.innerHTML = '<div class="idh-empty">No lines yet.</div>';
                    return;
                }
                draft.dialogue.forEach((line, idx) => {
                    const row = document.createElement('div');
                    row.className = 'idh-g-line-row';
                    row.innerHTML = `
                        <span class="idh-g-npc-num">${idx + 1}.</span>
                        <select class="idh-g-line-speaker">${speakerOptions(line.speaker)}</select>
                        <input class="idh-g-line-text" type="text" placeholder="What they say…" />
                        <button class="idh-g-npc-del" type="button" title="Delete line">×</button>
                    `;
                    row.querySelector('.idh-g-line-text').value = line.text || '';
                    row.querySelector('.idh-g-line-speaker').addEventListener('change', (e) => { line.speaker = e.target.value; });
                    row.querySelector('.idh-g-line-text').addEventListener('input', (e) => { line.text = e.target.value; });
                    row.querySelector('.idh-g-npc-del').addEventListener('click', () => {
                        draft.dialogue.splice(idx, 1);
                        renderLineRows();
                    });
                    linesEl.appendChild(row);
                });
            }

            form.querySelector('.idh-g-add-line').addEventListener('click', () => {
                if (!draft.npcs.length) {
                    setStatus('Add NPCs before adding lines.', 'error');
                    return;
                }
                // Default the speaker to whoever follows the previous line's speaker.
                const prev = draft.dialogue[draft.dialogue.length - 1];
                const prevIdx = prev ? draft.npcs.indexOf(prev.speaker) : -1;
                draft.dialogue.push({ speaker: draft.npcs[(prevIdx + 1) % draft.npcs.length], text: '' });
                renderLineRows();
            });

            form.querySelector('.idh-g-save').addEventListener('click', async () => {
                draft.name = form.querySelector('.idh-g-name').value;
                draft.mode = modeSelect.value;
                draft.sharedTableId = form.querySelector('.idh-g-shared').value || null;
                draft.range = parseInt(form.querySelector('.idh-g-range').value) || 30;
                draft.delay = parseInt(form.querySelector('.idh-g-delay').value) || 10;
                draft.dialogue = draft.dialogue.filter(l => l.text?.trim());

                const result = existing
                    ? await conversationGroups.updateConversationGroup(existing.groupId, draft)
                    : await conversationGroups.createConversationGroup(draft);
                if (result) {
                    setStatus(existing ? 'Group updated.' : 'Group created.', 'ok');
                    renderGroupsTab();
                }
            });
            form.querySelector('.idh-g-cancel').addEventListener('click', () => renderGroupsTab());

            syncModeVisibility();
            renderNpcRows();
            renderLineRows();
            body.innerHTML = '';
            body.appendChild(form);
        }

        selectTab('tree');
    }
}
