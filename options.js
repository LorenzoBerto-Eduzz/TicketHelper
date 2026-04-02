'use strict';

// ── Enable toggle ──────────────────────────────────────────────────────────

const toggle = document.getElementById('toggle-enabled');
const badge  = document.getElementById('status-badge');

function updateBadge(enabled) {
  badge.textContent = enabled ? 'On' : 'Off';
  badge.className   = 'status-badge ' + (enabled ? 'status-on' : 'status-off');
}

chrome.storage.local.get('enabled', ({ enabled }) => {
  toggle.checked = !!enabled;
  updateBadge(!!enabled);
});

toggle.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: toggle.checked });
  updateBadge(toggle.checked);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('enabled' in changes)) return;
  const enabled = !!changes.enabled.newValue;
  toggle.checked = enabled;
  updateBadge(enabled);
});

// ── Edit shortcuts button ──────────────────────────────────────────────────

document.getElementById('btn-edit-shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// ── Read & display current shortcuts ──────────────────────────────────────

// Map Chrome command names to their display element IDs
// The extension action shortcut (_execute_action) is the toggle
const DISPLAY_MAP = {
  '_execute_action': 'sc-toggle',
  'copy-id':         'sc-copy-id',
  'copy-name':       'sc-copy-name',
  'copy-email':      'sc-copy-email',
  'copy-doc':        'sc-copy-doc'
};

function renderShortcut(elId, shortcut) {
  const el = document.getElementById(elId);
  if (!el) return;

  if (!shortcut) {
    el.innerHTML = '<span class="sc-none">não definido</span>';
    return;
  }

  // Split "Alt+Shift+1" into parts and render as kbd tags
  const parts = shortcut.split('+');
  el.innerHTML = parts.map((p, i) =>
    `<kbd>${p}</kbd>${i < parts.length - 1 ? '<span class="plus">+</span>' : ''}`
  ).join('');
}

// chrome.commands.getAll includes the action shortcut as _execute_action
chrome.commands.getAll((commands) => {
  for (const cmd of commands) {
    const elId = DISPLAY_MAP[cmd.name];
    if (elId) renderShortcut(elId, cmd.shortcut);
  }
});
