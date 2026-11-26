// OG B0T's Stripe events from the OGSTREAMZ hub (the Boss, 2026-11-26: Stripe
// emailed that ogbot.co.uk's own webhook had failed since 22 November; "point
// at Supabase where we can"). The hub's shared webhook (ogstreamz-stripe-webhook)
// checks Stripe's signature and keeps every event labelled with its app; OG
// B0T's checkouts carry metadata.app = "og_bot". Once a minute (from the watch
// route) this reads OG B0T's unhandled events through og_bot.stripe_events_pending(),
// runs each through processStripeEvent (the same handling as the direct
// webhook, which stays as a second path) and marks it handled. The idempotency
// table means an event that arrives both ways runs once. Never throws.

type HubEvent = {
  id: string;
  type: string;
  livemode: boolean;
  payload: { id?: string; type?: string; data?: { object?: unknown } } | null;
};

const RUN_EVERY_MS = 55_000;
const BATCH = 20;
let lastRun = 0;

/** Collect and handle OG B0T's pending Stripe events from the hub. Returns a short status. */
export async function drainHubStripeEvents(now = Date.now()): Promise<string> {
  if (now - lastRun < RUN_EVERY_MS) return "waiting";
  lastRun = now;
  try {
    const { hub, hubKeySet } = await import("./ai-keys.server");
    if (!hubKeySet()) return "no hub key";
    const res = await hub("rpc/stripe_events_pending", {
      method: "POST",
      body: JSON.stringify({ p_limit: BATCH }),
    });
    if (!res.ok) return `hub ${res.status}`;
    const events = ((await res.json().catch(() => [])) as HubEvent[]) ?? [];
    if (!events.length) return "none";
    const { processStripeEvent, log } = await import("./stripe-events.server");
    let done = 0;
    let failed = 0;
    for (const e of events) {
      const ev = e.payload;
      if (!ev?.id || !ev.type || !ev.data) {
        await markHandled(hub, e.id, "skipped: no payload");
        continue;
      }
      const env = e.livemode ? "live" : "sandbox";
      try {
        const outcome = await processStripeEvent(
          { id: ev.id, type: ev.type, data: ev.data as { object: any } },
          env,
        );
        await markHandled(hub, e.id, outcome === "duplicate" ? "already handled" : "handled");
        done++;
      } catch (err) {
        // Left pending: the next pass tries again.
        failed++;
        log("error", "hub event failed", {
          eventId: e.id,
          type: e.type,
          err: String((err as Error)?.message ?? err),
        });
      }
    }
    return `handled ${done}${failed ? `, failed ${failed}` : ""}`;
  } catch (e) {
    console.warn("[stripe-hub]", e);
    return "error";
  }
}

async function markHandled(
  hub: (path: string, init?: RequestInit) => Promise<Response>,
  id: string,
  note: string,
): Promise<void> {
  await hub("rpc/stripe_event_handled", {
    method: "POST",
    body: JSON.stringify({ p_id: id, p_note: `og-bot: ${note}` }),
  }).catch(() => undefined);
}
