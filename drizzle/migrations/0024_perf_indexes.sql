-- Indexes for the busiest queries that had none. Each one is named after
-- the query it serves. Indexes only; no data or behaviour changes.

-- Battle Zone: a member's first message (joinedAt), and the daily post cap
-- (user_id + role + created_at), on every list and every post.
CREATE INDEX IF NOT EXISTS community_messages_user_created_idx
  ON public.community_messages (user_id, created_at)
  WHERE user_id IS NOT NULL;

-- Guest battles: guestSince / guestPurse / the guest message limit, polled
-- every few seconds by GuestBattle.
CREATE INDEX IF NOT EXISTS community_messages_guest_created_idx
  ON public.community_messages (guest_id, created_at)
  WHERE guest_id IS NOT NULL;

-- check_generation_capacity counts songs in flight on every generation, and
-- queueStuckSongs looks for old ones on every cron tick. Only a handful of
-- rows are ever in these states, so the partial index stays tiny.
CREATE INDEX IF NOT EXISTS songs_in_flight_idx
  ON public.songs (status, generation_started_at)
  WHERE status IN ('pending', 'processing', 'queued');

-- suno-auto-retry: finished songs still missing the full-length file.
CREATE INDEX IF NOT EXISTS songs_missing_full_audio_idx
  ON public.songs (completed_at DESC)
  WHERE status = 'completed' AND audio_path IS NULL;

-- Payments webhook: refunds and store checkouts look a purchase up by
-- reference without its type, so the per-type unique indexes can't help.
CREATE INDEX IF NOT EXISTS coin_transactions_reference_idx
  ON public.coin_transactions (reference)
  WHERE reference IS NOT NULL;

-- Boss sales list: stripe purchases, newest first.
CREATE INDEX IF NOT EXISTS coin_transactions_type_created_idx
  ON public.coin_transactions (type, created_at DESC);

-- Battle slang pool: words used 3+ times, most recent first, every post.
CREATE INDEX IF NOT EXISTS battle_lexicon_recent_idx
  ON public.battle_lexicon (last_seen DESC)
  WHERE uses >= 3;

-- Boss/admin lookups (presence alerts on every battle post, new-user
-- alerts, generation failures) filter by role alone.
CREATE INDEX IF NOT EXISTS user_roles_role_idx
  ON public.user_roles (role);