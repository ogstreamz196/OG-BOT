# Automatic failed-track recovery

## Goal
When music generation or file delivery fails temporarily, OG BOT will keep retrying automatically in the background without another coin charge or requiring the user to press Retry.

## Changes
- Add a bounded retry record to each song: attempt count, next retry time, and last automatic retry time.
- Extend the existing Suno callback so temporary provider, network, and file-delivery failures queue background recovery instead of immediately leaving the track failed.
- Retry the existing Suno task first so completed takes are recovered without creating or charging for a new generation.
- For a genuinely failed generation, resubmit the same saved settings through a service-only path, with an atomic claim preventing duplicate retries.
- Use increasing delays and stop after a safe maximum; moderation/policy failures and invalid requests will not retry.
- Keep the existing manual Retry button as a fallback after automatic attempts are exhausted.
- Show “Retrying automatically” in the generation queue while recovery is active.

## Safety
- Automatic retries never deduct coins.
- Atomic database claims prevent the callback, background retry, and manual retry from running the same attempt concurrently.
- Existing style, lyrics, language, voice, duration, vocals-only, privacy, and second-take behavior remain unchanged.
- Retries are bounded to avoid endless provider usage.

## Verification
- Test transient callback failure, broken audio delivery, successful recovery, permanent moderation failure, duplicate callback, and exhausted retries.
- Confirm the original song row completes, coins do not change, two-take handling stays intact, and the app builds cleanly.
