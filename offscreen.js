'use strict';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action !== 'WRITE_CLIPBOARD_OFFSCREEN') return;

  const text = typeof msg.value === 'string' ? msg.value : String(msg.value ?? '');

  navigator.clipboard.writeText(text)
    .then(() => sendResponse({ ok: true }))
    .catch(() => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.select();
        const copied = document.execCommand('copy');
        ta.remove();
        sendResponse({ ok: !!copied });
      } catch {
        sendResponse({ ok: false });
      }
    });

  return true;
});
