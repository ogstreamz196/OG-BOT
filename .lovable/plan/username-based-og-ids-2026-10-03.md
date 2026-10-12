# Username-based OG IDs

## Changes
- Change the username prompt example from `Faiyaz196` to `Lexcel32`.
- Generate yearly VIP IDs as `OG` plus the member’s username in uppercase, for example `Lexcel32` becomes `OGLEXCEL32`.
- Keep an assigned OG ID synchronized when that member later changes their username.
- Convert existing assigned OG IDs to the same username-based format where each username maps uniquely.

## Safety and verification
- Keep OG ID assignment service-only and preserve the existing protection against direct member edits.
- Reject assignment if a username is missing, invalid, or would duplicate another OG ID.
- Verify the database change, app checks, and the username prompt in the phone-sized preview.
