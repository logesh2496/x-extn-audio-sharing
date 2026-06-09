// Main World Script injected into x.com
// Overrides navigator.mediaDevices.getUserMedia to intercept mic capture and mix tab audio.

(function () {
  console.log('[dj-extn-inject] Main-world audio bridge script injected.');

  // Backup the original getUserMedia
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

  let audioCtx: AudioContext | null = null;
  let destination: MediaStreamAudioDestinationNode | null = null;
  let micSource: MediaStreamAudioSourceNode | null = null;
  let micGain: GainNode | null = null;

  let tabStream: MediaStream | null = null;
  let tabSource: MediaStreamAudioSourceNode | null = null;
  let tabGain: GainNode | null = null;

  let currentStreamId: string | null = null;
  let isTabSharing = false;

  let micVolume = 1.0;
  let tabVolume = 1.0;

  // Soundboard: short clips decoded into AudioBuffers, played on demand.
  let soundGain: GainNode | null = null;
  const soundBuffers = new Map<number, AudioBuffer>();
  const soundSources = new Map<number, AudioBufferSourceNode>();

  // Lazily create / resume the shared AudioContext so soundboard playback
  // works even before a Space (and thus the destination node) exists.
  async function ensureAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    return audioCtx;
  }

  // Override getUserMedia
  navigator.mediaDevices.getUserMedia = async function (constraints) {
    console.log('[dj-extn-inject] getUserMedia requested with constraints:', constraints);

    // If audio is requested, intercept and mix
    if (constraints && constraints.audio) {
      try {
        console.log('[dj-extn-inject] Intercepting microphone request to set up audio bridge.');
        
        // Fetch the actual microphone stream using the original getUserMedia
        const originalStream = await originalGetUserMedia(constraints);

        // Initialize AudioContext (runs in response to user action / space joining)
        const ctx = await ensureAudioCtx();

        // Create destination node for X Spaces to consume
        destination = ctx.createMediaStreamDestination();

        // Set up microphone node and gain control
        micSource = ctx.createMediaStreamSource(originalStream);
        micGain = ctx.createGain();
        micGain.gain.setValueAtTime(micVolume, ctx.currentTime);

        micSource.connect(micGain);
        micGain.connect(destination);

        // If a tab audio stream ID was already provided, connect it now
        if (currentStreamId) {
          console.log('[dj-extn-inject] Reconnecting pre-captured tab audio stream.');
          await connectTabAudio(currentStreamId);
        }

        console.log('[dj-extn-inject] Mixed audio stream successfully initialized.');
        sendStatusUpdate();

        // Return the mixed stream to the caller (X Space broadcast client)
        return destination.stream;
      } catch (err) {
        console.error('[dj-extn-inject] Error during intercepted getUserMedia execution:', err);
        throw err;
      }
    }

    // For video-only or non-audio calls, pass through to original
    return originalGetUserMedia(constraints);
  };

  // Connect the captured tab audio using its streamId
  async function connectTabAudio(streamId: string) {
    if (!audioCtx || !destination) {
      console.log('[dj-extn-inject] AudioContext or destination not ready. Saving streamId:', streamId);
      currentStreamId = streamId;
      isTabSharing = true;
      sendStatusUpdate();
      return;
    }

    try {
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      // Disconnect any existing tab capture
      disconnectTabAudio();

      console.log('[dj-extn-inject] Fetching tab capture MediaStream using streamId:', streamId);

      // Fetch the tab stream using original getUserMedia with desktop capture constraints
      const stream = await originalGetUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: streamId
          }
        } as any,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: streamId
          }
        } as any
      });

      // Stop video track — we only need audio
      stream.getVideoTracks().forEach(track => track.stop());

      tabStream = stream;
      tabSource = audioCtx.createMediaStreamSource(stream);
      tabGain = audioCtx.createGain();
      tabGain.gain.setValueAtTime(tabVolume, audioCtx.currentTime);

      // Mix tab audio into the destination node
      tabSource.connect(tabGain);
      tabGain.connect(destination);

      isTabSharing = true;
      currentStreamId = streamId;
      console.log('[dj-extn-inject] Tab audio successfully connected and mixed.');
      
      sendStatusUpdate();
    } catch (err) {
      console.error('[dj-extn-inject] Error connecting tab audio:', err);
      isTabSharing = false;
      sendStatusUpdate();
    }
  }

  // Disconnect tab audio mixing
  function disconnectTabAudio() {
    if (tabSource) {
      try {
        tabSource.disconnect();
      } catch (e) {}
      tabSource = null;
    }
    if (tabGain) {
      try {
        tabGain.disconnect();
      } catch (e) {}
      tabGain = null;
    }
    if (tabStream) {
      tabStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {}
      });
      tabStream = null;
    }
    isTabSharing = false;
    currentStreamId = null;
    console.log('[dj-extn-inject] Tab audio disconnected.');
    sendStatusUpdate();
  }

  // Adjust microphone volume
  function setMicVolume(vol: number) {
    micVolume = Math.max(0, Math.min(1, vol));
    if (micGain && audioCtx) {
      micGain.gain.setValueAtTime(micVolume, audioCtx.currentTime);
    }
    sendStatusUpdate();
  }

  // Adjust tab audio volume
  function setTabVolume(vol: number) {
    tabVolume = Math.max(0, Math.min(1, vol));
    if (tabGain && audioCtx) {
      tabGain.gain.setValueAtTime(tabVolume, audioCtx.currentTime);
    }
    sendStatusUpdate();
  }

  // Convert a base64 data-URL into an ArrayBuffer for decoding.
  function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
    const base64 = dataUrl.split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Decode and cache a soundboard clip for the given slot.
  async function loadSoundClip(slot: number, dataUrl: string) {
    try {
      const ctx = await ensureAudioCtx();
      const arrayBuffer = dataUrlToArrayBuffer(dataUrl);
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      soundBuffers.set(slot, buffer);
      console.log('[dj-extn-inject] Soundboard clip loaded for slot', slot);
    } catch (err) {
      console.error('[dj-extn-inject] Failed to load soundboard clip for slot', slot, err);
    }
  }

  // Play (or restart) the cached clip for the given slot.
  async function playSoundClip(slot: number) {
    const buffer = soundBuffers.get(slot);
    if (!buffer) {
      console.warn('[dj-extn-inject] No soundboard clip loaded for slot', slot);
      return;
    }

    const ctx = await ensureAudioCtx();

    // Shared gain node feeding both the Space mix and the local monitor.
    if (!soundGain) {
      soundGain = ctx.createGain();
      soundGain.gain.setValueAtTime(1.0, ctx.currentTime);
      // Local monitor so the DJ hears their own clips.
      soundGain.connect(ctx.destination);
    }
    // (Re)connect to the Space destination if it exists.
    if (destination) {
      try {
        soundGain.connect(destination);
      } catch (e) {}
    }

    // Restart semantics: stop any in-flight source for this slot.
    const existing = soundSources.get(slot);
    if (existing) {
      try {
        existing.onended = null;
        existing.stop();
      } catch (e) {}
      soundSources.delete(slot);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(soundGain);
    source.onended = () => {
      if (soundSources.get(slot) === source) {
        soundSources.delete(slot);
      }
    };
    soundSources.set(slot, source);
    source.start();
  }

  // Stop playback and drop the cached clip for a slot.
  function clearSoundClip(slot: number) {
    const existing = soundSources.get(slot);
    if (existing) {
      try {
        existing.onended = null;
        existing.stop();
      } catch (e) {}
      soundSources.delete(slot);
    }
    soundBuffers.delete(slot);
  }

  // Send status back to content script
  function sendStatusUpdate() {
    window.postMessage({
      source: 'dj-extn-inject',
      type: 'STATUS_UPDATE',
      payload: {
        isAudioCtxActive: !!audioCtx && audioCtx.state === 'running',
        isMicConnected: !!micSource,
        isTabSharing,
        micVolume,
        tabVolume,
        hasStreamId: !!currentStreamId
      }
    }, '*');
  }

  // Listen for messages from the isolated content script
  window.addEventListener('message', (event) => {
    // Standard safety verification for messages
    if (event.source !== window || !event.data || event.data.source !== 'dj-extn-content') {
      return;
    }

    const { type, payload } = event.data;
    console.log('[dj-extn-inject] Received payload from content script:', type, payload);

    switch (type) {
      case 'START_TAB_SHARE':
        if (payload && payload.streamId) {
          connectTabAudio(payload.streamId);
        }
        break;
      case 'STOP_TAB_SHARE':
        disconnectTabAudio();
        break;
      case 'SET_MIC_VOLUME':
        if (payload && typeof payload.volume === 'number') {
          setMicVolume(payload.volume);
        }
        break;
      case 'SET_TAB_VOLUME':
        if (payload && typeof payload.volume === 'number') {
          setTabVolume(payload.volume);
        }
        break;
      case 'GET_STATUS':
        sendStatusUpdate();
        break;
      case 'LOAD_SOUND_CLIP':
        if (payload && typeof payload.slot === 'number' && typeof payload.dataUrl === 'string') {
          loadSoundClip(payload.slot, payload.dataUrl);
        }
        break;
      case 'PLAY_SOUND_CLIP':
        if (payload && typeof payload.slot === 'number') {
          playSoundClip(payload.slot);
        }
        break;
      case 'CLEAR_SOUND_CLIP':
        if (payload && typeof payload.slot === 'number') {
          clearSoundClip(payload.slot);
        }
        break;
    }
  });

  // Periodically send status in case extension popup opens
  setInterval(() => {
    if (audioCtx) {
      sendStatusUpdate();
    }
  }, 3000);
})();
