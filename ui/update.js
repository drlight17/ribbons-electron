import { invoke, send, closeCurrentWindow } from './tauri-ipc.js';

const $ = (id) => document.getElementById(id);

function setText(id, value) {
    const el = $(id);
    if (el && value != null) el.textContent = value;
}

function decide(decision) {
    const remember = !!$('remember')?.checked;
    send('update-decision', { decision, remember }).finally(() => {
        try {
            const closing = closeCurrentWindow();
            if (closing && typeof closing.catch === 'function') closing.catch(() => {});
        } catch (_) {}
    });
}

try {
    const info = await invoke('get_update_info');
    const labels = info.labels || {};
    setText('title', labels.title || 'New version is available');
    setText('version', info.latestVersion || '');
    setText('ask', labels.ask || 'Do you want to visit the download page?');
    setText('yes', labels.yes || 'Yes');
    setText('no', labels.no || 'No');
    setText('install', labels.install || 'Update app');
    setText('rememberLabel', labels.remember || "Don't ask until the next release");

    if (info.installEnabled) {
        $('install').classList.remove('hidden');
    }
} catch (err) {
    console.warn('Failed to load update info:', err);
}

$('yes').addEventListener('click', () => decide('yes'));
$('no').addEventListener('click', () => decide('no'));
$('install').addEventListener('click', () => decide('install'));
window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') decide('no');
});
