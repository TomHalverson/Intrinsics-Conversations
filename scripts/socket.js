import { MODULE_ID } from './constants.js';

// One socket listener for the whole module, dispatching on `action`. Feature
// modules register their handlers with onSocket() during setup.

const SOCKET_NAME = `module.${MODULE_ID}`;
const handlers = new Map();

export function onSocket(action, handler) {
    handlers.set(action, handler);
}

export function emitSocket(action, data) {
    game.socket.emit(SOCKET_NAME, { action, data, sender: game.user.id });
}

export function initSocket() {
    game.socket.on(SOCKET_NAME, (message) => {
        const handler = handlers.get(message?.action);
        if (handler) handler(message.data, message.sender);
    });
}
