# Library Phase 2

## Build
- Upgrade Mine and Global track rows into a stable two-tier layout: artwork/title and metadata chips above; playback seek bar and compact actions below.
- Show useful chips for style, duration, unlock state, and version/take without exposing private generation details.
- Keep Play/Edit or Download as the primary actions and move Share, Drive backup, Remix, and Delete into the existing action drawer where applicable.
- Add Library filters for All, Unlocked, and Styles; make Styles open a compact selector generated from the current tracks.
- Keep the playlist queue synchronized with search and filters so shuffle only chooses visible tracks.

## Playback reliability
- Prevent overlapping audio when shuffle, next, or second-take playback switches tracks.
- Preserve fresh signed-link renewal and retry behavior across sequential and shuffled playback.
- Confirm a revealed second take joins the queue and can play after the original.

## Verification
- Use the signed-in preview to walk track creation as far as practical without wasting coins, then test an existing original/second-take pair.
- Open a track, seek, enable shuffle, switch to the second take, and observe continuous playback and player state.
- Check the complete Library at 411×733, including filters, long titles, chips, seek bars, and action drawers.
- Run focused tests and confirm the preview build remains clean.
