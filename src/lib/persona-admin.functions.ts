/**
 * Boss/admin-only server functions for managing OG Bot's persona templates
 * and the global foul-mouth lexicon.
 *
 * Everything in this file runs server-side. Sensitive prompt content
 * (persona prose, lexicon phrases) is never persisted in any client-visible
 * cache, never echoed back inside error messages, and never reachable from
 * `anon` or ordinary `authenticated` callers — the underlying SQL functions
 * gate on `has_role('admin' | 'boss')`.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Ctx = {
  supabase: {
    rpc: (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    from: (t: string) => {
      select: (cols: string) => {
        like: (
          col: string,
          pat: string,
        ) => {
          order: (col: string) => Promise<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
  };
  userId: string;
};

/** Strip provider/SQL detail so leaks never reach the client. */
function safeError(_e: unknown): never {
  throw new Error("Request failed");
}

async function assertBoss(ctx: Ctx) {
  const adminCheck = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  const bossCheck = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "boss",
  });
  if (adminCheck.error || bossCheck.error) safeError(adminCheck.error ?? bossCheck.error);
  if (!adminCheck.data && !bossCheck.data) throw new Error("Forbidden");
}

/* ── PERSONA TEMPLATES (stored in site_content under og_persona.*) ────── */

export const adminListPersonaTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    await assertBoss(ctx);
    const { data, error } = await ctx.supabase
      .from("site_content")
      .select("key,value,updated_at")
      .like("key", "og_persona.%")
      .order("key");
    if (error) safeError(error);
    return { items: (data as Array<{ key: string; value: string; updated_at: string }>) ?? [] };
  });

export const adminSetPersonaTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { key: string; value: string }) => {
    if (!d?.key || typeof d.key !== "string" || !d.key.startsWith("og_persona.")) {
      throw new Error("invalid_key");
    }
    if (typeof d.value !== "string" || d.value.length > 5000) {
      throw new Error("invalid_value");
    }
    return { key: d.key, value: d.value };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertBoss(ctx);
    const { error } = await ctx.supabase.rpc("set_site_content", {
      p_key: data.key,
      p_value: data.value,
    });
    if (error) safeError(error);
    return { ok: true as const };
  });

/* ── FOUL-MOUTH LEXICON (private og_lexicon table) ────────────────────── */

export const adminListLexicon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    await assertBoss(ctx);
    const { data, error } = await ctx.supabase.rpc("admin_list_lexicon");
    if (error) safeError(error);
    type Row = {
      id: string;
      phrase: string;
      severity: number;
      enabled: boolean;
      notes: string | null;
      updated_at: string;
    };
    return { items: (data as Row[] | null) ?? [] };
  });

export const adminUpsertLexiconPhrase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (d: { phrase: string; severity?: number; enabled?: boolean; notes?: string | null }) => {
      const phrase = String(d?.phrase ?? "").trim();
      if (phrase.length < 2 || phrase.length > 60) throw new Error("invalid_phrase");
      const severity = Math.max(1, Math.min(5, Number(d?.severity ?? 1)));
      return {
        phrase,
        severity,
        enabled: d?.enabled !== false,
        notes: d?.notes ? String(d.notes).slice(0, 500) : null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertBoss(ctx);
    const { data: id, error } = await ctx.supabase.rpc("admin_upsert_lexicon_phrase", {
      p_phrase: data.phrase,
      p_severity: data.severity,
      p_enabled: data.enabled,
      p_notes: data.notes,
    });
    if (error) safeError(error);
    return { id: id as string };
  });

export const adminDeleteLexiconPhrase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { phrase: string }) => {
    const phrase = String(d?.phrase ?? "").trim();
    if (!phrase) throw new Error("invalid_phrase");
    return { phrase };
  })
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    await assertBoss(ctx);
    const { data: ok, error } = await ctx.supabase.rpc("admin_delete_lexicon_phrase", {
      p_phrase: data.phrase,
    });
    if (error) safeError(error);
    return { deleted: Boolean(ok) };
  });

/* ── Persona defaults (server-only text, admin/boss gated) ───────────────── */

export const adminGetPersonaDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as Ctx;
    await assertBoss(ctx);
    const { PERSONA_DEFAULTS } = await import("@/lib/og-persona.server");
    return {
      script: PERSONA_DEFAULTS.script,
      voice: PERSONA_DEFAULTS.voice,
      dictionary: PERSONA_DEFAULTS.dictionary,
    };
  });
