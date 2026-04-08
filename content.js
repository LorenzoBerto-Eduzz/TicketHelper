if (window.__ticketHelperLoaded) {
  // already injected â€” do nothing
} else {
window.__ticketHelperLoaded = true;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STATE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

let enabled        = false;
let popup          = null;
let lastUrl        = location.href;

let currentProcessId = null;
let currentTicketId  = null;

// What's currently shown in the popup (null = loading "...")
let localData = { id: null, name: null, email: null, doc: null, accounts: null };
let boTabState = { boTab1Assigned: false, boTab2Assigned: false, armedSlot: null };

// Extraction guards â€” prevent duplicate messages to background
let emailSent      = false;
let nameSent       = false;
let hoverAttempted = false;

// Timers / observers
let extractionTimer  = null;
let urlObserver      = null;
let urlPollTimer     = null;
let resizeTimer      = null;
let checkmarkTimers  = {};
let routeEventHandler = null;
let hyperflowListClickHandler = null;
let historyHooksInstalled = false;

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UTILITIES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

const emailRegex = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i;

function toTitleCase(str) {
  if (!str) return '';
  return str.trim().split(/\s+/).filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function extractEmail(str) {
  if (!str) return null;
  const m = str.match(emailRegex);
  return m ? m[0].toLowerCase() : null;
}

function msgBg(msg) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(msg, resp => {
        void chrome.runtime.lastError;
        resolve(resp ?? null);
      });
    } catch { resolve(null); }
  });
}

function safeSetLocal(data) {
  try {
    if (!chrome?.storage?.local?.set) return;
    chrome.storage.local.set(data, () => {
      void chrome.runtime?.lastError;
    });
  } catch (err) {
    const message = String(err?.message || '');
    if (message.includes('Extension context invalidated')) return;
    throw err;
  }
}

function isCopyablePopupValue(v) {
  if (typeof v !== 'string') return false;
  const text = v.trim();
  return !!text && text !== '-' && text !== '...' && !text.startsWith('>');
}

function waitForBody(cb) {
  if (document.body) cb();
  else document.addEventListener('DOMContentLoaded', cb, { once: true });
}

function isElementVisible(el) {
  if (!el || !el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DOMAIN / PAGE DETECTION
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function isHubSpot()     { return location.hostname.includes('hubspot.com'); }
function isHyperflow()   { return location.hostname === 'conversas.hyperflow.global'; }
function isValidDomain() { return isHubSpot() || isHyperflow(); }

function extractHubSpotTicketIdFromText(text) {
  if (!text) return null;
  const m = text.match(/\/ticket\/(\d+)/);
  return m ? m[1] : null;
}

function extractHubSpotTicketIdFromHref(href) {
  if (!href) return null;
  const direct = extractHubSpotTicketIdFromText(href);
  if (direct) return direct;

  try {
    const url = new URL(href, location.origin);
    const eschref = url.searchParams.get('eschref');
    if (eschref) {
      const decoded = decodeURIComponent(eschref);
      const fromEscHref = extractHubSpotTicketIdFromText(decoded);
      if (fromEscHref) return fromEscHref;
    }
  } catch {
    // ignore malformed href
  }

  return null;
}

function extractHubSpotTicketIdFromDom() {
  const headerLink = document.querySelector('[data-test-id="ticket-header-contact-detail-link"] a[href]');
  if (headerLink?.href) {
    const fromHeader = extractHubSpotTicketIdFromHref(headerLink.href);
    if (fromHeader) return fromHeader;
  }

  return null;
}

function isHubSpotTicketPage() {
  if (!isHubSpot()) return false;

  // Fast positive: current route contains ticket id.
  if (/\/ticket\/\d+/.test(location.href)) return true;

  // Fallback only inside Help Desk thread context.
  if (!/\/help-desk\//.test(location.href)) return false;
  if (!/\/thread\//.test(location.href)) return false;

  return !!extractHubSpotTicketIdFromDom();
}

function normalizeHyperflowProtocol(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  return digits || null;
}

function getActiveHyperflowProtocolElement() {
  const headerCandidates = Array.from(document.querySelectorAll('.chat-header-contact .chat-protocol'));
  const visibleHeader = headerCandidates.filter(isElementVisible);
  if (visibleHeader.length) return visibleHeader[visibleHeader.length - 1];

  const genericCandidates = Array.from(document.querySelectorAll('span.chat-protocol'));
  const visibleGeneric = genericCandidates.filter(isElementVisible);
  if (visibleGeneric.length) return visibleGeneric[visibleGeneric.length - 1];

  return headerCandidates[0] || genericCandidates[0] || null;
}

function extractHyperflowTicketIdFromDom() {
  const protocolEl = getActiveHyperflowProtocolElement();
  if (!protocolEl) return null;
  const raw =
    protocolEl.getAttribute('aria-label')?.trim() ||
    protocolEl.innerText?.trim() ||
    '';
  return normalizeHyperflowProtocol(raw);
}

function extractHyperflowTicketIdFromPath() {
  const path = location.pathname || '';
  const direct =
    path.match(/\/chats\/(\d+)/)?.[1] ||
    path.match(/\/all-chats\/(\d+)/)?.[1] ||
    null;
  return normalizeHyperflowProtocol(direct);
}

function isHyperflowTicketPage() {
  if (!isHyperflow()) return false;
  if (extractHyperflowTicketIdFromPath()) return true;
  return !!extractHyperflowTicketIdFromDom();
}

function isTicketPage() {
  if (isHubSpot())   return isHubSpotTicketPage();
  if (isHyperflow()) return isHyperflowTicketPage();
  return false;
}

function extractTicketId() {
  if (isHubSpot()) {
    const fromUrl = extractHubSpotTicketIdFromText(location.href);
    if (fromUrl) return fromUrl;
    if (!isHubSpotTicketPage()) return null;
    return extractHubSpotTicketIdFromDom();
  }
  if (isHyperflow()) {
    const fromPath = extractHyperflowTicketIdFromPath();
    if (fromPath) return fromPath;
    if (!isHyperflowTicketPage()) return null;
    return extractHyperflowTicketIdFromDom();
  }
  return null;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// INIT / TEARDOWN
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

chrome.storage.local.get('enabled', ({ enabled: e }) => {
  enabled = !!e;
  if (enabled) init();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('enabled' in changes)) return;
  enabled = !!changes.enabled.newValue;
  if (enabled) init();
  else teardown();
});

function init() {
  if (!isValidDomain()) return;
  waitForBody(() => {
    injectStyles();
    if (!popup) createPopup();
    startUrlObserver();
    if (isHyperflow()) startHyperflowListClickObserver();
    // force=true: toggling ON always starts fresh, even on same ticket
    onFocusGained(true);
  });
}

function teardown() {
  popup?.remove();
  popup = null;
  urlObserver?.disconnect();
  urlObserver = null;
  if (urlPollTimer) {
    clearInterval(urlPollTimer);
    urlPollTimer = null;
  }
  if (routeEventHandler) {
    window.removeEventListener('popstate', routeEventHandler);
    window.removeEventListener('hashchange', routeEventHandler);
    window.removeEventListener('ticket-helper-route-change', routeEventHandler);
    routeEventHandler = null;
  }
  if (hyperflowListClickHandler) {
    document.removeEventListener('click', hyperflowListClickHandler, true);
    hyperflowListClickHandler = null;
  }
  clearTimeout(extractionTimer);
  resetProcess();
}

function resetProcess() {
  currentProcessId = null;
  currentTicketId  = null;
  emailSent        = false;
  nameSent         = false;
  hoverAttempted   = false;
  localData = { id: null, name: null, email: null, doc: null, accounts: null };
  pendingPopupUpdates = {};
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// URL / FOCUS OBSERVERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function startUrlObserver() {
  if (urlObserver) return;

  const checkRouteChange = () => {
    if (!enabled || !popup) return;

    let changed = false;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      changed = true;
    }

    const observedTicketId = extractTicketId();
    if (observedTicketId !== currentTicketId) changed = true;

    if (changed) onPageChange();
  };

  if (!historyHooksInstalled) {
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      const result = originalPushState.apply(this, args);
      window.dispatchEvent(new Event('ticket-helper-route-change'));
      return result;
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      const result = originalReplaceState.apply(this, args);
      window.dispatchEvent(new Event('ticket-helper-route-change'));
      return result;
    };

    historyHooksInstalled = true;
  }

  routeEventHandler = () => setTimeout(checkRouteChange, 0);
  window.addEventListener('popstate', routeEventHandler);
  window.addEventListener('hashchange', routeEventHandler);
  window.addEventListener('ticket-helper-route-change', routeEventHandler);

  urlObserver = new MutationObserver(checkRouteChange);
  urlObserver.observe(document.documentElement, { childList: true, subtree: true });

  if (!urlPollTimer) {
    urlPollTimer = setInterval(checkRouteChange, 700);
  }
}

function findHyperflowListRowFromTarget(target) {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body) {
    const hasCopyProtocol = !!node.querySelector?.('[aria-label="Copy protocol"]');
    const hasContactHint = !!node.querySelector?.('[aria-label="Filter by contact"]');
    if (hasCopyProtocol && hasContactHint) return node;
    node = node.parentElement;
  }
  return null;
}

function extractProtocolFromHyperflowListRow(rowEl) {
  if (!rowEl) return null;
  const copyBlock = rowEl.querySelector('[aria-label="Copy protocol"]');
  if (!copyBlock) return null;
  const raw = copyBlock.innerText || '';
  return normalizeHyperflowProtocol(raw);
}

function startHyperflowListClickObserver() {
  if (hyperflowListClickHandler) return;
  hyperflowListClickHandler = (event) => {
    if (!enabled || !popup || !isHyperflow()) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const chatRow = findHyperflowListRowFromTarget(target);
    if (!chatRow) return;
    const clickedProtocol = extractProtocolFromHyperflowListRow(chatRow);

    // Side panel opens asynchronously without URL change, so re-evaluate quickly.
    // When possible, use the clicked row protocol immediately to start this chat.
    if (clickedProtocol) {
      setTimeout(() => {
        if (!enabled || !popup) return;
        primeTicketSwitch(clickedProtocol);
        enterTicket(clickedProtocol);
      }, 30);
    }
    setTimeout(() => { if (enabled && popup) onPageChange(); }, 60);
    setTimeout(() => { if (enabled && popup) onPageChange(); }, 220);
  };

  document.addEventListener('click', hyperflowListClickHandler, true);
}

window.addEventListener('focus', () => {
  if (!enabled || !popup) return;
  setTimeout(onFocusGained, 150);
});

document.addEventListener('visibilitychange', () => {
  if (!enabled || !popup) return;
  if (document.visibilityState === 'visible') setTimeout(onFocusGained, 150);
});

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(clampPopup, 120);
});

function primeTicketSwitch(ticketId) {
  if (!ticketId) return;
  if (ticketId === currentTicketId && currentProcessId) return;

  resetProcess();
  currentTicketId = ticketId;
  localData.id = ticketId;
  renderPopup();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// PAGE CHANGE â€” MASTER DECISION POINT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Called on URL change â€” skips if same ticket already active
function onPageChange() {
  if (!popup) return;
  if (!isTicketPage()) { leaveTicket(); return; }
  const ticketId = extractTicketId();
  if (!ticketId) { leaveTicket(); return; }
  // URL-based nav: only re-enter if ticket actually changed
  if (ticketId === currentTicketId && currentProcessId) return;
  primeTicketSwitch(ticketId);
  enterTicket(ticketId);
}

// Called on tab focus / visibility change â€” always re-checks with background
// force=true bypasses reuse and always runs a fresh extraction (used on toggle-on)
function onFocusGained(force = false) {
  if (!popup) return;
  if (!isTicketPage()) { leaveTicket(); return; }
  const ticketId = extractTicketId();
  if (!ticketId) { leaveTicket(); return; }
  if (force || ticketId !== currentTicketId || !currentProcessId) {
    primeTicketSwitch(ticketId);
  }
  enterTicket(ticketId, force);
}

function leaveTicket() {
  clearTimeout(extractionTimer);
  if (!currentTicketId) return; // already idle
  resetProcess();
  renderPopup();
  msgBg({ action: 'TICKET_EXITED' });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// TICKET LIFECYCLE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

async function enterTicket(ticketId, force = false) {
  // Only cancel prior extraction timers when this is a fresh entry/change.
  // Re-check calls for the same active ticket (focus/visibility) must not
  // interrupt in-flight HubSpot extraction loops.
  if (force || ticketId !== currentTicketId || !currentProcessId) {
    clearTimeout(extractionTimer);
  }

  const resp = await msgBg({ action: 'TICKET_DETECTED', ticketId, forceNew: force });
  if (!resp?.processId) return;

  // Guard: page changed while we were awaiting.
  // For Hyperflow side-panel chats (same URL), protocol can be briefly absent
  // during render. Only abort when another concrete ticket/chat id is detected.
  const observedTicketId = extractTicketId();
  if (observedTicketId && observedTicketId !== ticketId) {
    setTimeout(() => {
      if (enabled && popup) onPageChange();
    }, 120);
    return;
  }

  // Reuse only if background says so AND we're not forcing a fresh start
  if (resp.reuse && !force) {
    currentTicketId  = ticketId;
    currentProcessId = resp.processId;
    // Restore popup from data sent back by background
    if (resp.data) {
      localData = {
        id:       resp.data.id       ?? ticketId,
        name:     resp.data.name     ?? null,
        email:    resp.data.email    ?? null,
        doc:      resp.data.doc      ?? null,
        accounts: resp.data.accounts ?? null
      };
      renderPopup();
    }
    return;
  }

  // New process â€” full reset and re-extract
  resetProcess();
  currentTicketId  = ticketId;
  localData.id     = ticketId;
  currentProcessId = resp.processId;
  renderPopup();

  // Flush any UPDATE_POPUP messages that arrived while we were awaiting
  // (can happen when a very fast BO search completes before this await resolves)
  const buffered = pendingPopupUpdates[currentProcessId];
  if (buffered?.length) {
    for (const fields of buffered) Object.assign(localData, fields);
    renderPopup();
  }
  delete pendingPopupUpdates[currentProcessId];

  if (isHubSpot())   extractHubSpot(resp.processId, ticketId, force);
  if (isHyperflow()) extractHyperflow(resp.processId, ticketId);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ HUBSPOT EXTRACTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//
// The primary tag element:  [data-component-name="UITag"] span[tabindex="0"]
//
// Two scenarios:
//   A) First value has "@"  â†’ it's the email. Capture it, then watch the
//      same element â€” HubSpot will replace it with the name in ~500ms.
//   B) First value has no @ â†’ it's the name. Search for email elsewhere.
//
// Email fallback order:
//   1. Single visible tag "flash" email (if only one contact and no +N more)
//   2. Ticket owner on header (if it is already an email)
//   3. Requerente card: match owner name and extract that contact email
//   4. Legacy fallbacks (#contact-select, chicklet mailto, hover tooltip)

function extractHubSpot(processId, ticketId, isForcedStart = false) {
  const TAG_ROOT_SEL = '.EmailTagDisplayBar__StyledDiv-bJtzuP [data-component-name="UITag"]';
  const TAG_CONTAINER_SEL = '.EmailTagDisplayBar__StyledDiv-bJtzuP';
  const CONTACT_SEL = '#contact-select [data-option-text="true"]';
  const CHICKLET_SEL = 'a[data-test-id="contact-chicklet-email"][href^="mailto:"]';

  let extractionWatchdog = null;
  let tagWaitTimer = null;
  let tagObserver = null;
  let noEmailRetryUsed = false;
  let noEmailRetryRunning = false;

  function isCurrent() {
    return currentProcessId === processId;
  }

  function cleanupExtractionTimers() {
    clearTimeout(extractionWatchdog);
    if (tagWaitTimer) {
      clearTimeout(tagWaitTimer);
      tagWaitTimer = null;
    }
    if (tagObserver) {
      tagObserver.disconnect();
      tagObserver = null;
    }
  }

  function sendEmail(email) {
    if (emailSent) return;
    if (!isCurrent()) return;
    cleanupExtractionTimers();
    emailSent = true;
    localData.email = email;
    renderPopup();
    msgBg({ action: 'DATA_EXTRACTED', processId, email });
  }

  function setNameIfNeeded(text) {
    // Name must be sourced from BO email-search result only.
    // Keep popup name as "..." until background sends UPDATE_POPUP with final name.
    return;
  }

  function normalizeText(value) {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9@._+\-\s]/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function getTicketOpenerLabel() {
    const el =
      document.querySelector('[data-test-id="ticket-header-contact-detail-link"] [data-content="true"]') ||
      document.querySelector('[data-test-id="ticket-header-contact-detail-link"] a') ||
      document.querySelector('[role="heading"] [data-test-id="ticket-header-contact-detail-link"]');
    return el?.innerText?.trim() || null;
  }

  function dispatchHover(target) {
    if (!target || !document.contains(target)) return;
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    if (typeof PointerEvent === 'function') {
      target.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    }
  }

  function getTagEntries() {
    return Array.from(document.querySelectorAll(TAG_ROOT_SEL))
      .map(rootEl => {
        const contentEl =
          rootEl.querySelector('[data-content="true"]') ||
          rootEl.querySelector('span[tabindex]') ||
          rootEl;
        const text = contentEl?.innerText?.trim() || rootEl.innerText?.trim() || '';
        return {
          rootEl,
          labelEl: contentEl,
          text,
          email: extractEmail(text),
          norm: normalizeText(text)
        };
      })
      .filter(t => t.text);
  }

  function hasMoreContactsIndicator() {
    const container = document.querySelector(TAG_CONTAINER_SEL);
    if (!container) return false;

    const controls = Array.from(container.querySelectorAll('button, [role="button"], i18n-string'));
    return controls.some(el => /^\+\s*\d+\s*(more|mais)\b/i.test((el.innerText || '').trim()));
  }

  function getSingleVisibleTag(existingTags = null) {
    const tags = Array.isArray(existingTags) ? existingTags : getTagEntries();
    if (tags.length !== 1) return null;
    if (hasMoreContactsIndicator()) return null;
    return tags[0];
  }

  function findEmailInNode(root) {
    if (!root) return null;

    const mailto = root.querySelector('a[href^="mailto:"]');
    if (mailto) {
      const hrefEmail = extractEmail((mailto.getAttribute('href') || '').replace('mailto:', ''));
      if (hrefEmail) return hrefEmail;
      const txtEmail = extractEmail(mailto.innerText || '');
      if (txtEmail) return txtEmail;
    }

    const candidates = root.querySelectorAll('a, span, div, td, p');
    for (const el of candidates) {
      const email = extractEmail(el.innerText || '');
      if (email) return email;
    }

    return extractEmail(root.innerText || '');
  }

  function isRequesterTitle(text) {
    const n = normalizeText(text || '');
    if (!n) return false;
    return n.includes('requerente') || n.includes('requester') || n.includes('applicant');
  }

  function isNameMatch(ownerNorm, candidateNorm) {
    if (!ownerNorm || !candidateNorm) return false;
    if (ownerNorm === candidateNorm) return true;
    if (ownerNorm.length >= 6 && candidateNorm.includes(ownerNorm)) return true;
    if (candidateNorm.length >= 6 && ownerNorm.includes(candidateNorm)) return true;
    return false;
  }

  function getRequesterOwnerEmail(sectionRoot, ownerRaw) {
    if (!sectionRoot) return null;
    const ownerNorm = normalizeText(ownerRaw || '');
    if (!ownerNorm) return null;

    const tiles = Array.from(sectionRoot.querySelectorAll(
      '[data-test-id^="chiclet-0-1-"], [data-test-id^="chicklet-"], [data-selenium-test="chicklet"]'
    ));

    for (const tile of tiles) {
      const nameNode =
        tile.querySelector('[data-selenium-test="contact-chicklet-title-link"]') ||
        tile.querySelector('[data-test-id="contact-chicklet-title-link"]') ||
        tile.querySelector('[data-test-id="contact-chicklet-title"]') ||
        tile.querySelector('a[href*="/record/0-1/"]');
      const contactNameNorm = normalizeText(nameNode?.innerText || '');
      if (!isNameMatch(ownerNorm, contactNameNorm)) continue;

      const emailNode =
        tile.querySelector('a[data-test-id="contact-chicklet-email"][href^="mailto:"]') ||
        tile.querySelector('a[href^="mailto:"]');
      const byHref = extractEmail((emailNode?.getAttribute('href') || '').replace('mailto:', ''));
      if (byHref) return byHref;

      const byText = extractEmail(emailNode?.innerText || '');
      if (byText) return byText;

      const byNode = findEmailInNode(tile);
      if (byNode) return byNode;
    }

    // If owner match failed but there is only one requester card, use it.
    if (tiles.length === 1) {
      const onlyEmail = findEmailInNode(tiles[0]);
      if (onlyEmail) return onlyEmail;
    }

    return null;
  }

  function getRequesterSectionRoot() {
    return (
      document.querySelector('[data-sidebar-key="Requerente"]') ||
      document.querySelector('[data-sidebar-key="Requester"]') ||
      document.querySelector('[data-sidebar-card-association-object-type-id="0-1"]') ||
      document.querySelector('[data-test-id="card-wrapper-ASSOCIATION_V3/0-1"]') ||
      null
    );
  }

  async function resolveEmailFromRequesterSection(ownerRaw = null, maxMs = 750) {
    const started = Date.now();

    while (Date.now() - started < maxMs) {
      if (!isCurrent() || emailSent) return null;

      let sectionRoot = getRequesterSectionRoot();
      let header = null;

      if (!sectionRoot) {
        const titleEls = Array.from(document.querySelectorAll('[data-selenium-test="crm-card-title"], h2, [role="heading"]'));
        const requesterTitleEl = titleEls.find(el => isRequesterTitle(el.innerText || ''));
        if (requesterTitleEl) {
          header =
            requesterTitleEl.closest('[class*="ExpandableSection__ExpandableHeader"]') ||
            requesterTitleEl.closest('.ExpandableSection__ExpandableHeader-hBFtMA') ||
            requesterTitleEl.closest('div');
          sectionRoot =
            requesterTitleEl.closest('[class*="ExpandableSection"]') ||
            header?.parentElement ||
            requesterTitleEl.parentElement;
        }
      } else {
        header =
          sectionRoot.querySelector('[class*="ExpandableSection__ExpandableHeader"]') ||
          sectionRoot.querySelector('.ExpandableSection__ExpandableHeader-hBFtMA') ||
          sectionRoot;
      }

      if (sectionRoot) {
        const toggle =
          header?.querySelector('[role="button"][aria-expanded]') ||
          sectionRoot.querySelector('[role="button"][aria-expanded]');

        if (toggle?.getAttribute('aria-expanded') === 'false') {
          toggle.click();
          await new Promise(r => setTimeout(r, 70));
          if (!isCurrent() || emailSent) return null;
        }

        const ownerMatchedEmail = getRequesterOwnerEmail(sectionRoot, ownerRaw);
        if (ownerMatchedEmail) return ownerMatchedEmail;

        if (!ownerRaw) {
          const emailInSection = findEmailInNode(sectionRoot);
          if (emailInSection) return emailInSection;

          const emailNearHeader = findEmailInNode(header?.parentElement || header);
          if (emailNearHeader) return emailNearHeader;
        }
      }

      await new Promise(r => setTimeout(r, 55));
    }

    return null;
  }

  function tryOpenerEmail() {
    if (!isCurrent() || emailSent) return false;
    const openerRaw = getTicketOpenerLabel();
    const openerEmail = extractEmail(openerRaw || '');
    if (!openerEmail) return false;
    sendEmail(openerEmail);
    return true;
  }

  async function trySingleTagFlashEmail(existingTags = null, maxMs = 420) {
    if (!isCurrent() || emailSent) return null;
    const initialSingle = getSingleVisibleTag(existingTags);
    if (!initialSingle) return null;

    const immediate = extractEmail(initialSingle.text || '');
    if (immediate) return immediate;

    const started = Date.now();
    const container = document.querySelector(TAG_CONTAINER_SEL) || initialSingle.rootEl;
    if (!container) return null;

    return new Promise(resolve => {
      let timer = null;
      const observer = new MutationObserver(() => {
        if (!isCurrent() || emailSent) {
          cleanup();
          resolve(null);
          return;
        }
        const freshSingle = getSingleVisibleTag();
        if (!freshSingle) return;
        const flashed = extractEmail(freshSingle.text || '');
        if (flashed) {
          cleanup();
          resolve(flashed);
        }
      });

      function cleanup() {
        observer.disconnect();
        if (timer) clearInterval(timer);
      }

      observer.observe(container, { childList: true, subtree: true, characterData: true });

      timer = setInterval(() => {
        if (Date.now() - started >= maxMs || !isCurrent() || emailSent) {
          cleanup();
          resolve(null);
          return;
        }
        const freshSingle = getSingleVisibleTag();
        if (!freshSingle) return;
        const flashed = extractEmail(freshSingle.text || '');
        if (flashed) {
          cleanup();
          resolve(flashed);
        }
      }, 30);
    });
  }

  async function resolveHeaderOwnerThenRequester(maxMs = 750) {
    if (!isCurrent() || emailSent) return false;
    if (tryOpenerEmail()) return true;

    // Single-contact fast path:
    // if opener is not an email, hover the single contact tag immediately
    // before doing requester-section traversal.
    const singleTag = getSingleVisibleTag();
    if (singleTag) {
      const resolvedSingle = await resolveSingleContact(singleTag);
      if (resolvedSingle) return true;
      if (!isCurrent() || emailSent) return false;
    }

    const openerRaw = getTicketOpenerLabel();
    if (!openerRaw) return false;

    const requesterEmail = await resolveEmailFromRequesterSection(openerRaw, maxMs);
    if (!requesterEmail) return false;

    sendEmail(requesterEmail);
    return true;
  }

  function tryStaticSources(preferredEmail = null) {
    if (!isCurrent() || emailSent) return false;

    const contactTxt = document.querySelector(CONTACT_SEL)?.innerText?.trim();
    if (contactTxt) {
      const e = extractEmail(contactTxt);
      if (e && (!preferredEmail || e === preferredEmail)) {
        sendEmail(e);
        return true;
      }
    }

    const chickletEl = document.querySelector(CHICKLET_SEL);
    if (chickletEl) {
      const href = (chickletEl.getAttribute('href') || '').replace('mailto:', '');
      const e = extractEmail(href) || extractEmail(chickletEl.innerText?.trim() || '');
      if (e && (!preferredEmail || e === preferredEmail)) {
        sendEmail(e);
        return true;
      }
    }

    return false;
  }

  function finalizeNoEmailFound() {
    if (emailSent) return;
    if (!isCurrent()) return;
    cleanupExtractionTimers();
    localData.name = localData.name || '-';
    localData.email = '> Email n\u00e3o encontrado';
    localData.doc = '-';
    localData.accounts = '-';
    renderPopup();
    msgBg({ action: 'EMAIL_UNAVAILABLE', processId });
  }

  function hoverTagForEmail(tagEl, timeoutMs = 2000) {
    return new Promise(resolve => {
      if (!tagEl || !document.contains(tagEl)) {
        resolve(null);
        return;
      }

      const targets = [tagEl];
      const tagRoot = tagEl.closest('[data-component-name="UITag"]');
      const textTarget =
        tagEl.querySelector?.('[data-content="true"]') ||
        tagEl.querySelector?.('span[tabindex]') ||
        tagRoot?.querySelector?.('[data-content="true"]') ||
        tagRoot?.querySelector?.('span[tabindex]') ||
        null;

      if (textTarget && !targets.includes(textTarget)) targets.unshift(textTarget);
      if (tagRoot && !targets.includes(tagRoot)) targets.push(tagRoot);

      for (const target of targets) dispatchHover(target);

      const started = Date.now();
      const poll = setInterval(() => {
        if (!isCurrent() || emailSent) {
          clearInterval(poll);
          resolve(null);
          return;
        }

        // Keep nudging hover while waiting because HubSpot can attach handlers late.
        for (const target of targets) dispatchHover(target);

        const popoverText =
          document.querySelector('[data-component-name="UIPopover"]')?.innerText ||
          document.querySelector('[role="tooltip"]')?.innerText ||
          '';
        const email = extractEmail(popoverText);
        if (email) {
          clearInterval(poll);
          resolve(email);
          return;
        }

        if (Date.now() - started >= timeoutMs) {
          clearInterval(poll);
          resolve(null);
        }
      }, 45);
    });
  }

  async function hoverWithRetry(tagEl, attempts = [800, 1200]) {
    for (let i = 0; i < attempts.length; i++) {
      if (!isCurrent() || emailSent) return null;
      const email = await hoverTagForEmail(tagEl, attempts[i]);
      if (email) return email;
      if (i < attempts.length - 1) {
        await new Promise(r => setTimeout(r, 120));
      }
    }
    return null;
  }

  async function resolveSingleContact(tag) {
    if (!tag) return false;

    if (tag.email) {
      sendEmail(tag.email);
      return true;
    }

    setNameIfNeeded(tag.text);
    const hoveredEmail = await hoverWithRetry(tag.labelEl || tag.rootEl, [420, 750, 1100]);
    if (hoveredEmail) {
      sendEmail(hoveredEmail);
      return true;
    }

    return false;
  }

  async function resolveMultipleContacts(tags, openerRaw = null) {
    if (!tags.length) return false;

    const openerValue = openerRaw || getTicketOpenerLabel();
    if (!openerValue) return false;

    // If opener label is already the email, this is the owner email.
    const openerEmail = extractEmail(openerValue);
    if (openerEmail) {
      sendEmail(openerEmail);
      return true;
    }

    const openerNorm = normalizeText(openerValue);
    if (!openerNorm) return false;

    const match =
      tags.find(t => !t.email && t.norm === openerNorm) ||
      tags.find(t => !t.email && (t.norm.includes(openerNorm) || openerNorm.includes(t.norm))) ||
      tags.find(t => t.norm === openerNorm) ||
      null;

    if (!match) return false;

    if (match.email) {
      sendEmail(match.email);
      return true;
    }

    setNameIfNeeded(match.text);
    const hoveredEmail = await hoverWithRetry(match.labelEl || match.rootEl, [450, 800, 1200]);
    if (hoveredEmail) {
      sendEmail(hoveredEmail);
      return true;
    }

    return false;
  }

  async function resolveMultipleOwnerEmail(tags) {
    const openerRaw = getTicketOpenerLabel();

    // Priority for multi/hidden contacts: use explicit requester section owner email.
    const requesterEmail = await resolveEmailFromRequesterSection(openerRaw, 750);
    if (requesterEmail) {
      sendEmail(requesterEmail);
      return true;
    }

    return resolveMultipleContacts(tags, openerRaw);
  }

  async function waitForTagEntries(maxMs = 2800) {
    return new Promise(resolve => {
      const finish = (tags) => {
        if (tagWaitTimer) {
          clearTimeout(tagWaitTimer);
          tagWaitTimer = null;
        }
        if (tagObserver) {
          tagObserver.disconnect();
          tagObserver = null;
        }
        resolve(tags);
      };

      const checkNow = () => {
        if (!isCurrent() || emailSent) {
          finish([]);
          return;
        }

        const tags = getTagEntries();
        if (tags.length) {
          finish(tags);
          return;
        }
      };

      checkNow();
      if (emailSent) return;

      tagObserver = new MutationObserver(checkNow);
      tagObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

      tagWaitTimer = setTimeout(() => finish([]), maxMs);
    });
  }

  async function retryBeforeNoEmailFound() {
    if (noEmailRetryUsed || noEmailRetryRunning) return false;
    noEmailRetryUsed = true;
    noEmailRetryRunning = true;

    try {
      if (!isCurrent() || emailSent) return true;

      // Short pause so HubSpot can finish rendering late listeners/tooltip roots.
      await new Promise(r => setTimeout(r, 260));
      if (!isCurrent() || emailSent) return true;

      let tags = getTagEntries();
      if (!tags.length) {
        tags = await waitForTagEntries(700);
      }

      if (!isCurrent() || emailSent) return true;

      const quickSingleEmail = await trySingleTagFlashEmail(tags, 420);
      if (quickSingleEmail) {
        sendEmail(quickSingleEmail);
        return true;
      }

      if (await resolveHeaderOwnerThenRequester(750)) return true;
      if (tryStaticSources()) return true;

      const multiOrHidden = tags.length > 1 || hasMoreContactsIndicator();
      if (multiOrHidden) {
        const ok = await resolveMultipleOwnerEmail(tags);
        if (ok || emailSent) return true;
        return false;
      }

      if (tags.length === 1) {
        const tag = tags[0];
        const ok = await resolveSingleContact(tag);
        if (ok || emailSent) return true;

        // One extra strong hover attempt on the exact single tag before giving up.
        const finalHoverEmail = await hoverWithRetry(tag.labelEl || tag.rootEl, [700, 1100]);
        if (finalHoverEmail) {
          sendEmail(finalHoverEmail);
          return true;
        }
      }

      if (tryStaticSources()) return true;
      return false;
    } finally {
      noEmailRetryRunning = false;
    }
  }

  function noEmailFound() {
    if (emailSent) return;
    if (!isCurrent()) return;

    if (!noEmailRetryUsed && !noEmailRetryRunning) {
      retryBeforeNoEmailFound().then(ok => {
        if (ok || emailSent || !isCurrent()) return;
        finalizeNoEmailFound();
      });
      return;
    }

    finalizeNoEmailFound();
  }

  function armExtractionWatchdog() {
    clearTimeout(extractionWatchdog);
    extractionWatchdog = setTimeout(async () => {
      if (!isCurrent() || emailSent) return;

      const tags = getTagEntries();
      const quickSingleEmail = await trySingleTagFlashEmail(tags, 420);
      if (quickSingleEmail) {
        sendEmail(quickSingleEmail);
        return;
      }

      if (await resolveHeaderOwnerThenRequester(750)) return;
      if (tryStaticSources()) return;

      const multiOrHidden = tags.length > 1 || hasMoreContactsIndicator();
      if (multiOrHidden) {
        // Multi-contact: must resolve from opener, never random fallback.
        const ok = await resolveMultipleOwnerEmail(tags);
        if (!ok && !emailSent && isCurrent()) noEmailFound();
        return;
      }

      if (tags.length === 1) {
        const ok = await resolveSingleContact(tags[0]);
        if (ok || emailSent || !isCurrent()) return;
        if (tryStaticSources()) return;
        goHover(processId, noEmailFound, tags[0].labelEl || tags[0].rootEl);
        return;
      }

      if (tryStaticSources()) return;
      goHover(processId, noEmailFound);
    }, 1800);
  }

  armExtractionWatchdog();

  (async () => {
    if (!isCurrent() || emailSent) return;

    // Toggle-on fast path: resolve directly from contact label hover (single)
    // or requester section (multi / +N more) before slower fallbacks.
    if (isForcedStart) {
      let forcedTags = getTagEntries();
      if (!forcedTags.length) {
        forcedTags = await waitForTagEntries(700);
      }

      if (!isCurrent() || emailSent) return;

      const forcedSingleEmail = await trySingleTagFlashEmail(forcedTags, 420);
      if (forcedSingleEmail) {
        sendEmail(forcedSingleEmail);
        return;
      }

      if (await resolveHeaderOwnerThenRequester(750)) return;
      if (tryStaticSources()) return;
    }

    let tags = getTagEntries();

    const immediateSingleEmail = await trySingleTagFlashEmail(tags, 420);
    if (immediateSingleEmail) {
      sendEmail(immediateSingleEmail);
      return;
    }

    if (await resolveHeaderOwnerThenRequester(750)) return;
    if (tryStaticSources()) return;

    if (!tags.length) {
      tags = await waitForTagEntries(900);
    }

    if (!isCurrent() || emailSent) return;

    const quickSingleEmail = await trySingleTagFlashEmail(tags, 420);
    if (quickSingleEmail) {
      sendEmail(quickSingleEmail);
      return;
    }

    if (await resolveHeaderOwnerThenRequester(750)) return;
    if (tryStaticSources()) return;

    const multiOrHidden = tags.length > 1 || hasMoreContactsIndicator();
    if (multiOrHidden) {
      const ok = await resolveMultipleOwnerEmail(tags);
      if (!ok && !emailSent && isCurrent()) noEmailFound();
      return;
    }

    if (tags.length === 1) {
      const ok = await resolveSingleContact(tags[0]);
      if (ok || emailSent || !isCurrent()) return;

      if (await resolveHeaderOwnerThenRequester(700)) return;
      if (tryStaticSources()) return;
      goHover(processId, noEmailFound, tags[0].labelEl || tags[0].rootEl);
      return;
    }

    // Tags never appeared: final generic fallback for single-contact pages.
    if (await resolveHeaderOwnerThenRequester(750)) return;
    if (tryStaticSources()) return;
    goHover(processId, noEmailFound);
  })();
}
function goHover(processId, noEmailFound, preferredTagEl = null) {
  if (currentProcessId !== processId || emailSent) return;
  hoverAttempted = true;
  getEmailFromHoverTooltip(processId, noEmailFound, preferredTagEl);
}

// After the tag shows an email, HubSpot replaces it with the name.
function watchTagForName(tagEl, processId) {
  // Name is sourced from BO email-search result only.
  return;
}

// Hover the tag â†’ UIPopover appears with email
function getEmailFromHoverTooltip(processId, noEmailFound, preferredTagEl = null) {
  const allTagSelector = '.EmailTagDisplayBar__StyledDiv-bJtzuP [data-component-name="UITag"]';
  const allTags = Array.from(document.querySelectorAll(allTagSelector));

  const orderedTags = [];
  if (preferredTagEl && document.contains(preferredTagEl)) orderedTags.push(preferredTagEl);
  for (const t of allTags) {
    if (!orderedTags.includes(t)) orderedTags.push(t);
  }

  if (!orderedTags.length) {
    if (!emailSent) noEmailFound?.();
    return;
  }

  const tryTagAt = (index) => {
    if (currentProcessId !== processId || emailSent) return;
    if (index >= orderedTags.length) {
      if (!emailSent) noEmailFound?.();
      return;
    }

    const tagEl = orderedTags[index];
    if (!tagEl || !document.contains(tagEl)) {
      tryTagAt(index + 1);
      return;
    }

    const dispatchHover = () => {
      const targets = [tagEl];
      const textTarget = tagEl.querySelector('[data-content="true"]') || tagEl.querySelector('span[tabindex]');
      if (textTarget && !targets.includes(textTarget)) targets.push(textTarget);
      for (const target of targets) {
        if (!target || !document.contains(target)) continue;
        target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('mouseover',  { bubbles: true }));
        target.dispatchEvent(new MouseEvent('mousemove',  { bubbles: true }));
        if (typeof PointerEvent === 'function') {
          target.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
          target.dispatchEvent(new PointerEvent('pointerover',  { bubbles: true }));
          target.dispatchEvent(new PointerEvent('pointermove',  { bubbles: true }));
        }
      }
    };

    dispatchHover();

    let tries = 0;
    const poll = setInterval(() => {
      tries++;

      if (currentProcessId !== processId) {
        clearInterval(poll);
        return;
      }

      dispatchHover();

      const tooltipText =
        document.querySelector('[data-component-name="UIPopover"]')?.innerText ||
        document.querySelector('[role="tooltip"]')?.innerText ||
        '';
      const email = extractEmail(tooltipText);
      if (email && !emailSent) {
        clearInterval(poll);
        emailSent = true;
        localData.email = email;
        renderPopup();
        msgBg({ action: 'DATA_EXTRACTED', processId, email });
        return;
      }

      if (tries > 18) {
        clearInterval(poll);
        tryTagAt(index + 1);
      }
    }, 40);
  };

  tryTagAt(0);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ HYPERFLOW EXTRACTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//
// URL:      /chats/{ticketId} or /all-chats/{ticketId}
//           /all-chats/all is also supported when a side-panel chat is open.
// Protocol: span.chat-protocol  (aria-label = ticketId â€” used as DOM-ready guard)
// Name:     span.chat-user
// Email:    the span that follows the "E-mail:" label span

function extractHyperflow(processId, ticketId) {

  // Wait for the DOM to reflect the correct chat (protocol ID must match),
  // then do ONE read at 100ms â€” no retries, no polling loop.
  let waitAttempts = 0;

  function waitForDom() {
    if (currentProcessId !== processId) return;
    waitAttempts++;

    const protocolId = extractHyperflowTicketIdFromDom();

    if (protocolId !== ticketId) {
      if (waitAttempts >= 300) { // ~15s max wait for DOM sync
        setAllEmpty();
      } else {
        extractionTimer = setTimeout(waitForDom, 50);
      }
      return;
    }

    // DOM is showing the correct chat â€” read once after 100ms
    extractionTimer = setTimeout(() => readOnce(processId), 100);
  }

  function readOnce(processId) {
    if (currentProcessId !== processId) return;

    // Name is sourced from BO email-search result only.

    // â”€â”€ Email: span following the "E-mail:" label â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let email = null;
    const labels = document.querySelectorAll('span.MuiTypography-caption');
    for (const label of labels) {
      if (label.innerText?.trim().startsWith('E-mail')) {
        const valueEl = label.nextElementSibling;
        const text    = valueEl?.getAttribute('aria-label')?.trim()
                     || valueEl?.innerText?.trim();
        if (text && text.includes('@')) {
          email = extractEmail(text);
        }
        break;
      }
    }

    if (email) {
      localData.email = email;
      msgBg({ action: 'DATA_EXTRACTED', processId, email });
    } else {
      // No email found â€” nothing to search, stop here
      localData.name     = '-';
      localData.email    = '-';
      localData.doc      = '-';
      localData.accounts = '-';
    }

    renderPopup();
  }

  function setAllEmpty() {
    if (currentProcessId !== processId) return;
    localData.name     = '-';
    localData.email    = '-';
    localData.doc      = '-';
    localData.accounts = '-';
    renderPopup();
  }

  waitForDom();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BACKGROUND â†’ CONTENT MESSAGES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// Buffer for UPDATE_POPUP messages that arrive (via very fast BO search) before
// enterTicket's await resolves and currentProcessId is assigned.
// Keyed by processId so only the right process's messages are replayed.
let pendingPopupUpdates = {}; // processId â†’ [fields, ...]

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'GET_CURRENT_DATA') {
    sendResponse({
      data: {
        id: localData.id ?? null,
        name: localData.name ?? null,
        email: localData.email ?? null,
        doc: localData.doc ?? null,
        accounts: localData.accounts ?? null
      },
      currentTicketId,
      currentProcessId,
      isTicketPage: isTicketPage()
    });
    return;
  }

  if (msg.action === 'UPDATE_POPUP') {
    if (!msg.processId) return;
    // If we already know this process, apply immediately
    if (msg.processId === currentProcessId) {
      if (msg.fields) { Object.assign(localData, msg.fields); renderPopup(); }
      return;
    }
    // currentProcessId not yet set (enterTicket still awaiting) â€” buffer the fields
    if (!pendingPopupUpdates[msg.processId]) pendingPopupUpdates[msg.processId] = [];
    if (msg.fields) pendingPopupUpdates[msg.processId].push(msg.fields);
  }
  if (msg.action === 'SHOW_CHECKMARK') {
    showCheckmark(msg.type);
  }

  if (msg.action === 'BO_TAB_STATE') {
    if (msg.state) {
      boTabState = {
        boTab1Assigned: !!msg.state.boTab1Assigned,
        boTab2Assigned: !!msg.state.boTab2Assigned,
        armedSlot: msg.state.armedSlot ?? null
      };
      renderBOTabButtons();
    }
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// POPUP RENDER
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function renderPopup() {
  if (!popup) return;

  const idEl       = popup.querySelector('#th-id-val');
  const nameEl     = popup.querySelector('#th-name-val');
  const emailEl    = popup.querySelector('#th-email-val');
  const docEl      = popup.querySelector('#th-doc-val');
  const accountsEl = popup.querySelector('#th-accounts-val');
  if (!idEl) return;

  const { id, name, email, doc, accounts } = localData;

  if (!id) {
    idEl.textContent       = '-';
    nameEl.textContent     = '-';
    emailEl.textContent    = '-';
    docEl.textContent      = '-';
    accountsEl.textContent = '-';
    return;
  }

  idEl.textContent       = id;
  nameEl.textContent     = name     === null ? '...' : (name     || '-');
  emailEl.textContent    = email    === null ? '...' : (email    || '-');
  docEl.textContent      = doc      === null ? '...' : (doc      || '-');
  accountsEl.textContent = accounts === null ? '...' : (accounts || '-');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// POPUP CREATION
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function createPopup() {
  if (popup || !document.body) return;

  popup = document.createElement('div');
  popup.id = 'ticket-helper-popup';

  popup.innerHTML = `
    <div class="th-row th-top-row">
      <div class="th-copyable" id="th-id-row" style="margin-right:8px">
        <span class="th-label">ID:</span>
        <span class="th-val" id="th-id-val">-</span>
        <span class="th-check" id="th-check-id"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="20 6 9 17 4 12"/></svg></span>
      </div>
      <div class="th-controls">
        <button class="th-btn th-bo-btn" id="th-btn-botab1" title="Definir aba BO 1" style="margin-left:-4px;margin-top:-2px">
          <svg class="th-bo-tab-icon th-bo-tab-empty" width="23" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block">
            <rect x="4" y="5" width="16" height="14" rx="2"/>
            <path class="th-bo-inner-line" d="M4 9h16"/>
          </svg>
          <svg class="th-bo-tab-icon th-bo-tab-filled" width="23" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block" aria-hidden="true">
            <rect x="3.5" y="4.5" width="17" height="15" rx="2"/>
            <text class="th-bo-tab-number" x="12" y="12" dy=".35em">1</text>
          </svg>
        </button>
        <button class="th-btn th-bo-btn" id="th-btn-botab2" title="Definir aba BO 2" style="margin-left:-4px;margin-top:-2px">
          <svg class="th-bo-tab-icon th-bo-tab-empty" width="23" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block">
            <rect x="4" y="5" width="16" height="14" rx="2"/>
            <path class="th-bo-inner-line" d="M4 9h16"/>
          </svg>
          <svg class="th-bo-tab-icon th-bo-tab-filled" width="23" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block" aria-hidden="true">
            <rect x="3.5" y="4.5" width="17" height="15" rx="2"/>
            <text class="th-bo-tab-number" x="12" y="12" dy=".35em">2</text>
          </svg>
        </button>
        <button class="th-btn" id="th-btn-bo-reset" title="Limpar abas BO" style="margin-left:-3px;margin-top:-3px">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="display:block;margin-left:1px;margin-top:1px">
            <g transform="translate(24 0) scale(-1 1)">
              <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" d="M4.252 4v5H9M5.07 8a8 8 0 1 1-.818 6"/>
            </g>
          </svg>
        </button>
        <span class="th-drag-handle" title="Arrastar">
          <svg width="12" height="15" viewBox="0 0 12 14" fill="currentColor" style="display:block">
            <circle cx="3" cy="2.5" r="1.4"/>
            <circle cx="9" cy="2.5" r="1.4"/>
            <circle cx="3" cy="7"   r="1.4"/>
            <circle cx="9" cy="7"   r="1.4"/>
            <circle cx="3" cy="11.5" r="1.4"/>
            <circle cx="9" cy="11.5" r="1.4"/>
          </svg>
        </span>
        <button class="th-btn" id="th-btn-gear" title="Configurações" style="margin-left:1px;margin-top:-2px">
          <svg width="15" height="15" viewBox="-1 -1 26 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;overflow:visible">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
        <button class="th-btn" id="th-btn-close" title="Desativar" style="margin-top:-2px">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" style="display:block">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="th-row">
      <div class="th-copyable" id="th-name-row">
        <span class="th-label">Nome:</span>
        <span class="th-val" id="th-name-val">-</span>
        <span class="th-check" id="th-check-name"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="20 6 9 17 4 12"/></svg></span>
      </div>
    </div>
    <div class="th-row">
      <div class="th-copyable" id="th-email-row">
        <span class="th-label">Email:</span>
        <span class="th-val" id="th-email-val">-</span>
        <span class="th-check" id="th-check-email"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="20 6 9 17 4 12"/></svg></span>
      </div>
    </div>
    <div class="th-row">
      <div class="th-copyable" id="th-doc-row">
        <span class="th-label">Doc.:</span>
        <span class="th-val" id="th-doc-val">-</span>
        <span class="th-check" id="th-check-doc"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:block"><polyline points="20 6 9 17 4 12"/></svg></span>
      </div>
    </div>
    <div class="th-row">
      <div class="th-static">
        <span class="th-label">Contas:</span>
        <span class="th-val" id="th-accounts-val">-</span>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  // Use a per-platform position key: HubSpot and Hyperflow each remember their own spot
  const posKey = isHubSpot() ? 'popupPosition_hubspot' : 'popupPosition_hyperflow';

  chrome.storage.local.get(posKey, (data) => {
    const pos = data[posKey];
    if (pos?.left != null && pos?.top != null) {
      popup.style.left = pos.left + 'px';
      popup.style.top  = pos.top  + 'px';
    } else {
      popup.style.left = (window.innerWidth  - 390) + 'px';
      popup.style.top  = (window.innerHeight - 160) + 'px';
    }
    popup.style.visibility = 'visible';
    clampPopup();
  });

  bindDragging();
  bindButtons();
  bindRowClicks();
  renderBOTabButtons();
  requestBOTabState();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DRAGGING
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function bindDragging() {
  const handle = popup.querySelector('.th-drag-handle');
  let dragging = false, ox = 0, oy = 0;

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    dragging = true;
    const rect = popup.getBoundingClientRect();
    popup.style.left   = rect.left + 'px';
    popup.style.top    = rect.top  + 'px';
    popup.style.right  = 'auto';
    popup.style.bottom = 'auto';
    ox = e.clientX - rect.left;
    oy = e.clientY - rect.top;
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    popup.style.left = (e.clientX - ox) + 'px';
    popup.style.top  = (e.clientY - oy) + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    clampPopup(true);
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// CLAMPING
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function clampPopup(save = false) {
  if (!popup) return;
  // Use parsed style values â€” not getBoundingClientRect which shifts with devtools
  const left   = parseFloat(popup.style.left) || 0;
  const top    = parseFloat(popup.style.top)  || 0;
  const width  = popup.offsetWidth;
  const height = popup.offsetHeight;
  const margin = 10;

  const clampedLeft = Math.max(margin, Math.min(left, window.innerWidth  - width  - margin));
  const clampedTop  = Math.max(margin, Math.min(top,  window.innerHeight - height - margin));

  // Only move if actually out of bounds
  if (clampedLeft !== left || clampedTop !== top) {
    popup.style.left = clampedLeft + 'px';
    popup.style.top  = clampedTop  + 'px';
  }
  popup.style.right  = 'auto';
  popup.style.bottom = 'auto';
  if (save) {
    const posKey = isHubSpot() ? 'popupPosition_hubspot' : 'popupPosition_hyperflow';
    safeSetLocal({ [posKey]: { left: clampedLeft, top: clampedTop } });
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// BUTTONS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function bindButtons() {
  popup.querySelector('#th-btn-close').addEventListener('click', () => msgBg({ action: 'FORCE_DISABLE' }));
  popup.querySelector('#th-btn-gear').addEventListener('click', () => msgBg({ action: 'OPEN_OPTIONS' }));
  popup.querySelector('#th-btn-bo-reset').addEventListener('click', async () => {
    const resp = await msgBg({ action: 'RESET_BO_TABS' });
    if (resp?.state) {
      boTabState = {
        boTab1Assigned: !!resp.state.boTab1Assigned,
        boTab2Assigned: !!resp.state.boTab2Assigned,
        armedSlot: resp.state.armedSlot ?? null
      };
      renderBOTabButtons();
    }
  });
  popup.querySelector('#th-btn-botab1').addEventListener('click', async () => {
    const resp = await msgBg({ action: 'ARM_BO_TAB', slot: 1 });
    if (resp?.state) {
      boTabState = {
        boTab1Assigned: !!resp.state.boTab1Assigned,
        boTab2Assigned: !!resp.state.boTab2Assigned,
        armedSlot: resp.state.armedSlot ?? null
      };
      renderBOTabButtons();
    }
  });
  popup.querySelector('#th-btn-botab2').addEventListener('click', async () => {
    const resp = await msgBg({ action: 'ARM_BO_TAB', slot: 2 });
    if (resp?.state) {
      boTabState = {
        boTab1Assigned: !!resp.state.boTab1Assigned,
        boTab2Assigned: !!resp.state.boTab2Assigned,
        armedSlot: resp.state.armedSlot ?? null
      };
      renderBOTabButtons();
    }
  });
}

function renderBOTabButtons() {
  if (!popup) return;
  const bo1Btn = popup.querySelector('#th-btn-botab1');
  const bo2Btn = popup.querySelector('#th-btn-botab2');
  if (!bo1Btn || !bo2Btn) return;

  const setVisual = (btn, slot, assigned) => {
    btn.classList.toggle('is-assigned', assigned);
    btn.classList.toggle('is-armed', boTabState.armedSlot === slot);
    btn.title = assigned ? `Ver aba BO ${slot}` : `Definir aba BO ${slot}`;
  };

  setVisual(bo1Btn, 1, !!boTabState.boTab1Assigned);
  setVisual(bo2Btn, 2, !!boTabState.boTab2Assigned);
}

async function requestBOTabState() {
  const resp = await msgBg({ action: 'GET_BO_TAB_STATE' });
  if (!resp?.state) return;

  boTabState = {
    boTab1Assigned: !!resp.state.boTab1Assigned,
    boTab2Assigned: !!resp.state.boTab2Assigned,
    armedSlot: resp.state.armedSlot ?? null
  };
  renderBOTabButtons();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ROW CLICKS â€” COPY
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function bindRowClicks() {
  popup.querySelector('#th-id-row').addEventListener('click', () => {
    if (!isCopyablePopupValue(String(localData.id ?? ''))) return;
    copyAndMark(String(localData.id), 'id');
  });

  popup.querySelector('#th-name-row').addEventListener('click', () => {
    const v = localData.name;
    if (!isCopyablePopupValue(v)) return;
    copyAndMark(v.includes('@') ? v : v.split(' ')[0], 'name');
  });

  popup.querySelector('#th-email-row').addEventListener('click', () => {
    const v = localData.email;
    if (!isCopyablePopupValue(v)) return;
    copyAndMark(v, 'email');
  });

  popup.querySelector('#th-doc-row').addEventListener('click', () => {
    const v = localData.doc;
    if (!isCopyablePopupValue(v)) return;
    copyAndMark(v, 'doc');
  });
}

function copyAndMark(text, type) {
  navigator.clipboard.writeText(text)
    .then(() => showCheckmark(type))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showCheckmark(type);
    });
}

function showCheckmark(type) {
  // Clear all checkmarks first so only the latest copy is visible
  ['id', 'name', 'email', 'doc'].forEach(t => {
    if (t === type) return;
    const other = popup?.querySelector(`#th-check-${t}`);
    if (other) {
      other.classList.remove('th-check-visible');
      clearTimeout(checkmarkTimers[t]);
    }
  });

  const el = popup?.querySelector(`#th-check-${type}`);
  if (!el) return;
  el.classList.add('th-check-visible');
  clearTimeout(checkmarkTimers[type]);
  checkmarkTimers[type] = setTimeout(() => el.classList.remove('th-check-visible'), 2000);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STYLES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function injectStyles() {
  if (document.getElementById('th-styles')) return;
  const s = document.createElement('style');
  s.id = 'th-styles';
  s.textContent = `
    #ticket-helper-popup {
      position: fixed;
      width: 370px;
      background: #111827;
      color: #f9fafb;
      border-radius: 10px;
      font-size: 13px;
      font-family: 'SF Mono','Consolas','Menlo',monospace;
      z-index: 2147483647;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      padding: 6px 10px 8px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      visibility: hidden;
      user-select: none;
    }
    .th-row { display:flex; align-items:center; min-height:22px; }
    .th-top-row {
      justify-content:space-between; gap:6px;
      padding-bottom:4px; margin-bottom:2px;
      border-bottom:1px solid rgba(255,255,255,0.07);
    }
    .th-copyable {
      display:flex; align-items:center; gap:4px;
      flex:1; min-width:0; cursor:pointer;
      padding:2px 3px; border-radius:4px;
      transition:background 0.12s; overflow:hidden;
    }
    .th-copyable:hover { background:rgba(255,255,255,0.06); }
    .th-copyable:hover .th-val { text-decoration:underline; text-underline-offset:2px; }
    .th-static {
      display:flex; align-items:center; gap:4px;
      flex:1; min-width:0; padding:2px 3px; overflow:hidden;
    }
    .th-label { color:#6b7280; white-space:nowrap; flex-shrink:0; min-width:52px; }
    .th-val   { color:#f9fafb; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; }
    .th-check { color:#34d399; font-size:13px; font-weight:700; opacity:0; transition:opacity 0.15s; flex-shrink:0; margin-left:2px; }
    .th-check-visible { opacity:1 !important; }
    .th-controls {
      display:flex; align-items:center; gap:7px; flex-shrink:0;
    }
    .th-drag-handle {
      cursor:move; color:#4b5563;
      display:flex; align-items:center; justify-content:center;
      padding:2px 1px;
      margin-left:0;
      margin-top:-2px;
    }
    .th-drag-handle:hover { color:#9ca3af; }
    .th-btn {
      cursor:pointer; background:none; border:none; color:#4b5563;
      padding:0; line-height:0;
      display:flex; align-items:center; justify-content:center;
      transition:color 0.12s;
    }
    .th-btn:hover { color:#f9fafb; }
    .th-bo-btn {
      position: relative;
      width: 23px;
      height: 19px;
    }
    .th-bo-tab-icon {
      position: absolute;
      inset: 0;
      width: 23px;
      height: 19px;
    }
    .th-bo-tab-filled {
      display: none !important;
    }
    .th-bo-tab-number {
      fill: currentColor;
      font-size: 11.2px;
      font-family: 'Arial Black', 'Segoe UI', 'Roboto', 'Arial', sans-serif;
      font-weight: 900;
      font-variant-numeric: tabular-nums lining-nums;
      text-anchor: middle;
      dominant-baseline: auto;
      text-rendering: geometricPrecision;
      paint-order: stroke;
      stroke: currentColor;
      stroke-width: 0.15px;
      letter-spacing: -0.1px;
    }
    .th-bo-btn.is-assigned .th-bo-tab-empty {
      display: none !important;
    }
    .th-bo-btn.is-assigned .th-bo-tab-filled {
      display: block !important;
    }
    .th-bo-btn:hover .th-bo-tab-number {
      color: #f9fafb;
    }
    .th-bo-btn.is-armed {
      color: #f9fafb;
    }
  `;
  document.head.appendChild(s);
}

} // end guard



