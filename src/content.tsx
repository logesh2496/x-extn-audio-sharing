// Content Script for DJ Extension (Runs in ISOLATED world)
// Mounts the DJ Share Audio control panel directly into the X page (top-right)
// and bridges the React UI to the main-world inject.js audio engine.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App, { type ContentBridge, type InjectStatus, type MicStatus } from './App';
import appCss from './App.css?inline';

console.log('[dj-extn-content] Content script loaded on x.com');

// Cached status from the main world injection script
let lastInjectStatus: InjectStatus = {
  isAudioCtxActive: false,
  isMicConnected: false,
  isTabSharing: false,
  micVolume: 1.0,
  tabVolume: 1.0,
  hasStreamId: false
};

// Subscribers (the React UI) interested in live status updates.
type StatusListener = (status: InjectStatus & { micStatus: MicStatus }) => void;
const statusListeners = new Set<StatusListener>();

// Inspect X's DOM to find the Spaces Mic button and check its mute status
function getXSpaceMicStatus(): MicStatus {
  const buttons = Array.from(document.querySelectorAll('button[aria-label]'));

  // Twitter/X Spaces mic button uses aria-label like "Mute mic", "Unmute mic", "Mute", "Unmute"
  const micButton = buttons.find(btn => {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    return (label.includes('mute') && label.includes('mic')) || label === 'mute' || label === 'unmute';
  });

  if (!micButton) {
    return { exists: false, isMuted: false, label: '', text: '' };
  }

  const label = micButton.getAttribute('aria-label') || '';
  const lowerLabel = label.toLowerCase();

  // If label is "Mute" or "Mute mic", it means clicking it will mute the mic, so the mic is currently ACTIVE.
  // If label is "Unmute" or "Unmute mic", it is currently MUTED.
  const isMuted = lowerLabel.includes('unmute');

  return { exists: true, isMuted, label, text: micButton.textContent || '' };
}

// Forward messages to the main world inject.js script
function sendToMainWorld(type: string, payload: any = {}) {
  window.postMessage({ source: 'dj-extn-content', type, payload }, '*');
}

// Listen for messages from the main world inject.js script
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.source !== 'dj-extn-inject') {
    return;
  }

  const { type, payload } = event.data;

  if (type === 'STATUS_UPDATE') {
    lastInjectStatus = payload;
    const snapshot = { ...lastInjectStatus, micStatus: getXSpaceMicStatus() };
    statusListeners.forEach((cb) => cb(snapshot));
  }
});

// Request initial status from main-world inject script
setTimeout(() => {
  sendToMainWorld('GET_STATUS');
}, 1000);

// The background worker relays tab-capture start/stop signals to the main world
// through us (the in-page panel can't open the desktop picker itself).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    case 'START_TAB_SHARE': {
      if (payload && payload.streamId) {
        sendToMainWorld('START_TAB_SHARE', { streamId: payload.streamId });
        sendResponse({ status: 'success' });
      } else {
        sendResponse({ status: 'error', message: 'No streamId provided' });
      }
      break;
    }

    case 'STOP_TAB_SHARE': {
      sendToMainWorld('STOP_TAB_SHARE');
      sendResponse({ status: 'success' });
      break;
    }

    case 'TOGGLE_PANEL': {
      togglePanel();
      sendResponse({ status: 'success' });
      break;
    }

    default:
      sendResponse({ status: 'error', message: `Unknown message type: ${type}` });
      break;
  }

  return true; // Keep message channel open for asynchronous replies
});

// --- UI mounting -----------------------------------------------------------

const bridge: ContentBridge = {
  get pageTitle() {
    return document.title;
  },
  getMicStatus: getXSpaceMicStatus,
  getInjectStatus: () => lastInjectStatus,
  sendToMainWorld,
  subscribe: (cb) => {
    statusListeners.add(cb);
    return () => statusListeners.delete(cb);
  }
};

let hostEl: HTMLDivElement | null = null;

function togglePanel() {
  // Mount lazily on first toggle so the panel only appears once the user
  // explicitly opens it (via the toolbar icon).
  if (!hostEl) {
    mountPanel();
    return;
  }
  hostEl.style.display = hostEl.style.display === 'none' ? 'block' : 'none';
}

function mountPanel() {
  if (hostEl) return;

  // Host element pinned to the top-right of the viewport. The UI lives inside a
  // shadow root so X's page styles can't bleed into it (and vice versa).
  hostEl = document.createElement('div');
  hostEl.id = 'dj-extn-panel-host';
  hostEl.style.cssText = [
    'position: fixed',
    'top: 16px',
    'right: 16px',
    'z-index: 2147483647',
    'width: 350px'
  ].join(';');

  const shadow = hostEl.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  // App.css declares its theme tokens on :root, which won't match inside a
  // shadow tree — remap them onto :host so the variables resolve.
  style.textContent = appCss.replace(/:root/g, ':host');
  shadow.appendChild(style);

  const mount = document.createElement('div');
  shadow.appendChild(mount);

  document.body.appendChild(hostEl);

  createRoot(mount).render(
    <StrictMode>
      <App bridge={bridge} />
    </StrictMode>
  );
}

// The panel is no longer mounted on page load — it mounts the first time the
// user opens it via the toolbar icon (see TOGGLE_PANEL / togglePanel).
