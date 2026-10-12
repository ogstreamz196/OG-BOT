# Improve shared-track playback

## Changes
- Replace the small browser audio bar with a larger, touch-friendly player showing play/pause, a wide seek bar, and clear elapsed/total time.
- Attempt to start the track automatically when the shared page opens.
- If the browser blocks automatic audio, start playback on the listener's first touch, click, or key press anywhere on the page.
- Keep the existing clean order: OG BOT logo, track title, player, creation button, then lyrics.

## Verification
- Confirm playback and controls work on phone and desktop widths.
- Confirm the first-touch fallback only runs when automatic playback was blocked.
- Confirm unavailable/private tracks remain protected and the page builds cleanly.
