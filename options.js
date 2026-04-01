'use strict';

const toggle = document.getElementById('toggle-enabled');
const badge  = document.getElementById('status-badge');

const versionCurrentEl = document.getElementById('version-current');
const versionLatestEl = document.getElementById('version-latest');
const downloadUpdateBtn = document.getElementById('btn-download-update');
const refreshExtensionLink = document.getElementById('link-refresh-extension');

const RELEASES_API_URL = 'https://api.github.com/repos/LorenzoBerto-Eduzz/TicketHelper/releases/latest';
const EXTENSIONS_PAGE_URL = 'chrome://extensions';

let latestReleaseInfo = null;

function updateBadge(enabled) {
  badge.textContent = enabled ? 'On' : 'Off';
  badge.className = 'status-badge ' + (enabled ? 'status-on' : 'status-off');
}

function setUpdateButtonState({ text, disabled }) {
  downloadUpdateBtn.textContent = text;
  downloadUpdateBtn.disabled = disabled;
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
  setUpdateButtonState({ text: 'Atualizado', disabled: true });

  try {
    latestReleaseInfo = await fetchLatestRelease();

    versionLatestEl.textContent = latestReleaseInfo.version || 'Indisponivel';

    if (!latestReleaseInfo.version) {
      setUpdateButtonState({ text: 'Atualizado', disabled: true });
      return;
    }

    if (latestReleaseInfo.version === currentVersion) {
      setUpdateButtonState({ text: 'Atualizado', disabled: true });
      return;
    }

    if (!latestReleaseInfo.assetUrl) {
      setUpdateButtonState({ text: 'Atualizado', disabled: true });
      return;
    }

    setUpdateButtonState({ text: 'Baixar vers\u00e3o mais recente', disabled: false });
  } catch (error) {
    console.error('Version check failed:', error);
    versionLatestEl.textContent = 'Indisponivel';
    setUpdateButtonState({ text: 'Atualizado', disabled: true });
  }
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

document.getElementById('btn-edit-shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

refreshExtensionLink.addEventListener('click', (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: EXTENSIONS_PAGE_URL });
});

downloadUpdateBtn.addEventListener('click', () => {
  if (!latestReleaseInfo || !latestReleaseInfo.assetUrl) return;

  setUpdateButtonState({ text: 'Baixando vers\u00e3o mais recente...', disabled: true });

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
        setUpdateButtonState({ text: 'Baixar vers\u00e3o mais recente', disabled: false });
        return;
      }

      chrome.downloads.show(downloadId);
      chrome.tabs.create({ url: EXTENSIONS_PAGE_URL });

      setUpdateButtonState({ text: 'Baixar vers\u00e3o mais recente', disabled: false });
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
    el.innerHTML = '<span class="sc-none">nao definido</span>';
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
