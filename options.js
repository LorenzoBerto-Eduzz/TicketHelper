'use strict';

const toggle = document.getElementById('toggle-enabled');

const versionCurrentEl = document.getElementById('version-current');
const versionLatestEl = document.getElementById('version-latest');
const downloadUpdateBtn = document.getElementById('btn-download-update');
const refreshExtensionLink = document.getElementById('link-refresh-extension');

const RELEASES_API_URL = 'https://api.github.com/repos/LorenzoBerto-Eduzz/TicketHelper/releases/latest';
const EXTENSIONS_PAGE_URL = 'chrome://extensions';

let latestReleaseInfo = null;

const CHECK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
const DOWNLOAD_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>';
const SEARCH_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>';

function setUpdateButtonState({ text, disabled, icon }) {
  const iconMarkup = icon === 'download' ? DOWNLOAD_ICON : icon === 'search' ? SEARCH_ICON : CHECK_ICON;
  downloadUpdateBtn.innerHTML = `${iconMarkup}<span>${text}</span>`;
  downloadUpdateBtn.disabled = disabled;
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
  toggle.checked = !!enabled;
});

toggle.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: toggle.checked });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('enabled' in changes)) return;
  const enabled = !!changes.enabled.newValue;
  toggle.checked = enabled;
});

document.getElementById('btn-edit-shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
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
    el.innerHTML = '<span class="sc-none">n&atilde;o definido</span>';
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

checkVersionAndUpdateState();
