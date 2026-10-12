import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SPREADSHEET_ID = "1viHaEm53iWMCDEn9hEKI43YIu4amQ4djrgyn5iTa3Ls";
const DRIVE_FOLDER_ID = "1d5obQLuq7gLf2w-0f0Nk83KICyyGlxTo"; // OG BOT / Track Generations
const SHEETS_BASE = "https://connector-gateway.lovable.dev/google_sheets/v4";
const DRIVE_BASE = "https://connector-gateway.lovable.dev/google_drive/drive/v3";
const DRIVE_UPLOAD = "https://connector-gateway.lovable.dev/google_drive/upload/drive/v3";

function gatewayHeaders(connectorKey: string) {
  const lovable = process.env.LOVABLE_API_KEY;
  const conn = process.env[connectorKey];
  if (!lovable || !conn) throw new Error(`Missing ${connectorKey} or LOVABLE_API_KEY`);
  return {
    Authorization: `Bearer ${lovable}`,
    "X-Connection-Api-Key": conn,
  } as Record<string, string>;
}

async function gw(url: string, init: RequestInit, connectorKey: string) {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      ...gatewayHeaders(connectorKey),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`gateway ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

function safeTabName(input: string): string {
  // Sheets: max 100 chars, no : \ / ? * [ ]
  const cleaned = input.replace(/[:\\/?*[\]]/g, "_").slice(0, 95);
  return cleaned || "user";
}

async function ensureUserTab(sheetTitle: string): Promise<void> {
  const meta = await gw(
    `${SHEETS_BASE}/spreadsheets/${SPREADSHEET_ID}?fields=sheets(properties(title))`,
    { method: "GET" },
    "GOOGLE_SHEETS_API_KEY",
  );
  const data = (await meta.json()) as { sheets?: { properties?: { title?: string } }[] };
  const exists = data.sheets?.some((s) => s.properties?.title === sheetTitle);
  if (exists) return;
  await gw(
    `${SHEETS_BASE}/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: sheetTitle } } }],
      }),
    },
    "GOOGLE_SHEETS_API_KEY",
  );
}

async function writeRange(
  sheetTitle: string,
  range: string,
  values: (string | number | null)[][],
): Promise<void> {
  // NOTE: do NOT encodeURIComponent the range — the Sheets API requires the
  // literal `!` and `:` characters in the URL path; encoding them yields
  // "Unable to parse range: Sheet1!A1%3AZ1000" (HTTP 400).
  const fullRange = `'${sheetTitle.replace(/'/g, "''")}'!${range}`;
  await gw(
    `${SHEETS_BASE}/spreadsheets/${SPREADSHEET_ID}/values/${fullRange}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    },
    "GOOGLE_SHEETS_API_KEY",
  );
}

async function clearTab(sheetTitle: string): Promise<void> {
  const fullRange = `'${sheetTitle.replace(/'/g, "''")}'!A1:Z10000`;
  await gw(
    `${SHEETS_BASE}/spreadsheets/${SPREADSHEET_ID}/values/${fullRange}:clear`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    "GOOGLE_SHEETS_API_KEY",
  );
}

type Section = { heading: string; columns: string[]; rows: (string | number | null)[][] };

function flatten(sections: Section[]): (string | number | null)[][] {
  const out: (string | number | null)[][] = [];
  for (const s of sections) {
    out.push([s.heading]);
    out.push(s.columns);
    if (s.rows.length === 0) out.push(["(none)"]);
    else out.push(...s.rows);
    out.push([""]);
  }
  return out;
}

async function buildUserSnapshot(
  supabase: any,
  userId: string,
): Promise<{ tab: string; values: (string | number | null)[][] }> {
  const [profileRes, rolesRes, txRes, songsRes, msgsRes, portalsRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase
      .from("coin_transactions")
      .select("created_at,type,amount,reference")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("songs")
      .select(
        "id,title,status,style,prompt,duration_seconds,created_at,completed_at,audio_path,cover_url,unlocked,is_variation",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("og_messages")
      .select("created_at,role,content")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("portals")
      .select("id,slug,name,status,created_at")
      .eq("created_by", userId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const p = profileRes.data ?? {};
  const roles = (rolesRes.data ?? []).map((r: { role: string }) => r.role).join(", ");
  const label = p.display_name || p.email || userId.slice(0, 8);
  const tab = safeTabName(`${label} (${userId.slice(0, 6)})`);

  const sections: Section[] = [
    {
      heading: `=== PROFILE — synced ${new Date().toISOString()} ===`,
      columns: ["Field", "Value"],
      rows: [
        ["user_id", userId],
        ["email", p.email ?? ""],
        ["display_name", p.display_name ?? ""],
        ["roles", roles],
        ["coin_balance", p.coin_balance ?? 0],
        ["total_bot_interactions", p.total_bot_interactions ?? 0],
        ["telegram_chat_id", p.telegram_chat_id ?? ""],
        ["telegram_username", p.telegram_username ?? ""],
        ["last_page", p.last_page ?? ""],
        ["last_page_at", p.last_page_at ?? ""],
        ["created_at", p.created_at ?? ""],
        ["updated_at", p.updated_at ?? ""],
      ],
    },
    {
      heading: "=== COIN TRANSACTIONS ===",
      columns: ["created_at", "type", "amount", "reference"],
      rows: (txRes.data ?? []).map(
        (r: { created_at: string; type: string; amount: number; reference: string | null }) => [
          r.created_at,
          r.type,
          r.amount,
          r.reference ?? "",
        ],
      ),
    },
    {
      heading: "=== SONGS / GENERATIONS ===",
      columns: [
        "created_at",
        "id",
        "title",
        "status",
        "style",
        "duration_s",
        "completed_at",
        "unlocked",
        "is_variation",
        "cover_url",
        "audio_path",
        "prompt",
      ],
      rows: (songsRes.data ?? []).map((s: any) => [
        s.created_at,
        s.id,
        s.title ?? "",
        s.status ?? "",
        s.style ?? "",
        s.duration_seconds ?? "",
        s.completed_at ?? "",
        s.unlocked ? "yes" : "no",
        s.is_variation ? "yes" : "no",
        s.cover_url ?? "",
        s.audio_path ?? "",
        (s.prompt ?? "").slice(0, 500),
      ]),
    },
    {
      heading: "=== OG BOT MESSAGES ===",
      columns: ["created_at", "role", "content"],
      rows: (msgsRes.data ?? []).map((m: { created_at: string; role: string; content: string }) => [
        m.created_at,
        m.role,
        (m.content ?? "").slice(0, 1000),
      ]),
    },
    {
      heading: "=== PORTALS CREATED ===",
      columns: ["created_at", "id", "slug", "name", "status"],
      rows: (portalsRes.data ?? []).map(
        (p2: { created_at: string; id: string; slug: string; name: string; status: string }) => [
          p2.created_at,
          p2.id,
          p2.slug,
          p2.name,
          p2.status,
        ],
      ),
    },
  ];

  return { tab, values: flatten(sections) };
}

export const syncUserActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId?: string }) => input)
  .handler(async ({ data, context }) => {
    const targetId = data.userId ?? context.userId;
    // Only allow dev/admin to sync other users; users can sync themselves.
    if (targetId !== context.userId) {
      const { data: isDev } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "dev",
      });
      const { data: isAdmin } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!isDev && !isAdmin) throw new Error("forbidden");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const snap = await buildUserSnapshot(supabaseAdmin, targetId);
    await ensureUserTab(snap.tab);
    await clearTab(snap.tab);
    await writeRange(snap.tab, "A1", snap.values);
    return { ok: true, tab: snap.tab, rows: snap.values.length };
  });

export const syncAllUsersActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isDev } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "dev",
    });
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isDev && !isAdmin) throw new Error("forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .order("created_at", { ascending: true });
    if (error) throw error;
    let synced = 0;
    for (const u of users ?? []) {
      try {
        const snap = await buildUserSnapshot(supabaseAdmin, u.id);
        await ensureUserTab(snap.tab);
        await clearTab(snap.tab);
        await writeRange(snap.tab, "A1", snap.values);
        synced += 1;
      } catch (e) {
        console.error("sync failed for", u.id, e);
      }
    }
    return { ok: true, synced, total: users?.length ?? 0 };
  });

/** Archive a final (non-preview) song MP3 into the Drive folder. */
export const archiveFinalSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { songId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: song, error } = await supabaseAdmin
      .from("songs")
      .select("id,user_id,title,status,audio_path,is_variation,unlocked")
      .eq("id", data.songId)
      .maybeSingle();
    if (error || !song) throw new Error("song_not_found");

    // Only owner or dev/admin
    if (song.user_id !== context.userId) {
      const { data: isDev } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "dev",
      });
      const { data: isAdmin } = await context.supabase.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (!isDev && !isAdmin) throw new Error("forbidden");
    }

    if (song.status !== "complete" && song.status !== "completed") {
      return { ok: false, reason: "not_final" };
    }
    if (!song.audio_path) return { ok: false, reason: "no_audio" };

    // Resolve signed URL from storage if it's a storage path; otherwise fetch directly.
    let downloadUrl = song.audio_path;
    if (!/^https?:\/\//.test(song.audio_path)) {
      const { data: signed } = await supabaseAdmin.storage
        .from("song-files")
        .createSignedUrl(song.audio_path, 60 * 10);
      if (!signed?.signedUrl) return { ok: false, reason: "sign_failed" };
      downloadUrl = signed.signedUrl;
    }

    const audioRes = await fetch(downloadUrl);
    if (!audioRes.ok) throw new Error(`download ${audioRes.status}`);
    const audioBuf = new Uint8Array(await audioRes.arrayBuffer());

    const fileName = `${(song.title ?? "song").replace(/[\\/:*?"<>|]/g, "_")} - ${song.id}.mp3`;
    const metadata = { name: fileName, parents: [DRIVE_FOLDER_ID], mimeType: "audio/mpeg" };
    const boundary = "----lovableUserLog" + Math.random().toString(36).slice(2);
    const enc = new TextEncoder();
    const head = enc.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: audio/mpeg\r\n\r\n`,
    );
    const tail = enc.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + audioBuf.length + tail.length);
    body.set(head, 0);
    body.set(audioBuf, head.length);
    body.set(tail, head.length + audioBuf.length);

    const up = await gw(
      `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`,
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
      "GOOGLE_DRIVE_API_KEY",
    );
    const drive = (await up.json()) as { id: string; name: string; webViewLink?: string };
    return { ok: true, driveId: drive.id, name: drive.name, link: drive.webViewLink };
  });

// Silence unused import warning in some toolchains.
void DRIVE_BASE;
