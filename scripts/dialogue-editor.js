import { MODULE_ID, FLAGS, PF2E_SKILLS, VISITED_PREFIX } from './constants.js';
import { escapeHTML } from './utils.js';
import { applyTheme } from './theme.js';
import { EXAMPLE_TREE, RUMOUR_STARTER_TREE, validateTree, dialogueRuntime } from './dialogue-tree.js';
import { COMBAT_TRIGGERS } from './combat-dialogue.js';

// -- Ambient / combat bark normalisers ----------------------------------------
// The unified character export carries ambient and combat barks alongside the
// tree. Both are validated/cleaned into the on-actor flag shape on import;
// either returns null (and is skipped) when there are no usable lines.

function normalizeAmbientImport(a) {
    if (!a || typeof a !== 'object') return null;
    const lines = (Array.isArray(a.lines) ? a.lines : []).map(s => String(s).trim()).filter(Boolean);
    if (!lines.length) return null;
    return {
        enabled: a.enabled ?? true,
        range: Number(a.range) || game.settings.get(MODULE_ID, 'dialogueAuraRange'),
        lines
    };
}

function normalizeCombatImport(c) {
    if (!c || typeof c !== 'object' || typeof c.lines !== 'object') return null;
    const lines = {};
    for (const key of Object.keys(COMBAT_TRIGGERS)) {
        const arr = (Array.isArray(c.lines[key]) ? c.lines[key] : []).map(s => String(s).trim()).filter(Boolean);
        if (arr.length) lines[key] = arr;
    }
    if (!Object.keys(lines).length) return null;
    return { enabled: c.enabled ?? true, lines };
}

// -- Condition / flag-effect text round-tripping ------------------------------
// The form UI edits conditions and setFlags as a compact comma-separated
// syntax: "flag" (must be true), "!flag" (must be false / unset), "flag=7"
// (any JSON value). Multiple entries are AND-ed. Arbitrary structures still
// round-trip through the JSON view untouched.

function conditionToText(condition) {
    if (!condition) return '';
    const list = Array.isArray(condition) ? condition : [condition];
    return list.map(c => {
        if (!c || typeof c.flag !== 'string') return '';
        const value = c.value === undefined ? true : c.value;
        if (value === true) return c.flag;
        if (value === false) return `!${c.flag}`;
        return `${c.flag}=${JSON.stringify(value)}`;
    }).filter(Boolean).join(', ');
}

function parseConditionText(text) {
    const list = String(text || '').split(',').map(s => s.trim()).filter(Boolean).map(part => {
        if (part.startsWith('!')) return { flag: part.slice(1).trim(), value: false };
        const eq = part.indexOf('=');
        if (eq > 0) {
            const flag = part.slice(0, eq).trim();
            const raw = part.slice(eq + 1).trim();
            let value;
            try { value = JSON.parse(raw); } catch (e) { value = raw; }
            return { flag, value };
        }
        return { flag: part, value: true };
    }).filter(c => c.flag);
    if (!list.length) return null;
    return list.length === 1 ? list[0] : list;
}

function setFlagsToText(setFlags) {
    if (!setFlags || typeof setFlags !== 'object') return '';
    return Object.entries(setFlags).map(([flag, value]) => {
        if (value === true) return flag;
        if (value === false) return `!${flag}`;
        return `${flag}=${JSON.stringify(value)}`;
    }).join(', ');
}

function parseSetFlagsText(text) {
    const out = {};
    for (const part of String(text || '').split(',').map(s => s.trim()).filter(Boolean)) {
        if (part.startsWith('!')) {
            const flag = part.slice(1).trim();
            if (flag) out[flag] = false;
            continue;
        }
        const eq = part.indexOf('=');
        if (eq > 0) {
            const flag = part.slice(0, eq).trim();
            const raw = part.slice(eq + 1).trim();
            let value;
            try { value = JSON.parse(raw); } catch (e) { value = raw; }
            if (flag) out[flag] = value;
        } else {
            out[part] = true;
        }
    }
    return Object.keys(out).length ? out : null;
}

function downloadJSON(jsonText, filename) {
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let activeEditor = null;

/**
 * GM-facing dialogue tree editor: a real (draggable, resizable) ApplicationV2
 * window with a node list + form pane, an optional raw JSON view, the
 * per-actor rumour settings, and import/export tools.
 */
export function openDialogueEditor(actor) {
    activeEditor?.close();
    activeEditor = new DialogueEditorApp(actor);
    activeEditor.render(true);
    return activeEditor;
}

class DialogueEditorApp extends foundry.applications.api.ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: 'intrinsics-dialogue-editor',
        classes: ['icv-app'],
        window: {
            title: 'Dialogue Tree',
            icon: 'fas fa-comments',
            resizable: true
        },
        position: { width: 1080, height: 760 }
    };

    constructor(actor, options = {}) {
        super(options);
        this.actor = actor;
        const initialTree = actor.getFlag(MODULE_ID, FLAGS.TREE);
        this.data = {
            tree: initialTree ? structuredClone(initialTree) : structuredClone(EXAMPLE_TREE),
            selectedNodeId: null,
            view: 'visual',
            // Ambient/combat barks pulled in by a unified import, applied on Save.
            pendingAmbient: null,
            pendingCombat: null
        };
        this.data.selectedNodeId = this.data.tree.startNodeId;
    }

    get title() {
        return `Dialogue Tree — ${this.actor.name}`;
    }

    async _renderHTML() {
        const el = document.createElement('div');
        el.className = 'ide-panel';
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
        if (activeEditor === this) activeEditor = null;
    }

    #build(el) {
        const actor = this.actor;
        const state = this.data;
        const close = () => this.close();

        el.innerHTML = `
            <div class="ide-toolbar">
                <label class="ide-enable">
                    <input type="checkbox" />
                    <span>Dialogue enabled (players can right-click to talk)</span>
                </label>
                <div class="ide-spacer"></div>
                <button class="ide-view-toggle" type="button">Switch to JSON</button>
                <button class="ide-load-rumour" type="button" title="Load a single greeting node with rumours turned on">Rumour Starter</button>
                <button class="ide-load-example" type="button">Load Example</button>
            </div>
            <div class="ide-toolbar ide-toolbar-io">
                <button class="ide-export" type="button" title="Download this tree (with rumour settings) as JSON"><i class="fas fa-download"></i> Export</button>
                <button class="ide-import" type="button" title="Load a tree from a JSON file (e.g. the samples in the module's dialogues/ folder)"><i class="fas fa-upload"></i> Import</button>
                <select class="ide-copy-from" title="Copy the dialogue from another actor in this world"></select>
                <div class="ide-spacer"></div>
                <button class="ide-reset-state" type="button" title="Forget every player's quest flags, visited nodes and one-time choices for this NPC"><i class="fas fa-eraser"></i> Reset player state</button>
            </div>
            <div class="ide-rumour-bar">
                <label class="ide-rumour-enable">
                    <input type="checkbox" />
                    <span><i class="fas fa-comment-dots"></i> Offer rumours — adds an "Ask about any rumours" choice that rolls on a table</span>
                </label>
                <div class="ide-rumour-fields">
                    <input class="ide-rumour-table" type="text" placeholder="RollTable name (e.g. Tavern Rumours)" />
                    <input class="ide-rumour-prompt" type="text" placeholder='Choice label (default: "Ask about any rumours")' />
                    <textarea class="ide-rumour-leadin" rows="1" placeholder="Optional lead-in line shown above the rumour (e.g. &quot;Let me think…&quot;)"></textarea>
                    <textarea class="ide-rumour-list" rows="2" placeholder="…or inline rumours, one per line (used instead of the table)"></textarea>
                </div>
            </div>
            <div class="ide-body ide-body-visual">
                <div class="ide-nodes-pane">
                    <div class="ide-pane-header">
                        <span>Nodes</span>
                        <button class="ide-add-node" type="button" title="Add new node">+ Add</button>
                    </div>
                    <div class="ide-node-list"></div>
                </div>
                <div class="ide-form-pane"></div>
            </div>
            <div class="ide-body ide-body-json" style="display:none">
                <textarea class="ide-json" spellcheck="false"></textarea>
            </div>
            <div class="ide-status"></div>
            <div class="ide-buttons">
                <div class="ide-spacer"></div>
                <button class="ide-cancel" type="button">Cancel</button>
                <button class="ide-save" type="button">Save</button>
            </div>
        `;

        el.querySelector('.ide-enable input').checked = !!actor.getFlag(MODULE_ID, FLAGS.TREE_ENABLED);

        // Rumour toggle + fields.
        const rumourEnableInput = el.querySelector('.ide-rumour-enable input');
        const rumourFields = el.querySelector('.ide-rumour-fields');
        const rumourTableInput = el.querySelector('.ide-rumour-table');
        const rumourPromptInput = el.querySelector('.ide-rumour-prompt');
        const rumourLeadInInput = el.querySelector('.ide-rumour-leadin');
        const rumourListInput = el.querySelector('.ide-rumour-list');
        rumourEnableInput.checked = !!actor.getFlag(MODULE_ID, FLAGS.RUMOURS_ENABLED);
        rumourTableInput.value = actor.getFlag(MODULE_ID, FLAGS.RUMOUR_TABLE) || '';
        rumourPromptInput.value = actor.getFlag(MODULE_ID, FLAGS.RUMOUR_PROMPT) || '';
        rumourLeadInInput.value = actor.getFlag(MODULE_ID, FLAGS.RUMOUR_LEADIN) || '';
        const rumourListFlag = actor.getFlag(MODULE_ID, FLAGS.RUMOUR_LIST);
        rumourListInput.value = Array.isArray(rumourListFlag) ? rumourListFlag.join('\n') : '';
        const syncRumourFields = () => { rumourFields.style.display = rumourEnableInput.checked ? '' : 'none'; };
        rumourEnableInput.addEventListener('change', syncRumourFields);
        syncRumourFields();

        const setRumourFields = (rumours) => {
            rumourEnableInput.checked = !!rumours.enabled;
            rumourTableInput.value = rumours.table || '';
            rumourPromptInput.value = rumours.prompt || '';
            rumourLeadInInput.value = rumours.leadIn || '';
            rumourListInput.value = Array.isArray(rumours.list) ? rumours.list.join('\n') : '';
            syncRumourFields();
        };
        const collectRumourFields = () => ({
            enabled: rumourEnableInput.checked,
            table: rumourTableInput.value.trim(),
            prompt: rumourPromptInput.value.trim(),
            leadIn: rumourLeadInInput.value.trim(),
            list: rumourListInput.value.split('\n').map(s => s.trim()).filter(Boolean)
        });

        const status = el.querySelector('.ide-status');
        const setStatus = (msg, kind) => {
            status.textContent = msg || '';
            status.className = `ide-status ${kind || ''}`;
        };
        const nodeListEl = el.querySelector('.ide-node-list');
        const formPaneEl = el.querySelector('.ide-form-pane');
        const visualBody = el.querySelector('.ide-body-visual');
        const jsonBody = el.querySelector('.ide-body-json');
        const jsonTextarea = el.querySelector('.ide-json');
        const viewToggleBtn = el.querySelector('.ide-view-toggle');

        el.querySelector('.ide-cancel').addEventListener('click', close);

        function uniqueId(base) {
            let i = 1, candidate = base;
            while (state.tree.nodes[candidate]) { i += 1; candidate = `${base}${i}`; }
            return candidate;
        }

        function nodeIdOptions(selectedValue, { includeEnd = true, endLabel = '[End conversation]', inheritLabel = null } = {}) {
            const opts = [];
            if (inheritLabel) {
                const sel = selectedValue === undefined ? ' selected' : '';
                opts.push(`<option value="__inherit__"${sel}>${escapeHTML(inheritLabel)}</option>`);
            }
            if (includeEnd) {
                const sel = (selectedValue === null || selectedValue === '') ? ' selected' : '';
                opts.push(`<option value=""${sel}>${escapeHTML(endLabel)}</option>`);
            }
            for (const id of Object.keys(state.tree.nodes)) {
                const sel = id === selectedValue ? ' selected' : '';
                opts.push(`<option value="${escapeHTML(id)}"${sel}>${escapeHTML(id)}</option>`);
            }
            if (selectedValue && !state.tree.nodes[selectedValue]) {
                opts.push(`<option value="${escapeHTML(selectedValue)}" selected>⚠ ${escapeHTML(selectedValue)} (missing)</option>`);
            }
            return opts.join('');
        }

        function loadTreeIntoEditor(tree, statusMsg) {
            state.tree = tree;
            if (!state.tree.nodes[state.selectedNodeId]) state.selectedNodeId = state.tree.startNodeId;
            setStatus(statusMsg, 'info');
            if (state.view === 'visual') renderAll();
            else jsonTextarea.value = JSON.stringify(state.tree, null, 2);
        }

        function setView(view) {
            if (view === 'json') {
                jsonTextarea.value = JSON.stringify(state.tree, null, 2);
                visualBody.style.display = 'none';
                jsonBody.style.display = '';
                viewToggleBtn.textContent = 'Switch to Visual';
                state.view = 'json';
            } else {
                try {
                    const parsed = JSON.parse(jsonTextarea.value);
                    const v = validateTree(parsed);
                    if (!v.ok) { setStatus(`Can't switch back: ${v.error}`, 'error'); return; }
                    state.tree = parsed;
                    if (!state.tree.nodes[state.selectedNodeId]) state.selectedNodeId = state.tree.startNodeId;
                    setStatus('');
                } catch (e) {
                    setStatus(`Can't switch back: ${e.message}`, 'error');
                    return;
                }
                visualBody.style.display = '';
                jsonBody.style.display = 'none';
                viewToggleBtn.textContent = 'Switch to JSON';
                state.view = 'visual';
                renderAll();
            }
        }
        viewToggleBtn.addEventListener('click', () => setView(state.view === 'visual' ? 'json' : 'visual'));

        el.querySelector('.ide-load-example').addEventListener('click', () => {
            if (!confirm("Replace this dialogue with the example? Unsaved changes will be lost.")) return;
            const tree = structuredClone(EXAMPLE_TREE);
            state.selectedNodeId = tree.startNodeId;
            loadTreeIntoEditor(tree, 'Example loaded — Save to apply.');
        });

        el.querySelector('.ide-load-rumour').addEventListener('click', () => {
            if (!confirm("Replace this dialogue with a single greeting node and turn rumours on? Unsaved changes will be lost.")) return;
            const tree = structuredClone(RUMOUR_STARTER_TREE);
            state.selectedNodeId = tree.startNodeId;
            // Turn the rumours toggle on and reveal the fields so the GM just names a table.
            rumourEnableInput.checked = true;
            syncRumourFields();
            loadTreeIntoEditor(tree, 'Rumour starter loaded — enter your RollTable name above, then Save.');
            rumourTableInput.focus();
        });

        // -- Import / export / copy-from -----------------------------------------

        function treeFromCurrentView() {
            if (state.view !== 'json') return state.tree;
            try {
                return JSON.parse(jsonTextarea.value);
            } catch (e) {
                setStatus(`Invalid JSON: ${e.message}`, 'error');
                return null;
            }
        }

        el.querySelector('.ide-export').addEventListener('click', () => {
            const tree = treeFromCurrentView();
            if (!tree) return;
            const v = validateTree(tree);
            if (!v.ok) { setStatus(`Can't export: ${v.error}`, 'error'); return; }
            const slug = actor.name.slugify?.({ strict: true })
                || actor.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
                || 'actor';
            // Bundle the actor's ambient + combat barks into the same file so a
            // character's whole dialogue travels together.
            const payload = { tree, rumours: collectRumourFields() };
            const ambient = normalizeAmbientImport(state.pendingAmbient ?? actor.getFlag(MODULE_ID, FLAGS.AMBIENT));
            if (ambient) payload.ambient = ambient;
            const combat = normalizeCombatImport(state.pendingCombat ?? actor.getFlag(MODULE_ID, FLAGS.COMBAT));
            if (combat) payload.combat = combat;
            downloadJSON(JSON.stringify(payload, null, 2), `${slug}-dialogue.json`);
            setStatus('Exported.', 'ok');
        });

        el.querySelector('.ide-import').addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.addEventListener('change', async () => {
                const file = input.files?.[0];
                if (!file) return;
                try {
                    const parsed = JSON.parse(await file.text());
                    // Accept both a bare tree (the dialogues/ samples) and the
                    // wrapped export format { tree, rumours }.
                    const tree = parsed?.nodes ? parsed : parsed?.tree;
                    const v = validateTree(tree);
                    if (!v.ok) { setStatus(`Can't import "${file.name}": ${v.error}`, 'error'); return; }
                    state.selectedNodeId = tree.startNodeId;
                    if (parsed?.rumours && typeof parsed.rumours === 'object') setRumourFields(parsed.rumours);
                    // Ambient/combat barks ride along in the unified format; stash
                    // them to write on Save (the editor UI only shows the tree).
                    state.pendingAmbient = normalizeAmbientImport(parsed?.ambient);
                    state.pendingCombat = normalizeCombatImport(parsed?.combat);
                    const extras = [
                        state.pendingAmbient ? 'ambient' : null,
                        state.pendingCombat ? 'combat' : null
                    ].filter(Boolean);
                    const extraNote = extras.length ? ` (+ ${extras.join(' & ')})` : '';
                    loadTreeIntoEditor(tree, `Imported "${file.name}"${extraNote} — Save to apply.`);
                } catch (e) {
                    setStatus(`Can't import "${file.name}": ${e.message}`, 'error');
                }
            });
            input.click();
        });

        const copySelect = el.querySelector('.ide-copy-from');
        function refreshCopyOptions() {
            const sources = game.actors.filter(a => a.id !== actor.id && a.getFlag(MODULE_ID, FLAGS.TREE)?.nodes);
            copySelect.innerHTML = '<option value="">Copy from…</option>'
                + sources.map(a => `<option value="${a.id}">${escapeHTML(a.name)}</option>`).join('');
            copySelect.disabled = !sources.length;
            if (!sources.length) copySelect.title = 'No other actor in this world has a dialogue tree';
        }
        refreshCopyOptions();
        copySelect.addEventListener('change', () => {
            const source = game.actors.get(copySelect.value);
            copySelect.value = '';
            if (!source) return;
            if (!confirm(`Copy the dialogue (and rumour settings) from "${source.name}"? Unsaved changes will be lost.`)) return;
            const tree = structuredClone(source.getFlag(MODULE_ID, FLAGS.TREE));
            const v = validateTree(tree);
            if (!v.ok) { setStatus(`"${source.name}" has an invalid tree: ${v.error}`, 'error'); return; }
            state.selectedNodeId = tree.startNodeId;
            const sourceList = source.getFlag(MODULE_ID, FLAGS.RUMOUR_LIST);
            setRumourFields({
                enabled: !!source.getFlag(MODULE_ID, FLAGS.RUMOURS_ENABLED),
                table: source.getFlag(MODULE_ID, FLAGS.RUMOUR_TABLE) || '',
                prompt: source.getFlag(MODULE_ID, FLAGS.RUMOUR_PROMPT) || '',
                leadIn: source.getFlag(MODULE_ID, FLAGS.RUMOUR_LEADIN) || '',
                list: Array.isArray(sourceList) ? sourceList : []
            });
            loadTreeIntoEditor(tree, `Copied from "${source.name}" — Save to apply.`);
        });

        el.querySelector('.ide-reset-state').addEventListener('click', async () => {
            if (!actor.getFlag(MODULE_ID, FLAGS.DIALOGUE_STATE)) {
                setStatus('No saved player state for this NPC.', 'info');
                return;
            }
            if (!confirm(`Reset dialogue state for ${actor.name}? Every player's quest flags, visited nodes and one-time choices for this NPC will be forgotten.`)) return;
            try {
                await actor.unsetFlag(MODULE_ID, FLAGS.DIALOGUE_STATE);
                setStatus('Player state reset.', 'ok');
            } catch (e) {
                setStatus(`Reset failed: ${e.message}`, 'error');
            }
        });

        // -- Nodes / save ----------------------------------------------------------

        el.querySelector('.ide-add-node').addEventListener('click', () => {
            const id = uniqueId('node');
            state.tree.nodes[id] = { speakerText: "", choices: [] };
            state.selectedNodeId = id;
            renderAll();
        });

        el.querySelector('.ide-save').addEventListener('click', async () => {
            if (state.view === 'json') {
                try { state.tree = JSON.parse(jsonTextarea.value); }
                catch (e) { setStatus(`Invalid JSON: ${e.message}`, 'error'); return; }
            }
            const v = validateTree(state.tree);
            if (!v.ok) { setStatus(`Invalid tree: ${v.error}`, 'error'); return; }
            const enabledNow = el.querySelector('.ide-enable input').checked;
            const rumours = collectRumourFields();
            try {
                await actor.setFlag(MODULE_ID, FLAGS.TREE, state.tree);
                await actor.setFlag(MODULE_ID, FLAGS.TREE_ENABLED, enabledNow);
                await actor.setFlag(MODULE_ID, FLAGS.RUMOURS_ENABLED, rumours.enabled);
                await actor.setFlag(MODULE_ID, FLAGS.RUMOUR_TABLE, rumours.table);
                await actor.setFlag(MODULE_ID, FLAGS.RUMOUR_PROMPT, rumours.prompt);
                await actor.setFlag(MODULE_ID, FLAGS.RUMOUR_LEADIN, rumours.leadIn);
                await actor.setFlag(MODULE_ID, FLAGS.RUMOUR_LIST, rumours.list);
                // Apply ambient/combat barks brought in by a unified import.
                if (state.pendingAmbient) {
                    await actor.setFlag(MODULE_ID, FLAGS.AMBIENT, state.pendingAmbient);
                    state.pendingAmbient = null;
                }
                if (state.pendingCombat) {
                    await actor.setFlag(MODULE_ID, FLAGS.COMBAT, state.pendingCombat);
                    state.pendingCombat = null;
                }
                setStatus('Saved.', 'ok');
                ui.notifications.info(`Dialogue saved for ${actor.name}`);
                setTimeout(close, 400);
            } catch (e) {
                setStatus(`Save failed: ${e.message}`, 'error');
            }
        });

        function previewFromNode(nodeId) {
            const v = validateTree(state.tree);
            if (!v.ok) { setStatus(`Can't preview: ${v.error}`, 'error'); return; }
            const token = canvas.tokens?.placeables.find(t => t.actor?.id === actor.id);
            if (!token) {
                setStatus(`Can't preview: no token for ${actor.name} on this scene.`, 'error');
                return;
            }
            dialogueRuntime.start(token, structuredClone(state.tree), nodeId);
        }

        function renderNodeList() {
            nodeListEl.innerHTML = '';
            const entries = Object.entries(state.tree.nodes);
            if (entries.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'ide-empty';
                empty.textContent = 'No nodes — add one to get started.';
                nodeListEl.appendChild(empty);
                return;
            }
            for (const [id, node] of entries) {
                const item = document.createElement('div');
                item.className = 'ide-node-item';
                if (id === state.selectedNodeId) item.classList.add('selected');

                const head = document.createElement('div');
                head.className = 'ide-node-item-head';

                const idEl = document.createElement('span');
                idEl.className = 'ide-node-item-id';
                idEl.textContent = id;
                head.appendChild(idEl);

                if (id === state.tree.startNodeId) {
                    const badge = document.createElement('span');
                    badge.className = 'ide-node-item-badge';
                    badge.textContent = 'START';
                    head.appendChild(badge);
                }
                if (node.condition) {
                    const badge = document.createElement('span');
                    badge.className = 'ide-node-item-badge cond';
                    badge.textContent = 'IF';
                    badge.title = `Shown only if: ${conditionToText(node.condition)}`;
                    head.appendChild(badge);
                }

                const spacer = document.createElement('span');
                spacer.style.flex = '1';
                head.appendChild(spacer);

                const playBtn = document.createElement('button');
                playBtn.type = 'button';
                playBtn.className = 'ide-node-item-play';
                playBtn.title = 'Preview from this node';
                playBtn.innerHTML = '<i class="fas fa-play"></i>';
                playBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    previewFromNode(id);
                });
                head.appendChild(playBtn);

                item.appendChild(head);

                const preview = document.createElement('div');
                preview.className = 'ide-node-item-preview';
                const previewText = (node.speakerText || '(empty)').replace(/\s+/g, ' ').slice(0, 80);
                preview.textContent = previewText;
                item.appendChild(preview);

                item.addEventListener('click', () => {
                    state.selectedNodeId = id;
                    renderNodeList();
                    renderForm();
                });
                nodeListEl.appendChild(item);
            }
        }

        function renderForm() {
            formPaneEl.innerHTML = '';
            const nodeId = state.selectedNodeId;
            if (!nodeId || !state.tree.nodes[nodeId]) {
                const empty = document.createElement('div');
                empty.className = 'ide-empty';
                empty.textContent = 'Select a node to edit, or add one.';
                formPaneEl.appendChild(empty);
                return;
            }
            const node = state.tree.nodes[nodeId];
            const isStart = nodeId === state.tree.startNodeId;

            const form = document.createElement('div');
            form.className = 'ide-form';
            form.innerHTML = `
                <div class="ide-field">
                    <label>Node ID</label>
                    <input class="ide-field-id" type="text" />
                    <div class="ide-field-hint">Renaming auto-updates choices pointing here.</div>
                </div>
                <div class="ide-field">
                    <label>Speaker text</label>
                    <textarea class="ide-field-text" rows="4" placeholder="What this NPC says when this node is shown…"></textarea>
                    <div class="ide-field-hint">On a rumour node, this becomes the lead-in shown above the drawn rumour.</div>
                </div>
                <div class="ide-field">
                    <label><i class="fas fa-code-branch"></i> Show only if (optional)</label>
                    <input class="ide-field-condition" type="text" placeholder="e.g. quest_accepted, !quest_done — empty = always" />
                    <div class="ide-target-row">
                        <label>Else go to →</label>
                        <select class="ide-field-fallback"></select>
                    </div>
                    <div class="ide-field-hint">Flags set by choices; "!flag" = must be unset. <code>${VISITED_PREFIX}start</code> = "we have spoken before". Several flags (comma-separated) must all match.</div>
                </div>
                <div class="ide-field">
                    <label><i class="fas fa-dice-d20"></i> Rumour table (optional)</label>
                    <input class="ide-field-rumourtable" type="text" placeholder="Name of a Foundry RollTable, e.g. Tavern Rumours" />
                    <div class="ide-field-hint">If set, this node draws a random entry from that RollTable each time it is shown. Point a choice's target back at <em>this same node</em> to make a "Tell me another" re-roll.</div>
                    <textarea class="ide-field-rumours" rows="3" placeholder="…or type inline rumours here, one per line (overrides the table above)."></textarea>
                </div>
                <div class="ide-field">
                    <div class="ide-field-row-header">
                        <label>Choices</label>
                        <button class="ide-add-choice" type="button">+ Add choice</button>
                    </div>
                    <div class="ide-choices-list"></div>
                </div>
                <div class="ide-form-actions">
                    <button class="ide-set-start" type="button" ${isStart ? 'disabled' : ''}>${isStart ? 'This is the start node' : 'Set as start node'}</button>
                    <div class="ide-spacer"></div>
                    <button class="ide-delete-node" type="button">Delete node</button>
                </div>
            `;
            formPaneEl.appendChild(form);

            const idInput = form.querySelector('.ide-field-id');
            idInput.value = nodeId;
            idInput.addEventListener('change', () => {
                const newId = idInput.value.trim();
                if (newId === nodeId) return;
                if (!newId) { setStatus('Node ID cannot be empty.', 'error'); idInput.value = nodeId; return; }
                if (state.tree.nodes[newId]) { setStatus(`Node ID "${newId}" already exists.`, 'error'); idInput.value = nodeId; return; }
                state.tree.nodes[newId] = node;
                delete state.tree.nodes[nodeId];
                if (state.tree.startNodeId === nodeId) state.tree.startNodeId = newId;
                for (const other of Object.values(state.tree.nodes)) {
                    if (other.fallbackNodeId === nodeId) other.fallbackNodeId = newId;
                    for (const ch of (other.choices || [])) {
                        if (ch.nextNodeId === nodeId) ch.nextNodeId = newId;
                        if (ch.failNodeId === nodeId) ch.failNodeId = newId;
                        if (ch.critNodeId === nodeId) ch.critNodeId = newId;
                        if (ch.fumbleNodeId === nodeId) ch.fumbleNodeId = newId;
                    }
                }
                state.selectedNodeId = newId;
                setStatus(`Renamed to "${newId}".`, 'info');
                renderAll();
            });

            const textArea = form.querySelector('.ide-field-text');
            textArea.value = node.speakerText || '';
            textArea.addEventListener('input', () => {
                node.speakerText = textArea.value;
                const sel = nodeListEl.querySelector('.ide-node-item.selected .ide-node-item-preview');
                if (sel) sel.textContent = (textArea.value || '(empty)').replace(/\s+/g, ' ').slice(0, 80);
            });

            const conditionInput = form.querySelector('.ide-field-condition');
            conditionInput.value = conditionToText(node.condition);
            conditionInput.addEventListener('change', () => {
                const parsed = parseConditionText(conditionInput.value);
                if (parsed) node.condition = parsed; else delete node.condition;
                renderNodeList();
            });

            const fallbackSelect = form.querySelector('.ide-field-fallback');
            fallbackSelect.innerHTML = nodeIdOptions(node.fallbackNodeId ?? null, { endLabel: '[End conversation]' });
            fallbackSelect.addEventListener('change', () => {
                if (fallbackSelect.value) node.fallbackNodeId = fallbackSelect.value;
                else delete node.fallbackNodeId;
            });

            const rumourTableInput = form.querySelector('.ide-field-rumourtable');
            rumourTableInput.value = node.rumourTable || '';
            rumourTableInput.addEventListener('input', () => {
                const v = rumourTableInput.value.trim();
                if (v) node.rumourTable = v; else delete node.rumourTable;
            });

            const rumoursInput = form.querySelector('.ide-field-rumours');
            rumoursInput.value = Array.isArray(node.rumours)
                ? node.rumours.map(r => (typeof r === 'string' ? r : r?.text || '')).join('\n')
                : '';
            rumoursInput.addEventListener('input', () => {
                const lines = rumoursInput.value.split('\n').map(s => s.trim()).filter(Boolean);
                if (lines.length) node.rumours = lines; else delete node.rumours;
            });

            const choicesList = form.querySelector('.ide-choices-list');
            renderChoices(node, choicesList);

            form.querySelector('.ide-add-choice').addEventListener('click', () => {
                if (!Array.isArray(node.choices)) node.choices = [];
                node.choices.push({ text: '', nextNodeId: null });
                renderChoices(node, choicesList);
            });

            form.querySelector('.ide-set-start').addEventListener('click', () => {
                if (isStart) return;
                state.tree.startNodeId = nodeId;
                setStatus(`"${nodeId}" is now the start node.`, 'info');
                renderAll();
            });

            form.querySelector('.ide-delete-node').addEventListener('click', () => {
                if (Object.keys(state.tree.nodes).length === 1) {
                    setStatus("Can't delete the last node.", 'error');
                    return;
                }
                if (!confirm(`Delete node "${nodeId}"? Choices pointing to it will become orphaned.`)) return;
                delete state.tree.nodes[nodeId];
                if (state.tree.startNodeId === nodeId) state.tree.startNodeId = Object.keys(state.tree.nodes)[0];
                state.selectedNodeId = state.tree.startNodeId;
                setStatus(`Deleted node "${nodeId}".`, 'info');
                renderAll();
            });
        }

        // UI-only expansion state for the optional per-choice sections, so an
        // opened-but-empty section doesn't write junk fields into the tree.
        const degreesExpanded = new WeakSet();
        const cfxExpanded = new WeakSet();

        function renderChoices(node, container) {
            container.innerHTML = '';
            const choices = Array.isArray(node.choices) ? node.choices : (node.choices = []);
            if (choices.length === 0) {
                const hint = document.createElement('div');
                hint.className = 'ide-empty ide-empty-thin';
                hint.textContent = 'No choices — node will auto-show an [End conversation] button.';
                container.appendChild(hint);
                return;
            }
            choices.forEach((choice, idx) => {
                const hasCheck = !!choice.check;
                const row = document.createElement('div');
                row.className = 'ide-choice-row' + (hasCheck ? ' has-check' : '');
                row.innerHTML = `
                    <div class="ide-choice-main">
                        <span class="ide-choice-num">${idx + 1}.</span>
                        <input class="ide-choice-text" type="text" placeholder="Choice text…" />
                        <button class="ide-choice-up" type="button" title="Move up">↑</button>
                        <button class="ide-choice-down" type="button" title="Move down">↓</button>
                        <button class="ide-choice-delete" type="button" title="Delete choice">×</button>
                    </div>
                    <div class="ide-choice-targets"></div>
                    <div class="ide-choice-check"></div>
                    <div class="ide-choice-cfx"></div>
                `;
                container.appendChild(row);

                const textInput = row.querySelector('.ide-choice-text');
                textInput.value = choice.text || '';
                textInput.addEventListener('input', () => { choice.text = textInput.value; });

                row.querySelector('.ide-choice-up').addEventListener('click', () => {
                    if (idx === 0) return;
                    [choices[idx - 1], choices[idx]] = [choices[idx], choices[idx - 1]];
                    renderChoices(node, container);
                });
                row.querySelector('.ide-choice-down').addEventListener('click', () => {
                    if (idx === choices.length - 1) return;
                    [choices[idx + 1], choices[idx]] = [choices[idx], choices[idx + 1]];
                    renderChoices(node, container);
                });
                row.querySelector('.ide-choice-delete').addEventListener('click', () => {
                    choices.splice(idx, 1);
                    renderChoices(node, container);
                });

                const targetsEl = row.querySelector('.ide-choice-targets');
                if (hasCheck) {
                    const hasDegrees = choice.critNodeId !== undefined || choice.fumbleNodeId !== undefined
                        || degreesExpanded.has(choice);
                    targetsEl.innerHTML = `
                        <div class="ide-target-row">
                            <label>On success →</label>
                            <select class="ide-choice-success">${nodeIdOptions(choice.nextNodeId ?? null)}</select>
                        </div>
                        <div class="ide-target-row">
                            <label>On failure →</label>
                            <select class="ide-choice-fail">${nodeIdOptions(choice.failNodeId ?? null)}</select>
                        </div>
                        <label class="ide-degrees-toggle" title="Separate targets for critical success and critical failure (PF2e degrees of success)">
                            <input type="checkbox" ${hasDegrees ? 'checked' : ''} />
                            <span>Degrees of success</span>
                        </label>
                        ${hasDegrees ? `
                        <div class="ide-target-row">
                            <label>On crit success →</label>
                            <select class="ide-choice-crit">${nodeIdOptions(choice.critNodeId, { inheritLabel: '(same as success)' })}</select>
                        </div>
                        <div class="ide-target-row">
                            <label>On crit failure →</label>
                            <select class="ide-choice-fumble">${nodeIdOptions(choice.fumbleNodeId, { inheritLabel: '(same as failure)' })}</select>
                        </div>` : ''}
                    `;
                    targetsEl.querySelector('.ide-choice-success').addEventListener('change', (e) => {
                        choice.nextNodeId = e.target.value || null;
                    });
                    targetsEl.querySelector('.ide-choice-fail').addEventListener('change', (e) => {
                        choice.failNodeId = e.target.value || null;
                    });
                    targetsEl.querySelector('.ide-degrees-toggle input').addEventListener('change', (e) => {
                        if (e.target.checked) {
                            // Both tiers start as "(same as …)" — nothing stored yet.
                            degreesExpanded.add(choice);
                        } else {
                            degreesExpanded.delete(choice);
                            delete choice.critNodeId;
                            delete choice.fumbleNodeId;
                        }
                        renderChoices(node, container);
                    });
                    const critSelect = targetsEl.querySelector('.ide-choice-crit');
                    critSelect?.addEventListener('change', () => {
                        if (critSelect.value === '__inherit__') delete choice.critNodeId;
                        else choice.critNodeId = critSelect.value || null;
                    });
                    const fumbleSelect = targetsEl.querySelector('.ide-choice-fumble');
                    fumbleSelect?.addEventListener('change', () => {
                        if (fumbleSelect.value === '__inherit__') delete choice.fumbleNodeId;
                        else choice.fumbleNodeId = fumbleSelect.value || null;
                    });
                } else {
                    targetsEl.innerHTML = `
                        <div class="ide-target-row">
                            <label>Goes to →</label>
                            <select class="ide-choice-target">${nodeIdOptions(choice.nextNodeId ?? null)}</select>
                        </div>
                    `;
                    targetsEl.querySelector('.ide-choice-target').addEventListener('change', (e) => {
                        choice.nextNodeId = e.target.value || null;
                    });
                }

                const checkEl = row.querySelector('.ide-choice-check');
                if (hasCheck) {
                    const currentSkill = String(choice.check.skill || '').toLowerCase();
                    const skillOpts = PF2E_SKILLS.map(s => {
                        const sel = s === currentSkill ? ' selected' : '';
                        return `<option value="${s}"${sel}>${s[0].toUpperCase() + s.slice(1)}</option>`;
                    }).join('');
                    checkEl.innerHTML = `
                        <div class="ide-check-header">
                            <span class="ide-check-label"><i class="fas fa-dice-d20"></i> Skill Check</span>
                            <button class="ide-check-remove" type="button">Remove check</button>
                        </div>
                        <div class="ide-check-fields">
                            <label>Skill</label>
                            <select class="ide-check-skill">${skillOpts}</select>
                            <label>DC</label>
                            <input class="ide-check-dc" type="number" min="1" max="60" />
                        </div>
                        <label class="ide-check-secret" title="Roll blind: the player sees a neutral transition instead of the outcome">
                            <input type="checkbox" ${choice.check.secret ? 'checked' : ''} />
                            <span>Secret roll (player doesn't see the result)</span>
                        </label>
                    `;
                    const dcInput = checkEl.querySelector('.ide-check-dc');
                    dcInput.value = choice.check.dc ?? 15;
                    checkEl.querySelector('.ide-check-skill').addEventListener('change', (e) => {
                        choice.check.skill = e.target.value;
                    });
                    dcInput.addEventListener('input', () => {
                        const n = Number(dcInput.value);
                        if (Number.isFinite(n)) choice.check.dc = n;
                    });
                    checkEl.querySelector('.ide-check-secret input').addEventListener('change', (e) => {
                        if (e.target.checked) choice.check.secret = true;
                        else delete choice.check.secret;
                    });
                    checkEl.querySelector('.ide-check-remove').addEventListener('click', () => {
                        delete choice.check;
                        delete choice.failNodeId;
                        delete choice.critNodeId;
                        delete choice.fumbleNodeId;
                        degreesExpanded.delete(choice);
                        renderChoices(node, container);
                    });
                } else {
                    checkEl.innerHTML = `<button class="ide-check-add" type="button"><i class="fas fa-dice-d20"></i> Add skill check</button>`;
                    checkEl.querySelector('.ide-check-add').addEventListener('click', () => {
                        choice.check = { skill: 'diplomacy', dc: 15 };
                        if (choice.failNodeId === undefined) choice.failNodeId = null;
                        renderChoices(node, container);
                    });
                }

                // Conditions / effects: when to show this choice, which flags it
                // sets, and whether it disappears after being picked.
                const cfxEl = row.querySelector('.ide-choice-cfx');
                const hasCfx = choice.condition != null || choice.setFlags != null || choice.once != null
                    || cfxExpanded.has(choice);
                if (hasCfx) {
                    cfxEl.innerHTML = `
                        <div class="ide-check-header">
                            <span class="ide-cfx-label"><i class="fas fa-code-branch"></i> Conditions / Effects</span>
                            <button class="ide-cfx-remove" type="button">Remove</button>
                        </div>
                        <div class="ide-cfx-fields">
                            <label>Show if</label>
                            <input class="ide-cfx-condition" type="text" placeholder="e.g. quest_accepted, !quest_done — empty = always" />
                            <label>Sets</label>
                            <input class="ide-cfx-setflags" type="text" placeholder="e.g. quest_accepted (or !flag to clear)" />
                        </div>
                        <label class="ide-cfx-once">
                            <input type="checkbox" ${choice.once ? 'checked' : ''} />
                            <span>One-time — hide after it has been picked</span>
                        </label>
                    `;
                    const condInput = cfxEl.querySelector('.ide-cfx-condition');
                    condInput.value = conditionToText(choice.condition);
                    condInput.addEventListener('change', () => {
                        const parsed = parseConditionText(condInput.value);
                        if (parsed) choice.condition = parsed; else delete choice.condition;
                    });
                    const setInput = cfxEl.querySelector('.ide-cfx-setflags');
                    setInput.value = setFlagsToText(choice.setFlags);
                    setInput.addEventListener('change', () => {
                        const parsed = parseSetFlagsText(setInput.value);
                        if (parsed) choice.setFlags = parsed; else delete choice.setFlags;
                    });
                    cfxEl.querySelector('.ide-cfx-once input').addEventListener('change', (e) => {
                        if (e.target.checked) choice.once = true;
                        else delete choice.once;
                    });
                    cfxEl.querySelector('.ide-cfx-remove').addEventListener('click', () => {
                        delete choice.condition;
                        delete choice.setFlags;
                        delete choice.once;
                        cfxExpanded.delete(choice);
                        renderChoices(node, container);
                    });
                } else {
                    cfxEl.innerHTML = `<button class="ide-cfx-add" type="button"><i class="fas fa-code-branch"></i> Add conditions / effects</button>`;
                    cfxEl.querySelector('.ide-cfx-add').addEventListener('click', () => {
                        cfxExpanded.add(choice);
                        renderChoices(node, container);
                    });
                }
            });
        }

        function renderAll() {
            renderNodeList();
            renderForm();
        }

        renderAll();
    }
}
