export const MODULE_ID = 'intrinsics-conversations';

// Actor flags (dialogue trees + rumours)
export const FLAGS = {
    TREE: 'dialogueTree',
    TREE_ENABLED: 'dialogueEnabled',
    RUMOURS_ENABLED: 'rumoursEnabled',
    RUMOUR_TABLE: 'rumourTable',
    RUMOUR_LIST: 'rumourList',
    RUMOUR_PROMPT: 'rumourPrompt',
    RUMOUR_LEADIN: 'rumourLeadIn',
    // Per-player dialogue memory (quest flags, visited nodes, picked choices),
    // keyed by user id: dialogueState.<userId> = { flags, visited, chosen }.
    DIALOGUE_STATE: 'dialogueState',
    // Actor flags for inline-JSON barks. 'dialogueAura' is the historical name
    // for ambient dialogue, kept so existing worlds migrate cleanly. Both were
    // token flags pointing at RollTables before the JSON switch; the systems
    // migrate that old shape onto the actor on ready.
    AMBIENT: 'dialogueAura',
    COMBAT: 'combatDialogue'
};

export const PF2E_SKILLS = [
    'acrobatics', 'arcana', 'athletics', 'crafting', 'deception',
    'diplomacy', 'intimidation', 'medicine', 'nature', 'occultism',
    'performance', 'religion', 'society', 'stealth', 'survival',
    'thievery', 'perception'
];

// Synthetic node id for the injected rumour node. Double underscores keep it
// from colliding with author-defined node ids.
export const RUMOUR_NODE_ID = '__rumours__';

// Condition flags with this prefix test the visited-nodes memory instead of an
// authored flag, e.g. { flag: "__visited__:start" } — "we have spoken before".
export const VISITED_PREFIX = '__visited__:';
export const DEFAULT_RUMOUR_PROMPT = 'Ask about any rumours';
