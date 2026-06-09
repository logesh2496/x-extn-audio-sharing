// Background Service Worker for DJ Extension
console.log('[dj-extn] Background script loaded');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[dj-extn] Extension installed/updated');
  // Initialize recording state
  chrome.storage.session.set({ recordingState: 'idle' });
});

// Interface for recording state: 'idle' | 'starting' | 'sharing' | 'stopping'

// Message router for coordinating capture streams and statuses
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[dj-extn] Background received message:', message, 'from:', sender);

  const { type, payload } = message;

  // REQUEST_TAB_CAPTURE: the in-page panel asks the background to open Chrome's
  // native "Choose a tab to share" picker (chrome.desktopCapture is unavailable
  // to content scripts), then relays the resulting streamId back to the X tab's
  // content script so the main-world engine can mix it in.
  if (type === 'REQUEST_TAB_CAPTURE') {
    const xTab = sender.tab;
    if (!xTab || !xTab.id) {
      sendResponse({ status: 'error', message: 'No originating tab for capture request' });
      return true;
    }

    (async () => {
      const { recordingState = 'idle' } = await chrome.storage.session.get('recordingState');
      if (recordingState === 'sharing') {
        sendResponse({ status: 'error', message: 'Capture is already in progress' });
        return;
      }

      // chooseDesktopMedia is callback-based and must associate the stream with
      // the X tab so its origin can consume the streamId via getUserMedia.
      chrome.desktopCapture.chooseDesktopMedia(['tab', 'audio'], xTab, async (streamId) => {
        if (!streamId) {
          // User dismissed the picker.
          sendResponse({ status: 'cancelled' });
          return;
        }

        try {
          await chrome.storage.session.set({ recordingState: 'starting' });
          console.log(`[dj-extn] Relaying stream ID to X tab ${xTab.id}:`, streamId);

          await chrome.tabs.sendMessage(xTab.id!, {
            type: 'START_TAB_SHARE',
            payload: { streamId }
          });

          await chrome.storage.session.set({
            recordingState: 'sharing',
            activeXTabId: xTab.id
          });

          sendResponse({ status: 'success', streamId });
        } catch (err: any) {
          console.error('[dj-extn] Failed to send stream ID to X tab:', err);
          await chrome.storage.session.set({ recordingState: 'idle' });
          sendResponse({ status: 'error', message: 'X tab did not receive the stream ID' });
        }
      });
    })();
    return true;
  }

  if (type === 'STOP_CAPTURE') {
    (async () => {
      try {
        const xTabId = payload?.xTabId || sender.tab?.id;
        const sessionData = await chrome.storage.session.get(['activeXTabId', 'recordingState']);
        const targetXTabId = xTabId || sessionData.activeXTabId;

        if (!targetXTabId) {
          sendResponse({ status: 'error', message: 'No active X tab ID found' });
          return;
        }

        await chrome.storage.session.set({ recordingState: 'stopping' });
        console.log('[dj-extn] Stopping tab capture for X tab:', targetXTabId);

        try {
          // Send STOP message to X content script
          await chrome.tabs.sendMessage(targetXTabId, { type: 'STOP_TAB_SHARE' });
        } catch (err) {
          console.warn('[dj-extn] Failed to send stop message to content script (it might be closed):', err);
        }

        await chrome.storage.session.set({
          recordingState: 'idle',
          activeSourceTabId: null,
          activeXTabId: null
        });

        sendResponse({ status: 'success' });
      } catch (err: any) {
        console.error('[dj-extn] Stop capture error:', err);
        await chrome.storage.session.set({ recordingState: 'idle' });
        sendResponse({ status: 'error', message: err.message || 'Failed to stop capture' });
      }
    })();
    return true; // Keep message channel open for async response
  }

  if (type === 'GET_CAPTURE_STATE') {
    chrome.storage.session.get(['recordingState', 'activeSourceTabId', 'activeXTabId']).then((data) => {
      sendResponse({ status: 'success', data });
    });
    return true;
  }

  return true;
});

// With no default_popup, clicking the toolbar icon toggles the in-page panel.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }).catch(() => {
      // Ignored: the active tab isn't x.com, so no content script is listening.
    });
  }
});
