import { createFileRoute } from "@tanstack/react-router";

// Streams a full song from the Boss's Google Drive, for a signed, expiring
// ticket (?t=, see src/lib/song-audio-link.ts). Range requests pass through
// so players can seek. If Drive can't serve it, the stored copy is used.
async function serve(request: Request, head: boolean) {
  const { readSongTicket } = await import("@/lib/song-audio-link");
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const ticket = secret ? await readSongTicket(secret, token) : null;
  if (!ticket) return new Response("Link expired", { status: 403 });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: song } = await (supabaseAdmin as any)
    .from("songs")
    .select("id, audio_path, drive_audio_id")
    .eq("id", ticket.s)
    .maybeSingle();
  if (!song) return new Response("Not found", { status: 404 });

  if (song.drive_audio_id) {
    const { connectorFetch, GATEWAY } = await import("@/lib/connectors.server");
    const range = request.headers.get("range");
    const res = await connectorFetch(
      `${GATEWAY}/google_drive/drive/v3/files/${encodeURIComponent(song.drive_audio_id)}?alt=media`,
      { method: head ? "HEAD" : "GET", headers: range ? { Range: range } : {} },
    ).catch(() => null);
    if (res && (res.ok || res.status === 206)) {
      const out = new Headers({
        "content-type": "audio/mpeg",
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=3600",
      });
      for (const h of ["content-length", "content-range", "etag", "last-modified"]) {
        const v = res.headers.get(h);
        if (v) out.set(h, v);
      }
      if (ticket.d) out.set("content-disposition", `attachment; filename="${ticket.d}"`);
      return new Response(head ? null : res.body, { status: res.status, headers: out });
    }
    console.warn(`[song-audio] Drive couldn't serve ${song.id}: ${res?.status ?? "no answer"}`);
  }

  // The stored copy, while it's still there.
  if (song.audio_path && !/^https?:\/\//.test(song.audio_path)) {
    const { data } = await supabaseAdmin.storage
      .from("song-files")
      .createSignedUrl(song.audio_path, 600, ticket.d ? { download: ticket.d } : undefined);
    if (data?.signedUrl) return Response.redirect(data.signedUrl, 302);
  }
  return new Response("Track unavailable", { status: 404 });
}

export const Route = createFileRoute("/api/public/song-audio")({
  server: {
    handlers: {
      GET: ({ request }) => serve(request, false),
      HEAD: ({ request }) => serve(request, true),
    },
  },
});
