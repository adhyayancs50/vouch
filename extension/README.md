# extension

Browser extension for vouch, the privacy-first interview verification system.

## Status

Local Manifest V3 prototype with explicit consent, Start/Stop controls, and tab-switch recording. No backend connection yet. No build step or dependencies required.

## Try it

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**, click **Load unpacked**, and select this `extension/` folder.
3. Open Vouch from Chrome's extensions menu.
4. Accept the recording notice and click **Start test session**.
5. Close the popup and switch tabs a few times.
6. Reopen Vouch and expand **View local records**.
7. Click **Stop**, switch tabs again, and confirm the count stays unchanged.

Before consent and Start, no events should be recorded. Reopening the popup should preserve session status. Records include tab IDs and UTC timestamps, without URLs or page contents. Records remain in `chrome.storage.local`; starting a new test clears previous records. Tracking stops at 1,000 records or on browser restart. This prototype observes tab activation across the current Chrome profile; window-focus changes alone are not recorded.

After editing the code, click the extension's reload button in `chrome://extensions`. Treat reloads/updates as development interruptions and stop your test session first.

## Docs

See [system architecture](../docs/02-system-architecture.md) and [feature specifications](../docs/04-feature-specifications.md).
