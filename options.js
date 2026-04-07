'use strict';

const toggle = document.getElementById('toggle-enabled');
const toggleSwitch = toggle.closest('.switch');
const optionsPopup = document.getElementById('ticket-helper-popup');

const versionCurrentEl = document.getElementById('version-current');
const versionLatestEl = document.getElementById('version-latest');
const downloadUpdateBtn = document.getElementById('btn-download-update');
const refreshExtensionLink = document.getElementById('link-refresh-extension');

const RELEASES_API_URL = 'https://api.github.com/repos/LorenzoBerto-Eduzz/TicketHelper/releases/latest';
const EXTENSIONS_PAGE_URL = 'chrome://extensions';
const SHORTCUTS_PAGE_URL = 'chrome://extensions/shortcuts';
const OPTIONS_POPUP_POS_KEY = 'popupPosition_options';

let latestReleaseInfo = null;
let optionsBoTabState = { boTab1Assigned: false, boTab2Assigned: false, armedSlot: null };

const CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
const DOWNLOAD_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>';
const SEARCH_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>';
const ADD_SHORTCUT_BUTTON_HTML = '<span class="sc-add-wrap"><span class="sc-add-warning" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3L1 21h22L12 3zm1 13h-2v-5h2v5zm0 3h-2v-2h2v2z"/></svg></span><button type="button" class="sc-add-btn"><span class="sc-add-label">Adicionar</span></button></span>';

function setUpdateButtonState({ text, disabled, icon }) {
  const iconMarkup = icon === 'download' ? DOWNLOAD_ICON : icon === 'search' ? SEARCH_ICON : CHECK_ICON;
  downloadUpdateBtn.innerHTML = `${iconMarkup}<span>${text}</span>`;
  downloadUpdateBtn.disabled = disabled;
}

function safeSetLocal(data) {
  try {
    if (!chrome?.storage?.local?.set) return;
    chrome.storage.local.set(data, () => {
      void chrome.runtime?.lastError;
    });
  } catch {
    // no-op on options context transitions
  }
}

function setOptionsPopupVisible(enabled) {
  if (!optionsPopup) return;
  optionsPopup.style.display = enabled ? 'flex' : 'none';
}

function clampOptionsPopup(save = false) {
  if (!optionsPopup) return;

  const left = parseFloat(optionsPopup.style.left) || 0;
  const top = parseFloat(optionsPopup.style.top) || 0;
  const width = optionsPopup.offsetWidth;
  const height = optionsPopup.offsetHeight;
  const margin = 10;

  const clampedLeft = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  const clampedTop = Math.max(margin, Math.min(top, window.innerHeight - height - margin));

  if (clampedLeft !== left || clampedTop !== top) {
    optionsPopup.style.left = `${clampedLeft}px`;
    optionsPopup.style.top = `${clampedTop}px`;
  }

  optionsPopup.style.right = 'auto';
  optionsPopup.style.bottom = 'auto';

  if (save) {
    safeSetLocal({ [OPTIONS_POPUP_POS_KEY]: { left: clampedLeft, top: clampedTop } });
  }
}

function bindOptionsPopupDragging() {
  if (!optionsPopup) return;
  const handle = optionsPopup.querySelector('.th-drag-handle');
  if (!handle) return;

  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  handle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    dragging = true;
    const rect = optionsPopup.getBoundingClientRect();
    optionsPopup.style.left = `${rect.left}px`;
    optionsPopup.style.top = `${rect.top}px`;
    optionsPopup.style.right = 'auto';
    optionsPopup.style.bottom = 'auto';
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (event) => {
    if (!dragging) return;
    optionsPopup.style.left = `${event.clientX - offsetX}px`;
    optionsPopup.style.top = `${event.clientY - offsetY}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    clampOptionsPopup(true);
  });
}

function bindOptionsPopupButtons() {
  if (!optionsPopup) return;

  const closeBtn = optionsPopup.querySelector('#th-btn-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      toggle.checked = false;
      setOptionsPopupVisible(false);
      chrome.storage.local.set({ enabled: false });
    });
  }

  const boTab1Btn = optionsPopup.querySelector('#th-btn-botab1');
  if (boTab1Btn) {
    boTab1Btn.addEventListener('click', async () => {
      const resp = await sendMessageToBackground({ action: 'ARM_BO_TAB', slot: 1 });
      applyOptionsBoTabState(resp?.state);
    });
  }

  const boTab2Btn = optionsPopup.querySelector('#th-btn-botab2');
  if (boTab2Btn) {
    boTab2Btn.addEventListener('click', async () => {
      const resp = await sendMessageToBackground({ action: 'ARM_BO_TAB', slot: 2 });
      applyOptionsBoTabState(resp?.state);
    });
  }

  const boResetBtn = optionsPopup.querySelector('#th-btn-bo-reset');
  if (boResetBtn) {
    boResetBtn.addEventListener('click', async () => {
      const resp = await sendMessageToBackground({ action: 'RESET_BO_TABS' });
      applyOptionsBoTabState(resp?.state);
    });
  }
}

function initOptionsPopup() {
  if (!optionsPopup) return;

  bindOptionsPopupDragging();
  bindOptionsPopupButtons();
  renderOptionsBoTabButtons();
  requestOptionsBoTabState();

  chrome.storage.local.get(OPTIONS_POPUP_POS_KEY, (data) => {
    const pos = data[OPTIONS_POPUP_POS_KEY];

    if (pos?.left != null && pos?.top != null) {
      optionsPopup.style.left = `${pos.left}px`;
      optionsPopup.style.top = `${pos.top}px`;
    } else {
      optionsPopup.style.left = `${window.innerWidth - 390}px`;
      optionsPopup.style.top = `${window.innerHeight - 160}px`;
    }

    optionsPopup.style.visibility = 'visible';
    clampOptionsPopup();
  });
}

function sendMessageToBackground(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        void chrome.runtime.lastError;
        resolve(response ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

function renderOptionsBoTabButtons() {
  if (!optionsPopup) return;

  const bo1Btn = optionsPopup.querySelector('#th-btn-botab1');
  const bo2Btn = optionsPopup.querySelector('#th-btn-botab2');
  if (!bo1Btn || !bo2Btn) return;

  const setVisual = (btn, slot, assigned) => {
    btn.classList.toggle('is-assigned', !!assigned);
    btn.classList.toggle('is-armed', optionsBoTabState.armedSlot === slot);
  };

  setVisual(bo1Btn, 1, optionsBoTabState.boTab1Assigned);
  setVisual(bo2Btn, 2, optionsBoTabState.boTab2Assigned);
}

function applyOptionsBoTabState(state) {
  if (!state) return;
  optionsBoTabState = {
    boTab1Assigned: !!state.boTab1Assigned,
    boTab2Assigned: !!state.boTab2Assigned,
    armedSlot: state.armedSlot ?? null
  };
  renderOptionsBoTabButtons();
}

async function requestOptionsBoTabState() {
  const response = await sendMessageToBackground({ action: 'GET_BO_TAB_STATE' });
  applyOptionsBoTabState(response?.state);
}

function closeOptionsTab() {
  chrome.tabs.getCurrent((tab) => {
    if (tab && typeof tab.id === 'number') {
      chrome.tabs.remove(tab.id);
      return;
    }
    window.close();
  });
}

function normalizeVersion(version) {
  return String(version || '').trim().replace(/^v/i, '');
}

function findZipAsset(assets) {
  if (!Array.isArray(assets)) return null;

  const exact = assets.find((asset) => String(asset.name || '').toLowerCase() === 'tickethelper.zip');
  if (exact) return exact;

  const ticketHelperZip = assets.find((asset) => {
    const name = String(asset.name || '').toLowerCase();
    return name.includes('tickethelper') && name.endsWith('.zip');
  });
  if (ticketHelperZip) return ticketHelperZip;

  return assets.find((asset) => String(asset.name || '').toLowerCase().endsWith('.zip')) || null;
}

async function fetchLatestRelease() {
  const response = await fetch(RELEASES_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json'
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`Failed release check (${response.status})`);
  }

  const payload = await response.json();
  const zipAsset = findZipAsset(payload.assets);

  return {
    version: normalizeVersion(payload.tag_name),
    assetUrl: zipAsset ? zipAsset.browser_download_url : '',
    assetName: zipAsset ? zipAsset.name : 'TicketHelper.zip',
    releasePageUrl: payload.html_url || 'https://github.com/LorenzoBerto-Eduzz/TicketHelper/releases'
  };
}

async function checkVersionAndUpdateState() {
  const currentVersion = normalizeVersion(chrome.runtime.getManifest().version);

  versionCurrentEl.textContent = currentVersion;
  versionLatestEl.textContent = 'Verificando...';
  setUpdateButtonState({ text: 'Pesquisando versões', disabled: true, icon: 'search' });

  try {
    latestReleaseInfo = await fetchLatestRelease();

    versionLatestEl.textContent = latestReleaseInfo.version || 'Indispon\u00edvel';

    if (!latestReleaseInfo.version) {
      setUpdateButtonState({ text: 'N\u00e3o foi poss\u00edvel verificar vers\u00f5es', disabled: true, icon: 'search' });
      return;
    }

    if (latestReleaseInfo.version === currentVersion) {
      setUpdateButtonState({ text: 'Vers\u00e3o mais recente em uso', disabled: true, icon: 'check' });
      return;
    }

    if (!latestReleaseInfo.assetUrl) {
      setUpdateButtonState({ text: 'Vers\u00e3o mais recente em uso', disabled: true, icon: 'check' });
      return;
    }

    setUpdateButtonState({ text: 'Baixar vers\u00e3o mais recente', disabled: false, icon: 'download' });
  } catch (error) {
    console.error('Version check failed:', error);
    versionLatestEl.textContent = 'Indispon\u00edvel';
    setUpdateButtonState({ text: 'N\u00e3o foi poss\u00edvel verificar vers\u00f5es', disabled: true, icon: 'search' });
  }
}

chrome.storage.local.get('enabled', ({ enabled }) => {
  const isEnabled = !!enabled;
  toggle.checked = isEnabled;
  setOptionsPopupVisible(isEnabled);
  toggleSwitch.classList.add('is-ready');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.remove('no-toggle-anim');
    });
  });
});

toggle.addEventListener('change', () => {
  setOptionsPopupVisible(toggle.checked);
  chrome.storage.local.set({ enabled: toggle.checked });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('enabled' in changes)) return;
  const enabled = !!changes.enabled.newValue;
  toggle.checked = enabled;
  setOptionsPopupVisible(enabled);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.action !== 'BO_TAB_STATE') return;
  applyOptionsBoTabState(message.state);
});

document.getElementById('btn-edit-shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: SHORTCUTS_PAGE_URL });
});

document.getElementById('sc-list').addEventListener('click', (event) => {
  if (!event.target.closest('.sc-add-btn')) return;
  chrome.tabs.create({ url: SHORTCUTS_PAGE_URL });
});

refreshExtensionLink.addEventListener('click', (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: EXTENSIONS_PAGE_URL });
});

downloadUpdateBtn.addEventListener('click', () => {
  if (!latestReleaseInfo || !latestReleaseInfo.assetUrl) return;

  setUpdateButtonState({ text: 'Baixando vers\u00e3o mais recente...', disabled: true, icon: 'download' });

  chrome.downloads.download(
    {
      url: latestReleaseInfo.assetUrl,
      filename: latestReleaseInfo.assetName || 'TicketHelper.zip',
      saveAs: false,
      conflictAction: 'uniquify'
    },
    (downloadId) => {
      if (chrome.runtime.lastError || !downloadId) {
        console.error('Download failed:', chrome.runtime.lastError);
        setUpdateButtonState({ text: 'Baixar vers\u00e3o mais recente', disabled: false, icon: 'download' });
        return;
      }

      chrome.downloads.show(downloadId);
      chrome.tabs.create({ url: EXTENSIONS_PAGE_URL });

      setUpdateButtonState({ text: 'Baixar vers\u00e3o mais recente', disabled: false, icon: 'download' });
      closeOptionsTab();
    }
  );
});

const DISPLAY_MAP = {
  '_execute_action': 'sc-toggle',
  'copy-id': 'sc-copy-id',
  'copy-name': 'sc-copy-name',
  'copy-email': 'sc-copy-email',
  'copy-doc': 'sc-copy-doc'
};

function renderShortcut(elId, shortcut) {
  const el = document.getElementById(elId);
  if (!el) return;

  if (!shortcut) {
    el.innerHTML = ADD_SHORTCUT_BUTTON_HTML;
    return;
  }

  const parts = shortcut.split('+');
  el.innerHTML = parts
    .map((part, index) => `<kbd>${part}</kbd>${index < parts.length - 1 ? '<span class="plus">+</span>' : ''}`)
    .join('');
}

chrome.commands.getAll((commands) => {
  for (const cmd of commands) {
    const elId = DISPLAY_MAP[cmd.name];
    if (elId) renderShortcut(elId, cmd.shortcut);
  }
});

window.addEventListener('resize', () => clampOptionsPopup());
initOptionsPopup();
checkVersionAndUpdateState();
