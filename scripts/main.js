import { MODULE_ID } from './constants.js';
import { initSocket } from './socket.js';
import { conversationDisplay, registerConversationDisplaySettings } from './conversation-display.js';
import { ambientDialogue, registerAmbientHooks } from './ambient-dialogue.js';
import { conversationGroups } from './conversation-groups.js';
import { combatDialogue } from './combat-dialogue.js';
import { dialogueRuntime, getTreeForToken, installDialogueRightClickListeners, EXAMPLE_TREE,
         registerDialogueTreeSettings, registerDialogueTreeSocket } from './dialogue-tree.js';
import { openDialogueEditor } from './dialogue-editor.js';
import { openDialogueHub } from './dialogue-hub.js';
import { registerTokenHudSettings, registerTokenHudHook } from './token-hud.js';
import { registerThemeSetting } from './theme.js';

Hooks.once('init', () => {
    registerThemeSetting();
    registerConversationDisplaySettings();
    registerTokenHudSettings();
    ambientDialogue.registerSettings();
    conversationGroups.registerSettings();
    combatDialogue.registerSettings();
    registerDialogueTreeSettings();
});

Hooks.once('ready', () => {
    initSocket();
    registerDialogueTreeSocket();

    conversationGroups.loadConversationGroups();
    ambientDialogue.setup();
    combatDialogue.setup();
    installDialogueRightClickListeners();

    if (!game.user.isGM) conversationDisplay.loadFromSetting();

    // Public API. Shapes are kept compatible with pre-2.0 macros.
    const module = game.modules.get(MODULE_ID);
    module.api = {
        // Conversation strip
        display: conversationDisplay,
        addCharacter: (token) => conversationDisplay.addCharacter(token),
        removeCharacter: (tokenId) => conversationDisplay.removeCharacter(tokenId),
        setSpeaker: (tokenId) => conversationDisplay.setSpeaker(tokenId),
        clearSpeaker: () => conversationDisplay.clearSpeaker(),
        show: () => conversationDisplay.show(),
        hide: () => conversationDisplay.hide(),
        clear: () => conversationDisplay.clearAll(),

        // The GM hub
        openHub: (token) => openDialogueHub(token),

        dialogueAura: {
            assignLines: (tokenId, lines, range) => ambientDialogue.assignLinesToToken(tokenId, lines, range),
            removeLines: (tokenId) => ambientDialogue.removeFromToken(tokenId),
            getAura: (tokenId) => ambientDialogue.getAuraConfig(tokenId),
            getAllAuras: () => ambientDialogue.getAllAuras(),
            updateRange: (tokenId, range) => ambientDialogue.updateAuraRange(tokenId, range),
            toggleAura: (tokenId, enabled) => ambientDialogue.toggleAura(tokenId, enabled),
            startMonitoring: () => ambientDialogue.startMonitoring(),
            stopMonitoring: () => ambientDialogue.stopMonitoring()
        },
        conversationGroups: {
            createGroup: (config) => conversationGroups.createConversationGroup(config),
            updateGroup: (groupId, config) => conversationGroups.updateConversationGroup(groupId, config),
            deleteGroup: (groupId) => conversationGroups.deleteConversationGroup(groupId),
            getGroup: (groupId) => conversationGroups.getConversationGroup(groupId),
            getAllGroups: () => conversationGroups.getConversationGroups(),
            getNPCConversations: (tokenId) => conversationGroups.getTokenConversations(tokenId),
            getStats: () => conversationGroups.getConversationStats(),
            reorderNPCs: (groupId, npcIds) => conversationGroups.reorderNPCs(groupId, npcIds),
            toggleConversation: (groupId, enabled) => conversationGroups.toggleConversation(groupId, enabled),
            resetConversation: (groupId) => conversationGroups.resetConversation(groupId),
            manuallyTrigger: (groupId) => conversationGroups.manuallyTriggerConversation(groupId),
            getTokenConversations: (tokenId) => conversationGroups.getTokenConversations(tokenId)
        },
        combatDialogue: {
            assignLinesToToken: (tokenId, lines, enabled) => combatDialogue.assignLinesToToken(tokenId, lines, enabled),
            removeFromToken: (tokenId) => combatDialogue.removeFromToken(tokenId),
            toggleForToken: (tokenId) => combatDialogue.toggleForToken(tokenId),
            getTokenConfig: (tokenId) => combatDialogue.getTokenConfig(tokenId),
            getTokensWithCombatDialogue: () => combatDialogue.getTokensWithCombatDialogue()
        }
    };

    // Dialogue tree API (kept at module.dialogue for pre-2.0 compatibility).
    module.dialogue = {
        start: (token, tree) => dialogueRuntime.start(token, tree),
        startForToken: (token) => {
            const tree = getTreeForToken(token);
            if (!tree) return ui.notifications.warn('No dialogue enabled for this token.');
            dialogueRuntime.start(token, tree);
        },
        openEditor: (actor) => openDialogueEditor(actor),
        end: () => dialogueRuntime.end(),
        exampleTree: () => structuredClone(EXAMPLE_TREE)
    };

    console.log(`${MODULE_ID} | ready (${game.user.isGM ? 'GM' : 'player'})`);
});

registerAmbientHooks();
registerTokenHudHook();
