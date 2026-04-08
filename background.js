'use strict';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// GLOBAL STATE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/** tabId â†’ ProcessObject  (the process for each ticket tab) */
const processes = new Map();

/** processId of the currently active (focused) ticket */
let activeProcessId = null;

/** The tab ID currently focused by the user */
let focusedTabId = null;

/** The most recently active ticket/chat tab â€” used for shortcut copy source */
let lastTicketTabId = null;

function persistLastTicketTabId(tabId) {
  lastTicketTabId = tabId;
  chrome.storage.session.set({ lastTicketTabId: tabId }).catch(() => {});
}

/** Manually assigned BO tabs */
let boTab1Id = null;
let boTab2Id = null;
let boAssignArmedSlot = null;

const BO_DASHBOARD_HOST = 'bo.eduzz.com';
const BO_DASHBOARD_PATH = '/dashboard';

function persistBOTabState() {
  chrome.storage.session.set({
    boTab1Id,
    boTab2Id,
    boAssignArmedSlot
  }).catch(() => {});
}

function isDashboardBOTabUrl(urlStr) {
  if (!urlStr) return false;
  try {
    const u = new URL(urlStr);
    return u.hostname === BO_DASHBOARD_HOST && u.pathname.startsWith(BO_DASHBOARD_PATH);
  } catch {
    return false;
  }
}

function getBOTabState() {
  return {
    boTab1Id,
    boTab2Id,
    boTab1Assigned: !!boTab1Id,
    boTab2Assigned: !!boTab2Id,
    armedSlot: boAssignArmedSlot
  };
}

function broadcastBOTabState() {
  const payload = { action: 'BO_TAB_STATE', state: getBOTabState() };
  chrome.runtime.sendMessage(payload, () => {
    void chrome.runtime.lastError;
  });
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) {
      if (typeof t.id === 'number') sendToTab(t.id, payload);
    }
  });
}

function setArmedBOTabSlot(slot, notify = true) {
  boAssignArmedSlot = slot;
  persistBOTabState();
  if (notify) broadcastBOTabState();
}

function setBOTabAssignment(slot, tabId, notify = true) {
  if (slot === 1) boTab1Id = tabId ?? null;
  if (slot === 2) boTab2Id = tabId ?? null;
  persistBOTabState();
  if (notify) broadcastBOTabState();
}

function clearBOTabAssignments(notify = true) {
  boTab1Id = null;
  boTab2Id = null;
  boAssignArmedSlot = null;
  persistBOTabState();
  if (notify) broadcastBOTabState();
}

function getAssignedBOTabId(slot) {
  return slot === 2 ? boTab2Id : boTab1Id;
}

function focusBOTab(tabId, callback) {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !isDashboardBOTabUrl(tab.url || '')) {
      callback(false);
      return;
    }

    chrome.tabs.update(tabId, { active: true }, () => {
      if (chrome.runtime.lastError) {
        callback(false);
        return;
      }
      chrome.windows.update(tab.windowId, { focused: true }, () => {
        void chrome.runtime.lastError;
        callback(true);
      });
    });
  });
}

function assignBOTabSlotFromArmedTab(slot, tabId) {
  const otherSlot = slot === 1 ? 2 : 1;
  const currentTargetTabId = getAssignedBOTabId(slot);
  const currentOtherTabId = getAssignedBOTabId(otherSlot);

  if (currentOtherTabId === tabId) {
    // If target already had another tab, swap them.
    // If target was empty, move currentOther to target and clear other.
    if (currentTargetTabId && currentTargetTabId !== tabId) {
      if (otherSlot === 1) boTab1Id = currentTargetTabId;
      else boTab2Id = currentTargetTabId;
    } else {
      if (otherSlot === 1) boTab1Id = null;
      else boTab2Id = null;
    }
  }

  if (slot === 1) boTab1Id = tabId;
  else boTab2Id = tabId;

  boAssignArmedSlot = null;
  persistBOTabState();
  broadcastBOTabState();
}

function assignArmedBOTabFromTab(tab) {
  if (!boAssignArmedSlot) return;
  if (!tab || typeof tab.id !== 'number') return;
  if (!isDashboardBOTabUrl(tab.url || '')) return;

  assignBOTabSlotFromArmedTab(boAssignArmedSlot, tab.id);
}

function clearAssignedBOTabIfRemoved(tabId) {
  let changed = false;
  if (boTab1Id === tabId) {
    boTab1Id = null;
    changed = true;
  }
  if (boTab2Id === tabId) {
    boTab2Id = null;
    changed = true;
  }
  if (changed) {
    persistBOTabState();
    broadcastBOTabState();
  }
}

function resolveAssignedBOTab1(callback) {
  if (!boTab1Id) {
    callback(null);
    return;
  }

  chrome.tabs.get(boTab1Id, (tab) => {
    if (chrome.runtime.lastError || !tab || !isDashboardBOTabUrl(tab.url || '')) {
      if (boTab1Id !== null) setBOTabAssignment(1, null);
      callback(null);
      return;
    }
    callback(tab);
  });
}

/** Is a BO search currently running? Only one at a time. */
let boSearchBusy = false;

/** Which processId owns the running BO search */
let boSearchOwner = null;

/**
 * If a new ticket arrives while boSearchBusy, we store it here.
 * Only one slot â€” always the LATEST ticket. Previous pending is discarded.
 */
let pendingProc = null;

/** Session cache: tabId â†’ { id, name, email, doc }
 *  Stored in chrome.storage.session so shortcuts work globally,
 *  but data is NOT persisted between browser sessions. */
let sessionCache = {};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UTILITIES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function isProcessActive(processId) {
  return processId === activeProcessId;
}

/**
 * Per-tab ownership check â€” used for BO result handlers.
 * A process is valid if it is still registered as the current process
 * for its own tab, regardless of which tab the user is looking at.
 * This allows multiple tabs to have concurrent searches without
 * dropping results just because focus moved elsewhere.
 */
function isProcessStillValid(proc) {
  if (proc.status === 'ABORTED') return false;
  const current = processes.get(proc.tabId);
  return current && current.processId === proc.processId;
}

function toTitleCase(str) {
  if (!str) return '';
  return str.trim().split(/\s+/).filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message, () => {
    void chrome.runtime.lastError; // suppress "no listener" errors
  });
}

function sendPopupUpdate(proc, fields = {}) {
  if (!proc) return;
  const mergedFields = { ...fields };
  if (!Object.prototype.hasOwnProperty.call(mergedFields, 'email')) {
    mergedFields.email = proc.email ?? null;
  }
  sendToTab(proc.tabId, {
    action: 'UPDATE_POPUP',
    processId: proc.processId,
    fields: mergedFields
  });
}

function syncSessionCache() {
  chrome.storage.session.set({ sessionCache }).catch(() => {});
}

function extractHubSpotTicketIdFromUrl(urlStr) {
  if (!urlStr) return null;
  const direct = (urlStr.match(/\/ticket\/(\d+)/) || [])[1];
  if (direct) return direct;

  try {
    const u = new URL(urlStr);
    const eschref = u.searchParams.get('eschref');
    if (!eschref) return null;
    const decoded = decodeURIComponent(eschref);
    return (decoded.match(/\/ticket\/(\d+)/) || [])[1] || null;
  } catch {
    return null;
  }
}

function extractTicketIdFromTabUrl(urlStr) {
  if (!urlStr) return null;

  try {
    const u = new URL(urlStr);

    if (u.hostname.includes('hubspot.com')) {
      return extractHubSpotTicketIdFromUrl(urlStr);
    }

    if (u.hostname === 'conversas.hyperflow.global') {
      const m = u.pathname.match(/\/chats\/(\d+)/) || u.pathname.match(/\/all-chats\/(\d+)/);
      return m ? m[1] : null;
    }
  } catch {
    return null;
  }

  return null;
}

function isSupportedTicketHost(urlStr) {
  if (!urlStr) return false;
  try {
    const u = new URL(urlStr);
    return u.hostname.includes('hubspot.com') || u.hostname === 'conversas.hyperflow.global';
  } catch {
    return false;
  }
}

function isLikelyTicketContextUrl(urlStr) {
  if (!urlStr) return false;
  try {
    const u = new URL(urlStr);
    if (u.hostname.includes('hubspot.com')) {
      if (/\/ticket\/\d+/.test(u.pathname)) return true;
      if (u.pathname.includes('/help-desk/') && u.pathname.includes('/thread/')) return true;
      return false;
    }
    if (u.hostname === 'conversas.hyperflow.global') {
      if (/\/chats\/\d+/.test(u.pathname)) return true;
      if (/\/all-chats(?:\/|$)/.test(u.pathname)) return true;
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

function refreshFocusedTicketOwnership(tabId) {
  if (!tabId) return;

  chrome.tabs.get(tabId, (tab) => {
    const urlTicketId = extractTicketIdFromTabUrl(tab?.url || '');
    const cachedTicketId = sessionCache[tabId]?.id || null;
    const supportedHost = isSupportedTicketHost(tab?.url || '');
    const likelyTicketContext = isLikelyTicketContextUrl(tab?.url || '');
    const proc = processes.get(tabId);
    const hasLiveProcess = !!(proc && proc.status !== 'ABORTED');

    // Promote by focused URL immediately so "last switched to ticket/chat tab"
    // always wins, even if content script replies a bit later.
    if (urlTicketId) {
      persistLastTicketTabId(tabId);
      if (!sessionCache[tabId]) {
        sessionCache[tabId] = { id: urlTicketId, name: null, email: null, doc: null, accounts: null };
        syncSessionCache();
      } else if (!sessionCache[tabId].id) {
        sessionCache[tabId].id = urlTicketId;
        syncSessionCache();
      }
    }
    // HubSpot/Hyperflow can keep ticket state in-page without reflecting an ID in URL.
    // When that happens, prefer already-known ticket ownership for the focused tab.
    else if (supportedHost && cachedTicketId) {
      persistLastTicketTabId(tabId);
    }
    // Route pattern indicates ticket/chat context even if ID is not in URL yet.
    else if (likelyTicketContext) {
      persistLastTicketTabId(tabId);
    }
    // Also trust an existing live process for this tab on activation.
    else if (supportedHost && hasLiveProcess) {
      persistLastTicketTabId(tabId);
    }

    // Ask content script for live state; this is the authoritative source.
    chrome.tabs.sendMessage(tabId, { action: 'GET_CURRENT_DATA' }, (resp) => {
      // Ignore stale async responses from tabs that are no longer focused.
      if (tabId !== focusedTabId) return;

      const hasLiveTicket = !chrome.runtime.lastError && resp?.isTicketPage && !!resp?.data?.id;

      if (hasLiveTicket) {
        persistLastTicketTabId(tabId);
        sessionCache[tabId] = {
          id: resp.data.id ?? null,
          name: resp.data.name ?? null,
          email: resp.data.email ?? null,
          doc: resp.data.doc ?? null,
          accounts: resp.data.accounts ?? null
        };
        syncSessionCache();

        const liveProc = processes.get(tabId);
        if (liveProc && liveProc.status !== 'ABORTED') {
          activeProcessId = liveProc.processId;
        }
        return;
      }

      // Fallback to existing process map for tabs without a responsive content script.
      const fallbackProc = processes.get(tabId);
      if (fallbackProc && fallbackProc.status !== 'ABORTED') {
        activeProcessId = fallbackProc.processId;
        persistLastTicketTabId(tabId);
      }
    });
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EXTENSION TOGGLE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

chrome.action.onClicked.addListener(() => {
  chrome.storage.local.get('enabled', ({ enabled }) => {
    chrome.storage.local.set({ enabled: !enabled });
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install' && details.reason !== 'update') return;
  chrome.runtime.openOptionsPage();
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PROCESS MANAGEMENT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function createProcess(tabId, ticketId, isFocused = true) {
  // Abort any old process for this tab
  const old = processes.get(tabId);
  if (old) old.status = 'ABORTED';

  const proc = {
    processId: uid(),
    ticketId,
    tabId,
    name: null,
    email: null,
    doc: null,
    accounts: null,
    status: 'STARTING',
    retryCount: 0
  };

  processes.set(tabId, proc);

  // Only update global focus pointers when the tab is actually visible to the user.
  // Tabs opened in the background (Ctrl+click) must not steal lastTicketTabId.
  if (isFocused) {
    activeProcessId = proc.processId;
    persistLastTicketTabId(tabId);
  }

  // Initialize session slot
  sessionCache[tabId] = { id: ticketId, name: null, email: null, doc: null, accounts: null };
  syncSessionCache();

  return proc;
}

function updateCacheFromProcess(proc) {
  if (!sessionCache[proc.tabId]) return;
  sessionCache[proc.tabId] = {
    id: proc.ticketId,
    name: proc.name,
    email: proc.email,
    doc: proc.doc,
    accounts: proc.accounts
  };
  syncSessionCache();
}

function finalizeStoppedDisplayFields(proc) {
  if (!proc) return;
  const shouldFallbackToDash = (value) => {
    if (value == null) return true;
    const text = String(value).trim();
    return text === '' || text === '...';
  };
  if (shouldFallbackToDash(proc.name)) proc.name = '-';
  if (shouldFallbackToDash(proc.email)) proc.email = '-';
  if (shouldFallbackToDash(proc.doc)) proc.doc = '-';
  if (shouldFallbackToDash(proc.accounts)) proc.accounts = '-';
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CONTENT SCRIPT â†’ BACKGROUND MESSAGES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  // â”€â”€ TICKET_DETECTED: content script entered a ticket page â”€â”€
  if (msg.action === 'TICKET_DETECTED') {
    const { ticketId, forceNew } = msg;

    // Only treat this tab as the "last active ticket" if the user is actually
    // looking at it. Background-opened tabs (Ctrl+click / open-in-new-tab) run
    // the content script immediately but were never focused â€” they must NOT steal
    // lastTicketTabId from the tab the user is currently working in.
    const isFocused = (tabId === focusedTabId);

    const existing = processes.get(tabId);

    // Reuse if: not forced, same ticket, process still alive (any status except ABORTED)
    // Do NOT gate on activeProcessId â€” tab switch events race and cause false misses
    if (
      !forceNew &&
      existing &&
      existing.ticketId === ticketId &&
      existing.status !== 'ABORTED'
    ) {
      // Only update global pointers when this tab is actually focused
      if (isFocused) {
        activeProcessId = existing.processId;
        persistLastTicketTabId(tabId);
      }
      const cached = sessionCache[tabId] || null;
      sendResponse({ processId: existing.processId, reuse: true, data: cached });
      return true;
    }

    // SW restarted â€” processes map empty but session cache has complete data
    if (!forceNew && !existing) {
      const cached = sessionCache[tabId];
      if (cached && cached.id === ticketId && cached.email) {
        const phantom = {
          processId: uid(),
          ticketId,
          tabId,
          name:     cached.name,
          email:    cached.email,
          doc:      cached.doc,
          accounts: cached.accounts ?? null,
          status:   'COMPLETED',
          retryCount: 0
        };
        processes.set(tabId, phantom);
        if (isFocused) {
          activeProcessId = phantom.processId;
          persistLastTicketTabId(tabId);
        }
        sendResponse({ processId: phantom.processId, reuse: true, data: cached });
        return true;
      }
    }

    // Fresh process â€” createProcess registers it but only update lastTicketTabId
    // if this tab is currently focused.
    const proc = createProcess(tabId, ticketId, isFocused);
    sendResponse({ processId: proc.processId, reuse: false });
    return true;
  }

  // â”€â”€ BO TAB ASSIGNMENT: manual slot selection (BO1/BO2) â”€â”€
  if (msg.action === 'GET_BO_TAB_STATE') {
    sendResponse({ state: getBOTabState() });
    return true;
  }

  if (msg.action === 'ARM_BO_TAB') {
    const slot = msg.slot === 2 ? 2 : 1;
    const assignedTabId = getAssignedBOTabId(slot);

    if (assignedTabId) {
      focusBOTab(assignedTabId, (focused) => {
        if (!focused) {
          setBOTabAssignment(slot, null, false);
          setArmedBOTabSlot(slot, false);
          broadcastBOTabState();
        } else {
          setArmedBOTabSlot(null, false);
          broadcastBOTabState();
        }
        sendResponse({ ok: true, focused, state: getBOTabState() });
      });
      return true;
    }

    setArmedBOTabSlot(slot);
    sendResponse({ ok: true, focused: false, state: getBOTabState() });
    return true;
  }

  if (msg.action === 'RESET_BO_TABS') {
    clearBOTabAssignments();
    sendResponse({ ok: true, state: getBOTabState() });
    return true;
  }

  // Backward-compat shim: old eye button action now just opens manual assignment mode for BO1.
  if (msg.action === 'FOCUS_BO_TAB') {
    setArmedBOTabSlot(1);
    return;
  }

  // â”€â”€ DATA_EXTRACTED: content sends name and/or email â”€â”€
  if (msg.action === 'DATA_EXTRACTED') {
    const { processId, email } = msg;

    // Only verify the message belongs to THIS tab's current process.
    // Do NOT gate on isProcessActive â€” the tab may not be focused when
    // the 100ms Hyperflow timer fires, which would drop the name.
    const proc = processes.get(tabId);
    if (!proc || proc.processId !== processId) return;

    let dirty = false;

    const extractedEmail = String(email ?? '').trim();
    if (extractedEmail) {
      if (proc.email !== extractedEmail) {
        proc.email = extractedEmail;
        dirty = true;
      }
      // Ensure popup email row is always updated before/while BO search progresses.
      sendPopupUpdate(proc, { email: proc.email });
    }

    if (dirty) updateCacheFromProcess(proc);

    // As soon as email is available, start BO search
    if (proc.email && proc.status === 'STARTING') {
      scheduleBOSearch(proc);
    }
    return;
  }

  // â”€â”€ EMAIL_UNAVAILABLE: content could not find email after all retries â”€â”€
  if (msg.action === 'EMAIL_UNAVAILABLE') {
    const { processId } = msg;
    const proc = processes.get(tabId);
    if (!proc || proc.processId !== processId) return;
    proc.accounts = '-';
    proc.status = 'ABORTED';
    finalizeStoppedDisplayFields(proc);
    sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
    updateCacheFromProcess(proc);
    return;
  }

  // â”€â”€ TICKET_EXITED: content left the ticket page â”€â”€
  if (msg.action === 'TICKET_EXITED') {
    const proc = processes.get(tabId);
    if (proc) proc.status = 'ABORTED';
    delete sessionCache[tabId];
    syncSessionCache();
    return;
  }

  // â”€â”€ UI BUTTONS â”€â”€
  if (msg.action === 'FORCE_DISABLE') {
    chrome.storage.local.set({ enabled: false });
    return;
  }

  if (msg.action === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    return;
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TAB / WINDOW EVENT HANDLERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

chrome.tabs.onActivated.addListener(({ tabId }) => {
  focusedTabId = tabId;
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    assignArmedBOTabFromTab(tab);

    const url = tab.url || '';
    const hasUrlTicket = !!extractTicketIdFromTabUrl(url);
    const hasLikelyTicketContext = isLikelyTicketContextUrl(url);
    const hasCachedTicket = !!sessionCache[tabId]?.id;
    const proc = processes.get(tabId);
    const hasLiveProcess = !!(proc && proc.status !== 'ABORTED');

    // Tab button switch (or Ctrl+Tab) should immediately promote the clicked tab
    // when it is already known as a ticket/chat context.
    if (hasUrlTicket || hasLikelyTicketContext || hasCachedTicket || hasLiveProcess) {
      persistLastTicketTabId(tabId);
    }
  });
  refreshFocusedTicketOwnership(tabId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (!tabs.length) return;
    const tab = tabs[0];
    focusedTabId = tab.id;
    assignArmedBOTabFromTab(tab);
    refreshFocusedTicketOwnership(tab.id);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  processes.delete(tabId);
  delete sessionCache[tabId];
  syncSessionCache();
  clearAssignedBOTabIfRemoved(tabId);
  if (lastTicketTabId === tabId) persistLastTicketTabId(null);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // If the user is focused on this tab and URL changed to another ticket/chat,
  // immediately refresh ownership so shortcuts follow current navigation.
  if (!changeInfo.url) return;
  if (tab?.active) assignArmedBOTabFromTab(tab);
  if (tabId !== focusedTabId) return;
  if (!tab?.active) return;
  refreshFocusedTicketOwnership(tabId);
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// KEYBOARD SHORTCUTS â€” GLOBAL COPY (works anywhere in Chrome)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function isCopyableFieldValue(v) {
  if (typeof v !== 'string') return false;
  const text = v.trim();
  return !!text && text !== '-' && text !== '...' && !text.startsWith('>');
}

function pickShortcutPayload(command, data) {
  if (!data) return null;

  switch (command) {
    case 'copy-id': {
      const id = data.id;
      if (!isCopyableFieldValue(String(id ?? ''))) return null;
      return { type: 'id', value: String(id) };
    }
    case 'copy-name': {
      const n = data.name;
      if (!isCopyableFieldValue(n)) return null;
      return { type: 'name', value: n.includes('@') ? n : n.split(/\s+/)[0] };
    }
    case 'copy-email': {
      const e = data.email;
      if (!isCopyableFieldValue(e)) return null;
      return { type: 'email', value: e };
    }
    case 'copy-doc': {
      const d = data.doc;
      if (!isCopyableFieldValue(d)) return null;
      return { type: 'doc', value: d };
    }
    default:
      return null;
  }
}

function copyValueInActiveTab(value, onDone) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTabId = tabs?.[0]?.id;
    if (!activeTabId) return onDone(false);

    chrome.scripting.executeScript({
      target: { tabId: activeTabId },
      func: (v) => {
        return navigator.clipboard.writeText(v)
          .then(() => true)
          .catch(() => {
            const ta = document.createElement('textarea');
            ta.value = v;
            ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
            return true;
          });
      },
      args: [value]
    }, () => {
      if (chrome.runtime.lastError) return onDone(false);
      onDone(true);
    });
  });
}

function performShortcutCopy(command, sourceTabId, data) {
  const payload = pickShortcutPayload(command, data);
  if (!payload) return;

  copyValueInActiveTab(payload.value, (ok) => {
    if (!ok) return;
    if (sourceTabId) {
      sendToTab(sourceTabId, { action: 'SHOW_CHECKMARK', type: payload.type });
    }
  });
}

chrome.commands.onCommand.addListener((command) => {
  // Service worker may have been restarted; read from session storage to be safe.
  chrome.storage.session.get(['sessionCache', 'lastTicketTabId'], (stored) => {
    if (stored.sessionCache) {
      if (!sessionCache || Object.keys(sessionCache).length === 0) {
        sessionCache = stored.sessionCache;
      } else {
        for (const [tabKey, value] of Object.entries(stored.sessionCache)) {
          if (!sessionCache[tabKey]) sessionCache[tabKey] = value;
        }
      }
    }
    // Do not overwrite a newer in-memory tab selection with potentially stale storage.
    if ((lastTicketTabId === null || lastTicketTabId === undefined) && stored.lastTicketTabId) {
      lastTicketTabId = stored.lastTicketTabId;
    }

    // Always prefer the currently active tab when it is a ticket/chat tab.
    // This avoids stale copy source after fast tab switching.
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const activeTab = tabs?.[0] || null;
      const activeTabId = activeTab?.id ?? null;
      const activeUrlTicketId = extractTicketIdFromTabUrl(activeTab?.url || '');
      const activeCache = activeTabId ? sessionCache[activeTabId] : null;
      const activeProc = activeTabId ? processes.get(activeTabId) : null;
      const activeHasTicket =
        !!activeUrlTicketId ||
        !!activeCache?.id ||
        !!(activeProc && activeProc.status !== 'ABORTED');

      let sourceTabId = lastTicketTabId;

      if (activeTabId && activeHasTicket) {
        sourceTabId = activeTabId;
        focusedTabId = activeTabId;
        persistLastTicketTabId(activeTabId);

        if (activeUrlTicketId) {
          if (!sessionCache[activeTabId]) {
            sessionCache[activeTabId] = {
              id: activeUrlTicketId,
              name: null,
              email: null,
              doc: null,
              accounts: null
            };
            syncSessionCache();
          } else if (!sessionCache[activeTabId].id) {
            sessionCache[activeTabId].id = activeUrlTicketId;
            syncSessionCache();
          }
        }
      }

      if (!sourceTabId) return;
      const cachedData = sessionCache[sourceTabId] || null;

      // Prefer live popup data from the selected source tab; fallback to cache.
      chrome.tabs.sendMessage(sourceTabId, { action: 'GET_CURRENT_DATA' }, (resp) => {
        const liveData = (!chrome.runtime.lastError && resp?.data?.id) ? resp.data : null;

        if (liveData) {
          sessionCache[sourceTabId] = {
            id: liveData.id ?? null,
            name: liveData.name ?? null,
            email: liveData.email ?? null,
            doc: liveData.doc ?? null,
            accounts: liveData.accounts ?? null
          };
          syncSessionCache();
        }

        performShortcutCopy(command, sourceTabId, liveData || cachedData);
      });
    });
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BO TAB ASSIGNMENT (MANUAL)
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BO SEARCH ORCHESTRATION
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function scheduleBOSearch(proc) {
  if (proc.status === 'ABORTED') return;
  if (!proc.email) return;

  proc.status = 'RESOLVING_BO_TAB';

  if (boSearchBusy) {
    // Store as pending â€” replaces any previous pending ticket.
    // When the running search finishes it will pick this up.
    pendingProc = proc;
    return;
  }

  runBOSearch(proc);
}

function runBOSearch(proc) {
  if (!proc || !isProcessStillValid(proc)) return;

  pendingProc = null;

  resolveAssignedBOTab1((boTab) => {
    if (!isProcessStillValid(proc)) return;

    if (!boTab) {
      const normalizeStoppedField = (value) => {
        const text = String(value ?? '').trim();
        return !text || text === '...' ? '-' : value;
      };

      proc.name = normalizeStoppedField(proc.name);
      const knownEmail = normalizeStoppedField(proc.email || sessionCache[proc.tabId]?.email || '-');
      proc.email = knownEmail;
      proc.doc = '> Sem aba BO 1 definida';
      proc.accounts = '-';
      proc.status = 'ABORTED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
      updateCacheFromProcess(proc);
      flushPending();
      return;
    }

    proc.status = 'SEARCHING_EMAIL';
    boSearchBusy = true;
    boSearchOwner = proc.processId;

    const safetyTimer = setTimeout(() => {
      if (boSearchOwner === proc.processId) {
        boSearchBusy = false;
        boSearchOwner = null;
        flushPending();
      }
    }, 25000);

    runEmailSearch(boTab.id, proc.email)
      .then(result => {
        clearTimeout(safetyTimer);
        boSearchBusy = false;
        boSearchOwner = null;
        handleEmailResult(proc, result, boTab.id);
        // handleEmailResult may start doc search (which sets boSearchBusy again),
        // so only flush pending if the lock is free after returning
        if (!boSearchBusy) flushPending();
      })
      .catch(() => {
        clearTimeout(safetyTimer);
        boSearchBusy = false;
        boSearchOwner = null;
        proc.doc = '> Erro na busca';
        proc.accounts = '-';
        proc.status = 'ABORTED';
        finalizeStoppedDisplayFields(proc);
        sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
        updateCacheFromProcess(proc);
        flushPending();
      });
  });
}

/** After any search finishes, run the latest pending process if one exists. */
function flushPending() {
  if (!pendingProc) return;
  if (boSearchBusy) return;

  const proc = pendingProc;
  pendingProc = null;

  if (!isProcessStillValid(proc)) return;

  runBOSearch(proc);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EMAIL SEARCH â€” INJECTED INTO BO TAB
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function runEmailSearch(boTabId, email) {
  return chrome.scripting.executeScript({
    target: { tabId: boTabId },
    func: boEmailSearchScript,
    args: [email]
  }).then(results => results?.[0]?.result ?? { status: 'ERROR' });
}

/**
 * Runs INSIDE the BO tab. Entirely self-contained â€” no external references.
 *
 * Confirmed BO structure:
 *   Orbita toggle : #MyEduzz  (has class "checked" when active)
 *   Dropdown btn  : #menuSearch  â†’  menu item #menuClientes
 *   Search input  : #searchField
 *   Search button : button[type="submit"] inside the form
 *   Results wrap  : the parentElement of h3 "Clientes"
 *   Table cols    : td[0]=CÃ³digo+status  td[1]=Nome  td[2]=E-mail  td[3]=CPF/CNPJ
 *   Parceiro dot  : [data-tip="Parceiro"] inside td[0]
 *   Empty states  : h4 inside same parent div
 */
function boEmailSearchScript(emailValue) {
  const MSG_START_SEARCH = 'Fa\u00e7a uma busca para come\u00e7ar';

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function setReactInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getResultsContainer() {
    const headers = document.querySelectorAll('h3');
    for (const h of headers) {
      if (h.innerText.trim() === 'Clientes') return h.parentElement;
    }
    return null;
  }

  function waitForElement(selector, timeoutMs) {
    return new Promise(resolve => {
      const immediate = document.querySelector(selector);
      if (immediate) {
        resolve(immediate);
        return;
      }

      const root = document.documentElement || document.body;
      if (!root) {
        resolve(null);
        return;
      }

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (!el) return;
        cleanup();
        resolve(el);
      });

      const timer = setTimeout(() => {
        cleanup();
        resolve(null);
      }, timeoutMs);

      function cleanup() {
        observer.disconnect();
        clearTimeout(timer);
      }

      observer.observe(root, { childList: true, subtree: true });
    });
  }

  function ensureOrbita() {
    const item = document.querySelector('#MyEduzz');
    if (!item) return;
    if (!item.classList.contains('checked')) item.querySelector('a')?.click();
  }

  async function ensureClientes() {
    const btn = document.querySelector('#menuSearch');
    if (!btn) return false;

    const current = btn.querySelector('span')?.innerText?.trim().toLowerCase();
    if (current === 'clientes') return true;

    btn.click();
    await delay(120);

    const item = document.querySelector('#menuClientes');
    if (item) item.click();

    await delay(120);
    return true;
  }

  function triggerSearch(value) {
    const input = document.querySelector('#searchField');
    const btn = document.querySelector('button[type="submit"]');
    if (!input || !btn) return false;

    input.focus();
    setReactInput(input, value);

    if (input.value !== value) setReactInput(input, value);
    btn.click();
    return true;
  }

  function parseRowsForEmail(rows, email) {
    function extractCanonicalEmail(text) {
      const m = (text || '').toLowerCase().match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i);
      return m ? m[0] : null;
    }

    function splitEmailParts(value) {
      const idx = value.indexOf('@');
      if (idx <= 0) return null;
      return {
        local: value.slice(0, idx),
        domain: value.slice(idx + 1)
      };
    }

    function sameEmailOrBrVariant(a, b) {
      if (!a || !b) return false;
      if (a === b) return true;

      const pa = splitEmailParts(a);
      const pb = splitEmailParts(b);
      if (!pa || !pb) return false;
      if (pa.local !== pb.local) return false;

      const da = pa.domain;
      const db = pb.domain;
      return da === `${db}.br` || db === `${da}.br`;
    }

    function accountTypeFromRows(matchedRows) {
      let hasParceiro = false;
      let hasCliente = false;

      for (const row of matchedRows) {
        const cells = row.querySelectorAll('td');
        if (!cells.length) continue;
        if (cells[0]?.querySelector('[data-tip="Parceiro"]')) hasParceiro = true;
        else hasCliente = true;
      }

      if (hasParceiro && hasCliente) return 'Consultar tipo';
      if (hasParceiro) return 'Parceiro';
      return 'Cliente';
    }

    const targetEmail = extractCanonicalEmail(email);
    if (!targetEmail) return { status: 'NO_ACCOUNT' };

    const matched = [];

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;

      const rowEmail = extractCanonicalEmail(cells[2]?.innerText || '');
      if (sameEmailOrBrVariant(rowEmail, targetEmail)) matched.push(row);
    }

    if (!matched.length) return { status: 'NO_MATCH' };

    for (const row of matched) {
      const cells = row.querySelectorAll('td');
      const rowName = (cells[1]?.innerText || '').trim();
      const rowDoc = (cells[3]?.innerText || '').trim();
      if (!rowDoc) continue;
      return {
        status: 'FOUND',
        doc: rowDoc,
        name: rowName || null,
        matchedCount: matched.length,
        accountType: accountTypeFromRows(matched)
      };
    }

    let fallbackName = null;
    for (const row of matched) {
      const cells = row.querySelectorAll('td');
      const rowName = (cells[1]?.innerText || '').trim();
      if (rowName) {
        fallbackName = rowName;
        break;
      }
    }

    return {
      status: 'NO_DOC',
      name: fallbackName,
      matchedCount: matched.length,
      accountType: accountTypeFromRows(matched)
    };
  }

  function waitForEmailResult(email) {
    return new Promise(resolve => {
      const MIN_NO_ACCOUNT_DELAY_MS = 1200;
      const root = document.documentElement || document.body;
      const deadline = Date.now() + 25000;
      let retryCount = 0;
      let done = false;
      let checkTimer = null;
      let nonMatchStable = 0;
      let lastRowsSignature = '';
      let noAccountStable = 0;
      let lastSearchAt = Date.now();
      let noDocRecheckUsed = false;

      const observer = root
        ? new MutationObserver(() => scheduleCheck(120))
        : null;

      if (observer) observer.observe(root, { childList: true, subtree: true, characterData: true });

      const interval = setInterval(() => scheduleCheck(0), 1000);
      const hardTimeout = setTimeout(() => finish({ status: 'TIMEOUT' }), 25000);

      function finish(result) {
        if (done) return;
        done = true;
        if (observer) observer.disconnect();
        clearTimeout(checkTimer);
        clearInterval(interval);
        clearTimeout(hardTimeout);
        resolve(result);
      }

      function scheduleCheck(delayMs) {
        if (done) return;
        clearTimeout(checkTimer);
        checkTimer = setTimeout(checkNow, delayMs);
      }

      function rowsSignature(rows) {
        return rows.map(row => row.innerText || '').join('\n---\n');
      }

      function checkNow() {
        if (done) return;

        if (Date.now() > deadline) {
          finish({ status: 'TIMEOUT' });
          return;
        }

        const container = getResultsContainer();
        if (!container) return;

        const rows = Array.from(container.querySelectorAll('tbody tr'));
        if (rows.length) {
          noAccountStable = 0;
          const parsed = parseRowsForEmail(rows, email);
          if (parsed.status === 'FOUND') {
            finish(parsed);
            return;
          }
          if (parsed.status === 'NO_DOC') {
            // Exceptional BO case: another matching row with doc can appear shortly after.
            // Wait once ~200ms before finalizing as NO_DOC.
            if (!noDocRecheckUsed) {
              noDocRecheckUsed = true;
              scheduleCheck(200);
              return;
            }
            finish(parsed);
            return;
          }
          if (parsed.status === 'NO_ACCOUNT') {
            finish({ status: 'NO_ACCOUNT' });
            return;
          }

          const sig = rowsSignature(rows);
          if (sig === lastRowsSignature) {
            nonMatchStable++;
          } else {
            lastRowsSignature = sig;
            nonMatchStable = 1;
          }

          if (nonMatchStable >= 2) {
            if (retryCount < 3) {
              retryCount++;
              nonMatchStable = 0;
              lastRowsSignature = '';
              if (triggerSearch(email)) lastSearchAt = Date.now();
              scheduleCheck(600);
            } else {
              finish({ status: 'NO_ACCOUNT' });
            }
          }
          return;
        }

        nonMatchStable = 0;
        lastRowsSignature = '';

        const h4 = container.querySelector('h4');
        const text = h4?.innerText?.trim() || '';

        if (text.includes('Nenhum registro')) {
          const elapsed = Date.now() - lastSearchAt;
          if (elapsed < MIN_NO_ACCOUNT_DELAY_MS) {
            scheduleCheck((MIN_NO_ACCOUNT_DELAY_MS - elapsed) + 120);
            return;
          }

          noAccountStable++;
          if (noAccountStable >= 2) {
            finish({ status: 'NO_ACCOUNT' });
          } else {
            scheduleCheck(350);
          }
          return;
        }

        noAccountStable = 0;

        if (text === MSG_START_SEARCH) {
          if (retryCount < 3) {
            retryCount++;
            if (triggerSearch(email)) lastSearchAt = Date.now();
            scheduleCheck(500);
          } else {
            finish({ status: 'NO_RESULT' });
          }
        }
      }

      checkNow();
    });
  }

  return (async () => {
    ensureOrbita();

    const menu = await waitForElement('#menuSearch', 20000);
    if (!menu) return { status: 'ERROR' };

    await ensureClientes();

    if (!triggerSearch(emailValue)) return { status: 'ERROR' };

    return waitForEmailResult(emailValue);
  })();
}
function handleEmailResult(proc, result, boTabId) {
  // Only per-process guard â€” results always go to proc.tabId so no cross-tab risk
  if (proc.status === 'ABORTED') return;

  proc.status = 'PROCESSING_EMAIL_RESULT';

  switch (result?.status) {

    case 'NO_ACCOUNT':
      proc.name     = '-';
      proc.doc      = '> Email sem conta';
      proc.accounts = '-';
      proc.status   = 'COMPLETED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
      updateCacheFromProcess(proc);
      break;

    case 'NO_DOC':
      proc.name = result.name ? toTitleCase(result.name) : '-';
      proc.doc      = '> Conta sem doc';
      proc.accounts = `? | ${result.accountType || 'Cliente'}`;
      proc.status   = 'COMPLETED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
      updateCacheFromProcess(proc);
      break;

    case 'FOUND':
      proc.name = result.name ? toTitleCase(result.name) : '-';
      proc.doc = result.doc;
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc });
      updateCacheFromProcess(proc);
      runDocValidationAndSearch(proc, boTabId);
      break;

    default:
      proc.doc      = '> Erro na busca';
      proc.accounts = '-';
      proc.status   = 'ABORTED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, doc: proc.doc, accounts: proc.accounts });
      updateCacheFromProcess(proc);
      break;
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DOC VALIDATION + DOC SEARCH
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function runDocValidationAndSearch(proc, boTabId) {
  if (!isProcessStillValid(proc)) return;

  proc.status = 'VALIDATING_DOC';

  const digits = proc.doc.replace(/\D/g, '');

  // Valid doc: 9 or 14 digit count (as per spec)
  if (digits.length !== 11 && digits.length !== 14) {
    proc.accounts = '> Doc. Estrangeiro/Inv\u00e1lido';
    proc.status = 'COMPLETED';
    finalizeStoppedDisplayFields(proc);
    sendPopupUpdate(proc, { name: proc.name, accounts: proc.accounts });
    updateCacheFromProcess(proc);
    flushPending();
    return;
  }

  proc.status = 'SEARCHING_DOC';
  boSearchBusy = true;
  boSearchOwner = proc.processId;

  const safetyTimer = setTimeout(() => {
    if (boSearchOwner === proc.processId) {
      boSearchBusy = false;
      boSearchOwner = null;
      flushPending();
    }
  }, 25000);

  runDocSearch(boTabId, proc.doc)
    .then(result => {
      clearTimeout(safetyTimer);
      boSearchBusy = false;
      boSearchOwner = null;
      handleDocResult(proc, result);
      flushPending();
    })
    .catch(() => {
      clearTimeout(safetyTimer);
      boSearchBusy = false;
      boSearchOwner = null;
      proc.accounts = '> Erro na busca doc';
      proc.status = 'ABORTED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, accounts: proc.accounts });
      updateCacheFromProcess(proc);
      flushPending();
    });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DOC SEARCH â€” INJECTED INTO BO TAB
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function runDocSearch(boTabId, doc) {
  return chrome.scripting.executeScript({
    target: { tabId: boTabId },
    func: boDocSearchScript,
    args: [doc]
  }).then(results => results?.[0]?.result ?? { status: 'ERROR' });
}

/**
 * Runs INSIDE the BO tab. Entirely self-contained.
 *
 * Reuses the same #searchField + button[type="submit"].
 * Result container found via h3 "Clientes" parent.
 * Parceiro: [data-tip="Parceiro"] inside td[0] of each row.
 */
function boDocSearchScript(docValue) {
  const MSG_START_SEARCH = 'Fa\u00e7a uma busca para come\u00e7ar';

  function setReactInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getResultsContainer() {
    const headers = document.querySelectorAll('h3');
    for (const h of headers) {
      if (h.innerText.trim() === 'Clientes') return h.parentElement;
    }
    return null;
  }

  function triggerSearch(value) {
    const input = document.querySelector('#searchField');
    const btn = document.querySelector('button[type="submit"]');
    if (!input || !btn) return false;
    input.focus();
    setReactInput(input, value);
    if (input.value !== value) setReactInput(input, value);
    btn.click();
    return true;
  }

  function parseDocRows(rows, doc) {
    function normalizeDoc(value) {
      return (value || '').replace(/\D/g, '');
    }

    const targetDoc = normalizeDoc(doc);
    if (!targetDoc) return { status: 'NO_ACCOUNT' };

    let count = 0;
    let hasParceiro = false;

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 4) continue;

      const rowDoc = normalizeDoc(cells[3]?.innerText || '');
      if (rowDoc !== targetDoc) continue;

      count++;
      if (cells[0].querySelector('[data-tip="Parceiro"]')) hasParceiro = true;
    }

    if (count === 0) return { status: 'NO_MATCH' };
    return { status: 'FOUND', count, hasParceiro };
  }

  function waitForDocResult(doc) {
    return new Promise(resolve => {
      const root = document.documentElement || document.body;
      const deadline = Date.now() + 25000;
      let retryCount = 0;
      let done = false;
      let stableCount = 0;
      let lastSignature = '';
      let checkTimer = null;

      const observer = root
        ? new MutationObserver(() => scheduleCheck(120))
        : null;

      if (observer) observer.observe(root, { childList: true, subtree: true, characterData: true });

      const interval = setInterval(() => scheduleCheck(0), 1000);
      const hardTimeout = setTimeout(() => finish({ status: 'TIMEOUT' }), 25000);

      function finish(result) {
        if (done) return;
        done = true;
        if (observer) observer.disconnect();
        clearTimeout(checkTimer);
        clearInterval(interval);
        clearTimeout(hardTimeout);
        resolve(result);
      }

      function scheduleCheck(delayMs) {
        if (done) return;
        clearTimeout(checkTimer);
        checkTimer = setTimeout(checkNow, delayMs);
      }

      function rowsSignature(rows) {
        return rows.map(row => row.innerText || '').join('\n---\n');
      }

      function checkNow() {
        if (done) return;

        if (Date.now() > deadline) {
          finish({ status: 'TIMEOUT' });
          return;
        }

        const container = getResultsContainer();
        if (!container) return;

        const rows = Array.from(container.querySelectorAll('tbody tr'));
        if (rows.length) {
          const sig = rowsSignature(rows);
          if (sig === lastSignature) {
            stableCount++;
          } else {
            lastSignature = sig;
            stableCount = 1;
          }

          if (stableCount < 2) return;

          const parsed = parseDocRows(rows, doc);
          if (parsed.status === 'FOUND') {
            finish(parsed);
            return;
          }

          if (retryCount < 3) {
            retryCount++;
            stableCount = 0;
            lastSignature = '';
            triggerSearch(doc);
            scheduleCheck(600);
            return;
          }

          finish({ status: 'NO_ACCOUNT' });
          return;
        }

        stableCount = 0;
        lastSignature = '';

        const h4 = container.querySelector('h4');
        const text = h4?.innerText?.trim() || '';

        if (text.includes('Nenhum registro')) {
          finish({ status: 'NO_ACCOUNT' });
          return;
        }

        if (text === MSG_START_SEARCH) {
          if (retryCount < 3) {
            retryCount++;
            triggerSearch(doc);
            scheduleCheck(600);
          } else {
            finish({ status: 'NO_RESULT' });
          }
        }
      }

      checkNow();
    });
  }

  if (!triggerSearch(docValue)) return Promise.resolve({ status: 'ERROR' });
  return waitForDocResult(docValue);
}
function handleDocResult(proc, result) {
  if (!isProcessStillValid(proc)) return;

  proc.status = 'PROCESSING_DOC_RESULT';

  switch (result?.status) {

    case 'NO_ACCOUNT':
    case 'NO_RESULT':
    case 'TIMEOUT':
      proc.accounts = '> Doc. Estrangeiro/Inv\u00e1lido';
      proc.status = 'COMPLETED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, accounts: proc.accounts });
      break;

    case 'FOUND':
      if (result.count === 10) {
        proc.accounts = '9+ | Consultar tipo';
      } else {
        const type = result.hasParceiro ? 'Parceiro' : 'Cliente';
        proc.accounts = `${result.count} | ${type}`;
      }
      proc.status = 'COMPLETED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, accounts: proc.accounts });
      break;

    default:
      proc.accounts = '> Erro na busca doc';
      proc.status = 'COMPLETED';
      finalizeStoppedDisplayFields(proc);
      sendPopupUpdate(proc, { name: proc.name, accounts: proc.accounts });
      break;
  }

  updateCacheFromProcess(proc);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// RESTORE SESSION CACHE ON SERVICE WORKER WAKE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

chrome.storage.session.get(['sessionCache', 'lastTicketTabId', 'boTab1Id', 'boTab2Id', 'boAssignArmedSlot'], (data) => {
  if (data.sessionCache) sessionCache = data.sessionCache;
  if (data.lastTicketTabId) lastTicketTabId = data.lastTicketTabId;
  if (data.boTab1Id) boTab1Id = data.boTab1Id;
  if (data.boTab2Id) boTab2Id = data.boTab2Id;
  if (data.boAssignArmedSlot) boAssignArmedSlot = data.boAssignArmedSlot;
});


