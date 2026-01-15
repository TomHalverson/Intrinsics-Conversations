const api = game.modules.get('intrinsics-conversations')?.api;
if (!api || !api.conversationGroups) {
    ui.notifications.error('Intrinsic\'s Conversations module not found!');
    throw new Error("Module not found");
}

const selectedTokens = canvas.tokens.controlled;
if (selectedTokens.length === 0) {
    ui.notifications.warn('Please select a token that belongs to a conversation group!');
    throw new Error("No tokens selected");
}

const token = selectedTokens[0];

// Find all conversation groups this token belongs to
const conversations = api.conversationGroups.getTokenConversations(token.id);

if (conversations.length === 0) {
    ui.notifications.warn(`${token.name} is not part of any conversation group!`);
    throw new Error("No conversations found");
}

// If only one conversation, trigger it directly
if (conversations.length === 1) {
    const conv = conversations[0];
    const statusText = conv.enabled ? '' : ' (Currently Paused)';

    new Dialog({
        title: `Trigger Conversation: ${conv.name}`,
        content: `
            <div style="margin-bottom: 15px;">
                <p><strong>Token:</strong> ${token.name}</p>
                <p><strong>Conversation:</strong> ${conv.name}</p>
                <p><strong>Mode:</strong> ${conv.mode}</p>
                <p><strong>Status:</strong> ${conv.enabled ? 'Enabled' : 'Paused'}${statusText}</p>
            </div>
            <hr style="margin: 15px 0;">
            <p style="font-size: 12px; color: #999;">
                This will play through the entire conversation from the beginning, using the configured delay between lines.
                Range and cooldown checks are bypassed.
            </p>
        `,
        buttons: {
            trigger: {
                icon: '<i class="fas fa-play"></i>',
                label: 'Play Conversation',
                callback: async () => {
                    try {
                        await api.conversationGroups.manuallyTrigger(conv.groupId);
                    } catch (error) {
                        console.error("Error playing conversation:", error);
                        ui.notifications.error('Failed to play conversation');
                    }
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: 'Cancel'
            }
        },
        default: 'trigger'
    }).render(true);
} else {
    // Multiple conversations - let user choose
    let conversationOptions = '';
    for (let conv of conversations) {
        const statusBadge = conv.enabled
            ? '<span style="color: #4CAF50;">[ON]</span>'
            : '<span style="color: #f44336;">[OFF]</span>';
        conversationOptions += `
            <div style="padding: 10px; margin-bottom: 10px; background: #2a2a2a; border-radius: 4px; border-left: 3px solid ${conv.enabled ? '#4CAF50' : '#f44336'};">
                <label style="cursor: pointer; display: block;">
                    <input type="radio" name="conversation" value="${conv.groupId}" style="margin-right: 8px;">
                    <strong>${conv.name}</strong> ${statusBadge}
                    <br>
                    <span style="font-size: 11px; color: #999; margin-left: 24px;">Mode: ${conv.mode}</span>
                </label>
            </div>
        `;
    }

    const dialogContent = `
        <div style="margin-bottom: 15px;">
            <p><strong>Token:</strong> ${token.name}</p>
            <p style="font-size: 12px; color: #999;">This token belongs to ${conversations.length} conversation groups. Select one to trigger:</p>
        </div>
        <hr style="margin: 15px 0;">
        <div style="max-height: 300px; overflow-y: auto;">
            ${conversationOptions}
        </div>
        <hr style="margin: 15px 0;">
        <p style="font-size: 11px; color: #999;">
            This will play through the entire selected conversation from the beginning, using the configured delay between lines.
            Range and cooldown checks are bypassed.
        </p>
    `;

    new Dialog({
        title: `Select Conversation to Trigger`,
        content: dialogContent,
        buttons: {
            trigger: {
                icon: '<i class="fas fa-play"></i>',
                label: 'Play Selected',
                callback: async (html) => {
                    const selectedGroupId = html.find('input[name="conversation"]:checked').val();

                    if (!selectedGroupId) {
                        ui.notifications.warn('Please select a conversation');
                        return;
                    }

                    const conv = conversations.find(c => c.groupId === selectedGroupId);

                    try {
                        await api.conversationGroups.manuallyTrigger(selectedGroupId);
                    } catch (error) {
                        console.error("Error playing conversation:", error);
                        ui.notifications.error('Failed to play conversation');
                    }
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: 'Cancel'
            }
        },
        default: 'trigger'
    }).render(true);
}
