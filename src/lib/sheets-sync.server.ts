// Server-only helpers for syncing user profiles to a Google Sheet.
// Uses the Boss's own Google keys when set, otherwise the Lovable connector
// gateway (google_sheets connection); see connectors.server.ts.
//
// Setup (boss): create a Sheet, copy its ID, then save it via
//   admin/boss notifications panel ("Sheets spreadsheet ID").
// We then upsert one row per user (key = user_id in column A).

import { connectorFetch, connectorReady } from "@/lib/connectors.server";

const GW = "https://connector-gateway.lovable.dev/google_sheets";
const TAB = "Users";

type ProfileRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  coin_balance: number | null;
  created_at: string | null;
  telegram_chat_id: number | null;
  telegram_linked_at: string | null;
  last_sign_in_at: string | null;
  last_ip: string | null;
  last_country: string | null;
  last_city: string | null;
  last_device: string | null;
  sign_in_count: number | null;
};

const HEADERS = [
  "user_id",
  "email",
  "display_name",
  "coin_balance",
  "created_at",
  "telegram_chat_id",
  "telegram_linked_at",
  "last_sign_in_at",
  "last_ip",
  "last_country",
  "last_city",
  "last_device",
  "sign_in_count",
  "updated_at",
];

function rowFrom(p: ProfileRow): (string | number | null)[] {
  return [
    p.id,
    p.email,
    p.display_name,
    p.coin_balance ?? 0,
    p.created_at,
    p.telegram_chat_id,
    p.telegram_linked_at,
    p.last_sign_in_at,
    p.last_ip,
    p.last_country,
    p.last_city,
    p.last_device,
    p.sign_in_count ?? 0,
    new Date().toISOString(),
  ];
}

// The gateway's (or Google's own) auth is added by connectorFetch.
function gwHeaders() {
  if (!connectorReady("google_sheets")) return null;
  return { "Content-Type": "application/json" } as Record<string, string>;
}

async function getSheetId(): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings")
    .select("value")
    .eq("key", "users_sheet_id")
    .maybeSingle();
  const v = (data?.value as { id?: string } | null) ?? null;
  return v?.id ?? null;
}

async function ensureHeader(spreadsheetId: string, headers: Record<string, string>) {
  // Read header row
  const url = `${GW}/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${TAB}!1:1`)}`;
  const res = await connectorFetch(url, { headers });
  if (!res.ok) {
    // try create tab? best-effort: ignore — boss must create tab named "Users"
    return false;
  }
  const j: { values?: string[][] } = await res.json().catch(() => ({}));
  const current = j.values?.[0] ?? [];
  if (current.length >= HEADERS.length) return true;
  const updateUrl = `${GW}/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    `${TAB}!A1`,
  )}?valueInputOption=RAW`;
  await connectorFetch(updateUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify({ range: `${TAB}!A1`, majorDimension: "ROWS", values: [HEADERS] }),
  }).catch(() => null);
  return true;
}

async function findRowIndex(
  spreadsheetId: string,
  userId: string,
  headers: Record<string, string>,
): Promise<number | null> {
  const url = `${GW}/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${TAB}!A:A`)}`;
  const res = await connectorFetch(url, { headers });
  if (!res.ok) return null;
  const j: { values?: string[][] } = await res.json().catch(() => ({}));
  const rows = j.values ?? [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]?.[0] === userId) return i + 1; // 1-based row number
  }
  return null;
}

export async function upsertProfileRowToSheet(
  userId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const headers = gwHeaders();
  if (!headers) return { ok: false, reason: "google_sheets connector not configured" };
  const spreadsheetId = await getSheetId();
  if (!spreadsheetId) return { ok: false, reason: "no users_sheet_id configured" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, email, display_name, coin_balance, created_at, telegram_chat_id, telegram_linked_at, last_sign_in_at, last_ip, last_country, last_city, last_device, sign_in_count",
    )
    .eq("id", userId)
    .maybeSingle();
  if (!prof) return { ok: false, reason: "profile not found" };

  await ensureHeader(spreadsheetId, headers);

  const row = rowFrom(prof as ProfileRow);
  const existing = await findRowIndex(spreadsheetId, userId, headers);

  if (existing) {
    const range = `${TAB}!A${existing}`;
    const url = `${GW}/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
      range,
    )}?valueInputOption=RAW`;
    const res = await connectorFetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({ range, majorDimension: "ROWS", values: [row] }),
    });
    return { ok: res.ok, reason: res.ok ? undefined : `update HTTP ${res.status}` };
  }

  const url = `${GW}/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    `${TAB}!A:A`,
  )}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await connectorFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ values: [row] }),
  });
  return { ok: res.ok, reason: res.ok ? undefined : `append HTTP ${res.status}` };
}

export async function resyncAllProfilesToSheet(): Promise<{
  ok: boolean;
  count: number;
  reason?: string;
}> {
  const headers = gwHeaders();
  if (!headers) return { ok: false, count: 0, reason: "google_sheets connector not configured" };
  const spreadsheetId = await getSheetId();
  if (!spreadsheetId) return { ok: false, count: 0, reason: "no users_sheet_id configured" };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rows } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, email, display_name, coin_balance, created_at, telegram_chat_id, telegram_linked_at, last_sign_in_at, last_ip, last_country, last_city, last_device, sign_in_count",
    )
    .order("created_at", { ascending: true })
    .limit(5000);
  if (!rows) return { ok: false, count: 0, reason: "no profiles" };

  // Clear & write
  const clearUrl = `${GW}/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${TAB}!A:Z`)}:clear`;
  await connectorFetch(clearUrl, { method: "POST", headers }).catch(() => null);

  const values: (string | number | null)[][] = [
    HEADERS,
    ...rows.map((r) => rowFrom(r as ProfileRow)),
  ];
  const writeUrl = `${GW}/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(
    `${TAB}!A1`,
  )}?valueInputOption=RAW`;
  const res = await connectorFetch(writeUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify({ range: `${TAB}!A1`, majorDimension: "ROWS", values }),
  });
  return { ok: res.ok, count: rows.length, reason: res.ok ? undefined : `HTTP ${res.status}` };
}
