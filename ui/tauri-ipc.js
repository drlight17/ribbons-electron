const tauri = typeof window !== 'undefined' ? window.__TAURI__ : undefined;

export const hasTauri = !!(tauri && tauri.core);

export function invoke(command, args) {
    if (!hasTauri) return Promise.reject(new Error('Tauri API is unavailable'));
    return tauri.core.invoke(command, args);
}

export function send(event, payload) {
    if (!hasTauri) {
        console.log('[tauri:event]', event, payload);
        return Promise.resolve();
    }
    return tauri.core.invoke('renderer_message', { event, payload });
}

export function on(event, handler) {
    if (!hasTauri) return () => {};
    return tauri.event.listen(event, (message) => handler(message.payload));
}

export function currentWindow() {
    return hasTauri ? tauri.window.getCurrentWindow() : null;
}

export function closeCurrentWindow() {
    const win = currentWindow();
    if (win) return win.close();
    window.close();
    return Promise.resolve();
}
