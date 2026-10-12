// Server-only Ledgerly bookkeeping sync. The API key never leaves the server.
const BASE = "https://ledger.ogstreamz.co.uk/api/public/v1";

export type LedgerlySale = {
  amount: number; // GBP gross; negative for refunds
  description: string;
  reference: string;
  externalId: string;
  date?: string; // YYYY-MM-DD
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function pingLedgerly(apiKey: string) {
  const res = await fetch(`${BASE}/ping`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(6000),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; key_name?: string; error?: string; message?: string };
  return { status: res.status, body };
}

export async function postLedgerly(apiKey: string, sales: LedgerlySale[], timeoutMs = 6000) {
  const tx = sales.map((s) => ({
    date: s.date ?? new Date().toISOString().slice(0, 10),
    amount: Math.round(s.amount * 100) / 100,
    description: s.description,
    reference: s.reference,
    external_id: s.externalId,
  }));
  const res = await fetch(`${BASE}/transactions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(tx.length === 1 ? tx[0] : { transactions: tx.slice(0, 100) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body: text.slice(0, 300) };
}

/** Never throws; 6s timeout; failures logged with order ID for admin review. No retry loop. */
export async function sendSaleToLedgerly(sale: LedgerlySale): Promise<void> {
  try {
    const db = await admin();
    const { data } = await db.from("ledgerly_settings").select("enabled, api_key").eq("id", 1).maybeSingle();
    if (!data?.enabled || !data.api_key) return;
    let r: Awaited<ReturnType<typeof postLedgerly>>;
    try {
      r = await postLedgerly(data.api_key, [sale]);
    } catch (e) {
      const msg = `Network/timeout for ${sale.externalId}: ${String((e as Error)?.message ?? e)}`;
      console.error(JSON.stringify({ scope: "ledgerly", msg, externalId: sale.externalId }));
      await db.from("ledgerly_settings").update({ last_error: msg }).eq("id", 1);
      return;
    }
    if (r.ok) {
      console.log(JSON.stringify({ scope: "ledgerly", msg: "synced", externalId: sale.externalId }));
      await db.from("ledgerly_settings").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq("id", 1);
    } else {
      const msg = r.status === 429
        ? `Monthly Ledgerly limit reached (order ${sale.externalId} not sent)`
        : `HTTP ${r.status} for ${sale.externalId}: ${r.body}`;
      console.error(JSON.stringify({ scope: "ledgerly", msg, externalId: sale.externalId }));
      await db.from("ledgerly_settings").update({ last_error: msg }).eq("id", 1);
    }
  } catch (e) {
    console.error(JSON.stringify({ scope: "ledgerly", msg: "sync error", error: String(e), externalId: sale.externalId }));
  }
}

/** Back-compat alias. */
export const syncSaleToLedgerly = sendSaleToLedgerly;
