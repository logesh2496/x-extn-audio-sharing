import { useState, useEffect, useRef } from 'react';

const SOUNDBOARD_SLOTS = 4;
const SOUNDBOARD_STORAGE_KEY = 'soundboard_clips';

interface SoundClip {
  name: string;
  dataUrl: string;
}

export interface MicStatus {
  exists: boolean;
  isMuted: boolean;
  label: string;
  text: string;
}

export interface InjectStatus {
  isAudioCtxActive: boolean;
  isMicConnected: boolean;
  isTabSharing: boolean;
  micVolume: number;
  tabVolume: number;
  hasStreamId: boolean;
}

// Bridge provided by the content script. It wraps everything that can only be
// done from within the X page (reading the Spaces mic button, talking to the
// main-world inject.js script, and subscribing to its live status updates).
export interface ContentBridge {
  pageTitle: string;
  getMicStatus: () => MicStatus;
  getInjectStatus: () => InjectStatus;
  sendToMainWorld: (type: string, payload?: any) => void;
  subscribe: (cb: (status: InjectStatus & { micStatus: MicStatus }) => void) => () => void;
}

function App({ bridge }: { bridge: ContentBridge }) {
  const [collapsed, setCollapsed] = useState(false);
  const draggedRef = useRef(false);

  // Drag-to-move: reposition the fixed shadow-root host element itself. We grab
  // the host via getRootNode().host and drive its left/top so the panel can be
  // moved anywhere on screen, independent of any internal layout.
  const handleDragStart = (e: React.PointerEvent) => {
    // Let clicks on the minimize button (and any header button) behave normally.
    if ((e.target as HTMLElement).closest('.icon-btn')) return;
    e.preventDefault();
    draggedRef.current = false;

    const root = (e.currentTarget as HTMLElement).getRootNode();
    const host = (root instanceof ShadowRoot ? root.host : null) as HTMLElement | null;
    if (!host) return;

    const rect = host.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;

    // Switch from the right-anchored default to explicit left/top.
    host.style.right = 'auto';
    host.style.left = `${rect.left}px`;
    host.style.top = `${rect.top}px`;

    const onMove = (ev: PointerEvent) => {
      host.style.left = `${rect.left + (ev.clientX - startX)}px`;
      host.style.top = `${rect.top + (ev.clientY - startY)}px`;
      // Mark as dragged so the trailing click doesn't toggle the panel.
      draggedRef.current = true;
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const [micStatus, setMicStatus] = useState<MicStatus>(bridge.getMicStatus());

  const [, setInjectStatus] = useState<InjectStatus>(bridge.getInjectStatus());

  const [captureState, setCaptureState] = useState<'idle' | 'starting' | 'sharing' | 'stopping'>('idle');

  const [micVolume, setMicVolume] = useState<number>(1.0);
  const [tabVolume, setTabVolume] = useState<number>(1.0);

  // Soundboard: 4 slots, each null (empty) or a stored clip.
  const [soundClips, setSoundClips] = useState<(SoundClip | null)[]>(
    () => Array(SOUNDBOARD_SLOTS).fill(null)
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSlotRef = useRef<number | null>(null);

  const [isCheckingMic, setIsCheckingMic] = useState(false);
  const [isTogglingShare, setIsTogglingShare] = useState(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Pull the current capture state from the background service worker.
  const refreshState = async () => {
    try {
      const stateResponse = await chrome.runtime.sendMessage({ type: 'GET_CAPTURE_STATE' });
      if (stateResponse && stateResponse.status === 'success') {
        setCaptureState(stateResponse.data.recordingState || 'idle');
      }
    } catch (err) {
      console.error('[dj-extn] Error refreshing panel state:', err);
    }
  };

  useEffect(() => {
    refreshState();

    // Live updates from the main-world inject script, delivered via the bridge.
    const unsubscribe = bridge.subscribe((status) => {
      setInjectStatus(status);
      setMicVolume(status.micVolume);
      setTabVolume(status.tabVolume);
      if (status.micStatus) {
        setMicStatus(status.micStatus);
      }
    });

    // Ask the main world for a fresh status snapshot.
    bridge.sendToMainWorld('GET_STATUS');

    return unsubscribe;
  }, []);

  // Load saved soundboard clips from chrome.storage.local and pre-decode them
  // in the main-world audio engine.
  useEffect(() => {
    chrome.storage.local.get(SOUNDBOARD_STORAGE_KEY).then((result) => {
      const saved = result[SOUNDBOARD_STORAGE_KEY] as (SoundClip | null)[] | undefined;
      if (!saved) return;
      const clips = Array(SOUNDBOARD_SLOTS)
        .fill(null)
        .map((_, i) => saved[i] || null);
      setSoundClips(clips);
      clips.forEach((clip, slot) => {
        if (clip) {
          bridge.sendToMainWorld('LOAD_SOUND_CLIP', { slot, dataUrl: clip.dataUrl });
        }
      });
    });
  }, []);

  // Persist the current soundboard slots to chrome.storage.local.
  const persistSoundClips = (clips: (SoundClip | null)[]) => {
    chrome.storage.local.set({ [SOUNDBOARD_STORAGE_KEY]: clips });
  };

  // Empty slot tapped → open the file picker for that slot.
  const handleSoundSlotUpload = (slot: number) => {
    pendingSlotRef.current = slot;
    fileInputRef.current?.click();
  };

  // A file was chosen for the pending slot.
  const handleSoundFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const slot = pendingSlotRef.current;
    e.target.value = ''; // allow re-selecting the same file later
    if (!file || slot === null) return;

    setAlertMessage(null);
    setSuccessMessage(null);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const clip: SoundClip = { name: file.name, dataUrl };

      // Non-blocking duration warning (>3s).
      const audio = new Audio();
      audio.onloadedmetadata = () => {
        if (audio.duration > 3) {
          setSuccessMessage(`Added "${file.name}" (${audio.duration.toFixed(1)}s — longer than 3s).`);
        } else {
          setSuccessMessage(`Added "${file.name}".`);
        }
      };
      audio.src = dataUrl;

      setSoundClips((prev) => {
        const next = [...prev];
        next[slot] = clip;
        persistSoundClips(next);
        return next;
      });
      bridge.sendToMainWorld('LOAD_SOUND_CLIP', { slot, dataUrl });
    };
    reader.onerror = () => setAlertMessage('Failed to read the audio file.');
    reader.readAsDataURL(file);
  };

  // Filled slot tapped → play (restart) the clip.
  const handleSoundPlay = (slot: number) => {
    bridge.sendToMainWorld('PLAY_SOUND_CLIP', { slot });
  };

  // Remove a clip from a slot.
  const handleSoundClear = (slot: number) => {
    setSoundClips((prev) => {
      const next = [...prev];
      next[slot] = null;
      persistSoundClips(next);
      return next;
    });
    bridge.sendToMainWorld('CLEAR_SOUND_CLIP', { slot });
  };

  // Re-read the X Spaces mic button straight from the page DOM.
  const handleCheckMic = () => {
    setIsCheckingMic(true);
    setAlertMessage(null);
    setSuccessMessage(null);

    const status = bridge.getMicStatus();
    setMicStatus(status);
    if (status.exists) {
      setSuccessMessage(`Mic button detected! Current state: ${status.isMuted ? 'Muted' : 'Active (Unmuted)'}`);
    } else {
      setAlertMessage('Mic button not found on X page. Make sure you are inside an active Space.');
    }

    setIsCheckingMic(false);
  };

  // Start Tab Audio Sharing. Content scripts can't open Chrome's native tab
  // picker (chrome.desktopCapture is unavailable), so the background worker
  // runs chooseDesktopMedia for this tab and relays the stream to the main world.
  const handleStartSharing = async () => {
    setIsTogglingShare(true);
    setAlertMessage(null);
    setSuccessMessage(null);

    try {
      const response = await chrome.runtime.sendMessage({ type: 'REQUEST_TAB_CAPTURE' });

      if (response && response.status === 'cancelled') {
        // User dismissed the picker — nothing to report.
      } else if (response && response.status === 'success') {
        setCaptureState('sharing');
        // Duck the live microphone to 0% so the shared tab audio plays cleanly
        // into the Space without picking up the host's mic by default.
        setMicVolume(0);
        bridge.sendToMainWorld('SET_MIC_VOLUME', { volume: 0 });
        setSuccessMessage('Audio stream bridge established! Captured audio is now mixing into your Space mic.');
      } else {
        setAlertMessage(response?.message || 'Failed to start audio sharing.');
      }
    } catch (err: any) {
      setAlertMessage(err?.message || 'Error communicating with extension worker.');
    } finally {
      setIsTogglingShare(false);
    }
  };

  // Stop Tab Audio Sharing
  const handleStopSharing = async () => {
    setIsTogglingShare(true);
    setAlertMessage(null);
    setSuccessMessage(null);

    try {
      const response = await chrome.runtime.sendMessage({ type: 'STOP_CAPTURE' });

      if (response && response.status === 'success') {
        setCaptureState('idle');
        setSuccessMessage('Audio sharing stopped.');
      } else {
        setAlertMessage(response?.message || 'Failed to stop audio sharing.');
      }
    } catch (err: any) {
      setAlertMessage(err?.message || 'Error stopping audio share.');
    } finally {
      setIsTogglingShare(false);
    }
  };

  // Update Volumes
  const handleMicVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setMicVolume(vol);
    bridge.sendToMainWorld('SET_MIC_VOLUME', { volume: vol });
  };

  const handleTabVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setTabVolume(vol);
    bridge.sendToMainWorld('SET_TAB_VOLUME', { volume: vol });
  };

  if (collapsed) {
    return (
      <button
        className="panel-fab"
        title="Open Space DJ"
        onPointerDown={handleDragStart}
        onClick={() => {
          if (draggedRef.current) return;
          setCollapsed(false);
        }}
      >
        <img className="panel-fab-img" src={chrome.runtime.getURL('dj.png')} alt="Space DJ" />
        <span className="panel-fab-name">Space DJ</span>
      </button>
    );
  }

  // Mic state → icon color + helper text for the simplified status row.
  const micState = !micStatus.exists ? 'missing' : micStatus.isMuted ? 'muted' : 'active';
  const micText = {
    missing: 'Mic not detected — open an active Space',
    muted: 'Mic muted',
    active: 'Mic active',
  }[micState];

  return (
    <div className="container fade-in">
      <header
        className="header"
        onPointerDown={handleDragStart}
      >
        <div className="logo-section">
          <img className="logo-img" src={chrome.runtime.getURL('dj.png')} alt="Space DJ" />
          <h1>Space DJ</h1>
        </div>
        <div className="header-actions">
          {/* Mic Status — when active, show the compact icon + text here */}
          {(micState === 'active' || micState === 'muted') && (
            <button
              className={`mic-status-row mic-${micState}`}
              onClick={handleCheckMic}
              disabled={isCheckingMic}
              title="Click to re-check the X Spaces mic button"
            >
              {isCheckingMic ? (
                <span className="spinner"></span>
              ) : (
                <svg viewBox="0 0 24 24" className="mic-status-icon" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 19v4M8 23h8"/>
                </svg>
              )}
              <span className="mic-status-text">{micText}</span>
            </button>
          )}
          <button
            className="icon-btn"
            title="Minimize"
            onClick={() => setCollapsed(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </header>

      {/* Mic Status — full-width line shown when the mic isn't active */}
      {micState === 'missing' && (
        <button
          className={`mic-status-row mic-${micState}`}
          onClick={handleCheckMic}
          disabled={isCheckingMic}
          title="Click to re-check the X Spaces mic button"
        >
          {isCheckingMic ? (
            <span className="spinner"></span>
          ) : (
            <svg viewBox="0 0 24 24" className="mic-status-icon" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 19v4M8 23h8"/>
              <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" />
            </svg>
          )}
          <span className="mic-status-text">{micText}</span>
        </button>
      )}

      {/* Audio Capture Section */}
      <section className="card capture-card">
        <div className="card-header">
          <span className="label">Share Tab Audio</span>
          {captureState === 'sharing' && (
            <div className="eq-container">
              <span className="bar bar1"></span>
              <span className="bar bar2"></span>
              <span className="bar bar3"></span>
              <span className="bar bar4"></span>
            </div>
          )}
        </div>
        <div className="card-content">
          {captureState === 'sharing' ? (
            <div className="sharing-state">
              <button
                className="btn btn-danger"
                onClick={handleStopSharing}
                disabled={isTogglingShare}
              >
                {isTogglingShare ? <span className="spinner"></span> : 'Stop Sharing Audio'}
              </button>
            </div>
          ) : (
            <div className="idle-state">
              <p className="description" style={{ marginBottom: '0.75rem', fontSize: '0.8rem', opacity: 0.7 }}>
                Chrome will ask you to pick a tab — its audio will mix into your Space mic.
              </p>
              <button
                className="btn btn-primary"
                onClick={handleStartSharing}
                disabled={isTogglingShare}
              >
                {isTogglingShare ? (
                  <span className="spinner"></span>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" className="btn-icon" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/>
                    </svg>
                    Share Tab Audio
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Mixer / Volume Section */}
      <section className="card mixer-card">
        <div className="card-header">
          <span className="label">Mixer console</span>
        </div>
        <div className="card-content mixer-sliders">
          <div className="slider-group">
            <div className="slider-label-row">
              <span className="slider-name">Microphone</span>
              <span className="slider-value">{Math.round(micVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={micVolume}
              onChange={handleMicVolumeChange}
              className="volume-slider"
            />
          </div>

          <div className="slider-group">
            <div className="slider-label-row">
              <span className="slider-name">Tab Audio</span>
              <span className="slider-value">{Math.round(tabVolume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={tabVolume}
              onChange={handleTabVolumeChange}
              disabled={captureState !== 'sharing'}
              className="volume-slider"
            />
          </div>
        </div>
      </section>

      {/* Soundboard Section */}
      <section className="card soundboard-card">
        <div className="card-header">
          <span className="label">Soundboard</span>
        </div>
        <div className="card-content">
          <div className="soundboard-grid">
            {soundClips.map((clip, slot) => (
              clip ? (
                <div key={slot} className="sound-btn sound-btn-filled">
                  <button
                    className="sound-btn-play"
                    title={`Play ${clip.name}`}
                    onClick={() => handleSoundPlay(slot)}
                  >
                    <svg viewBox="0 0 24 24" className="sound-btn-icon" fill="currentColor" stroke="none">
                      <polygon points="6 4 20 12 6 20 6 4" />
                    </svg>
                    <span className="sound-btn-name">{clip.name}</span>
                  </button>
                  <button
                    className="sound-btn-remove"
                    title="Remove clip"
                    onClick={() => handleSoundClear(slot)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ) : (
                <button
                  key={slot}
                  className="sound-btn sound-btn-empty"
                  title="Upload a sound clip"
                  onClick={() => handleSoundSlotUpload(slot)}
                >
                  <svg viewBox="0 0 24 24" className="sound-btn-icon" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              )
            ))}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            style={{ display: 'none' }}
            onChange={handleSoundFileChange}
          />
        </div>
      </section>

      {/* Notifications/Feedback */}
      {alertMessage && (
        <div className="alert alert-danger fade-in">
          <svg className="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="alert-text">{alertMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="alert alert-success fade-in">
          <svg className="alert-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span className="alert-text">{successMessage}</span>
        </div>
      )}
    </div>
  );
}

export default App;
