# Chrome Web Store Listing — Space DJ for X Spaces

> Last Updated: 2026-06-09

## Store Listing

**Extension Name**  
Space DJ

**Short Description**  
Mix any tab's audio into your X (Twitter) Space mic — play music, clips, and sound effects live while you host. Includes a built-in mixer to balance tab audio against your microphone.

**Detailed Description**  
Space DJ is a powerful tool designed for X Spaces hosts, speakers, and DJs who want to share high-quality audio directly into their live broadcasts. Instead of holding a microphone to your speakers or relying on messy physical setups, this extension creates a virtual audio mixer inside your browser.

Key Features:

- Seamless Audio Routing: Captured audio from any selected tab is injected directly into X's WebRTC broadcast pipeline.
- Dual-Channel Mixer: Independently control the volume levels of your local microphone and your shared tab audio in real-time.
- Active Mic Detection: Verify the state of the X Spaces microphone button directly from the extension dashboard.
- Zero External Dependencies: Runs entirely inside the browser using modern Web Audio APIs. No virtual cable software required.

How to Use:

1. Open x.com, start or join an X Space, and turn on your microphone.
2. Click the DJ Share Audio extension icon.
3. Use the "Check Mic Button" to confirm the extension is connected to the Space.
4. Select the browser tab playing your audio (e.g. YouTube or music player) from the dropdown list.
5. Click "Share Tab Audio". The audio is instantly mixed.
6. Use the sliders to adjust your microphone and tab volume levels.

Privacy Note:
Space DJ processes all audio stream captures and mixing entirely on your local device. No audio recording or user-identifiable data is collected, stored, or transmitted off-device.

**Category**  
Social & Communication

**Single Purpose**  
Mixes captured browser tab audio into the microphone stream of active X Spaces broadcasts.

**Primary Language**  
English

## Graphics & Assets

| Asset            | Dimensions  | Status         | Filename |
| ---------------- | ----------- | -------------- | -------- |
| Store Icon       | 128×128 PNG | ⬜ Not created |          |
| Screenshot 1     | 1280×800    | ⬜ Not created |          |
| Screenshot 2     | 1280×800    | ⬜ Not created |          |
| Small Promo Tile | 440×280     | ⬜ Not created |          |

### Screenshot Notes

- **Screenshot 1**: Show the extension popup open alongside an active X Space, demonstrating the "Connected to X" green status and active mic badge.
- **Screenshot 2**: Show the dropdown selecting a source tab (e.g. a YouTube tab) and the visual equalizer playing when "Share Tab Audio" is active.

## Permissions Justification

| Permission          | Type             | Justification                                                                                                       |
| ------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `desktopCapture`    | permissions      | Required to prompt the user to select a tab and capture its audio output stream to route into X.                    |
| `activeTab`         | permissions      | Used to identify and interact with the active tab when the extension is launched.                                   |
| `scripting`         | permissions      | Required to run scripts in the context of the X tab for checking mic state and injecting Web Audio.                 |
| `tabs`              | permissions      | Needed to list titles and IDs of open tabs in the current window so the user can select which tab's audio to share. |
| `storage`           | permissions      | Persists user preferences such as saved volume/mixer levels between sessions.                                       |
| `cookies`           | permissions      | Used to read the X session context needed to associate the extension with the active Space.                         |
| `webNavigation`     | permissions      | Detects X SPA navigation events so the extension can re-attach to the Space UI as the user moves between pages.     |
| `history`           | permissions      | Required to inspect matching page navigation events and historical page state to maintain connections.              |
| `https://*.x.com/*` | host_permissions | Necessary to run content scripts on X to override the page's microphone capture and inspect the Space UI.           |
| `https://x.com/*`   | host_permissions | Necessary to run content scripts on X to override the page's microphone capture and inspect the Space UI.           |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**  
https://github.com/logeshrajappa/dj-share-audio/blob/main/PRIVACY.md

## Distribution

**Visibility**: Public  
**Regions**: All regions  
**Pricing**: Free

## Developer Info

**Publisher Name**  
Logesh Rajappa

**Contact Email**  
logeshr.dev@gmail.com

## Version History

| Version | Date       | Changes                                                  | Status |
| ------- | ---------- | -------------------------------------------------------- | ------ |
| 1.0.2   | 2026-06-09 | Initial release with mic detection and tab audio mixing. | Draft  |

## Review Notes

### Known Issues / Limitations

- **Tab Capture Limit**: Chrome only allows capturing audio from a tab that was activated under a user gesture in the extension. Our popup handles this using direct click listener routing.
- **Tab Muting**: When tab capture is active, Chrome may mute the tab audio locally to prevent feedback loops. Our Web Audio graph routes the mixed audio to the target page, which handles broadcast playback.
