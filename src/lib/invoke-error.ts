/** Extract a human-readable message from a Supabase functions.invoke() failure. */
export function invokeError(err: unknown, fallback: string): string {
  if (!err) return fallback;
  if (typeof err === "object") {
    const e = err as { context?: { error?: string }; message?: string };
    return e.context?.error || e.message || fallback;
  }
  return fallback;
}

type ResponseLike = { clone?: () => { json: () => Promise<unknown> } };

/**
 * Same as invokeError, but reads the edge function's JSON error body.
 * supabase-js puts the raw Response on `error.context`, so the sync version
 * only ever saw "Edge Function returned a non-2xx status code".
 */
export async function readInvokeError(err: unknown, fallback: string): Promise<string> {
  const ctx = (err as { context?: ResponseLike } | null)?.context;
  if (ctx && typeof ctx.clone === "function") {
    try {
      const body = (await ctx.clone().json()) as { error?: unknown; message?: unknown } | null;
      const msg = body?.error ?? body?.message;
      if (typeof msg === "string" && msg.trim()) return msg;
    } catch {
      /* not JSON — fall through */
    }
  }
  const sync = invokeError(err, fallback);
  return /non-2xx status code/i.test(sync) ? fallback : sync;
}

/** The edge function's machine-readable `code` (e.g. "min_balance"), if any. */
export async function readInvokeErrorCode(err: unknown): Promise<string | null> {
  const ctx = (err as { context?: ResponseLike } | null)?.context;
  if (!ctx || typeof ctx.clone !== "function") return null;
  try {
    const body = (await ctx.clone().json()) as { code?: unknown } | null;
    return typeof body?.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}
