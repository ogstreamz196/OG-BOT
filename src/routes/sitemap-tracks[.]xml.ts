import { createFileRoute } from "@tanstack/react-router";
import { SITE_URL } from "@/lib/seo";

const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Sitemap of shared track pages. Same rule as the share page itself:
// only completed, public, revealed tracks are listed, never private ones.
export const Route = createFileRoute("/sitemap-tracks.xml")({
  server: {
    handlers: {
      GET: async () => {
        let rows: { id: string; completed_at: string | null }[] = [];
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data } = await supabaseAdmin
            .from("songs")
            .select("id, completed_at")
            .eq("status", "completed")
            .eq("is_public", true)
            .neq("revealed", false)
            .not("audio_path", "is", null)
            .order("completed_at", { ascending: false })
            .limit(5000);
          rows = data ?? [];
        } catch (e) {
          // A valid empty sitemap beats an error page for crawlers.
          console.error("sitemap-tracks failed", e);
        }
        const urls = rows
          .map((s) => {
            const lastmod = s.completed_at
              ? `<lastmod>${String(s.completed_at).slice(0, 10)}</lastmod>`
              : "";
            return `  <url><loc>${esc(`${SITE_URL}/track/${s.id}`)}</loc>${lastmod}</url>`;
          })
          .join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
        return new Response(xml, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
