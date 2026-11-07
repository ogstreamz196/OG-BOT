// ogstreamz-stripe-webhook: ONE Stripe webhook for every OGSTREAMZ app (the
// owner, 2026-11-07). Stripe sends every event here; this checks Stripe's
// signature, keeps each event once in ogstreamz_billing.stripe_events labelled
// with its app (the event object's metadata.app: og_booking, padel, og_bot,
// ...), and answers 200 straight away. Each app reads its own unhandled events
// through <its schema>.stripe_events_pending() and marks them handled. The
// signing secret is the Supabase secret STRIPE_WEBHOOK_SECRET (a second one,
// STRIPE_WEBHOOK_SECRET_TEST, for test-mode events). Lovable holds nothing.
// Never logs a secret or a payload.
//
// Deployed to the OGSTREAMZ hub (verify_jwt off: Stripe signs instead). This
// copy is the source of record; it lives outside supabase/functions so Lovable
// never deploys it to Lovable Cloud. Tables: supabase/hub/06_stripe_events.sql.
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {
    db: { schema: "ogstreamz_billing" },
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const TOLERANCE_S = 300;
const enc = new TextEncoder();

function hex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Stripe-Signature: t=<time>,v1=<hmac>[,v1=...]. True when one v1 matches a secret and the time is fresh. */
async function verified(body: string, header: string, secrets: string[], now = Date.now() / 1000) {
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isFinite(t) || !sigs.length || Math.abs(now - t) > TOLERANCE_S) return false;
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const want = hex(await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`)));
    if (sigs.some((s) => safeEqual(s, want))) return true;
  }
  return false;
}

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "POST only" }, 405);
  const secrets = ["STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET_TEST"]
    .map((k) => Deno.env.get(k)?.trim() ?? "")
    .filter(Boolean);
  // Not set up yet: say so without accepting anything.
  if (!secrets.length) return reply({ error: "not configured" }, 503);
  const body = await req.text();
  if (!(await verified(body, req.headers.get("stripe-signature") ?? "", secrets)))
    return reply({ error: "bad signature" }, 400);

  let ev: {
    id?: string;
    type?: string;
    livemode?: boolean;
    created?: number;
    data?: {
      object?: {
        id?: string;
        customer?: string | null;
        metadata?: Record<string, string> | null;
        subscription_details?: { metadata?: Record<string, string> } | null;
        parent?: { subscription_details?: { metadata?: Record<string, string> } } | null;
      };
    };
  };
  try {
    ev = JSON.parse(body);
  } catch {
    return reply({ error: "bad json" }, 400);
  }
  if (!ev.id || !ev.type) return reply({ error: "bad event" }, 400);
  const obj = ev.data?.object ?? {};
  // The app label: on the object, or (invoices) on its subscription's details.
  const app =
    obj.metadata?.app ||
    obj.subscription_details?.metadata?.app ||
    obj.parent?.subscription_details?.metadata?.app ||
    "unknown";
  const { error } = await admin.from("stripe_events").upsert(
    {
      id: ev.id,
      type: ev.type,
      app: String(app).slice(0, 40),
      livemode: !!ev.livemode,
      object_id: typeof obj.id === "string" ? obj.id : null,
      customer: typeof obj.customer === "string" ? obj.customer : null,
      created_at: new Date((ev.created ?? Date.now() / 1000) * 1000).toISOString(),
      payload: ev,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  // Stripe retries on anything but 2xx, so a storage hiccup is worth a retry.
  if (error) {
    console.error("[stripe-webhook] store failed", ev.type);
    return reply({ error: "store failed" }, 500);
  }
  return reply({ received: true, app });
});
