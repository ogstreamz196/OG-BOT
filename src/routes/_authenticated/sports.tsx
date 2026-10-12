import { createFileRoute, Link } from "@tanstack/react-router";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, Lock, RefreshCw, Search, SlidersHorizontal, Tv, X } from "lucide-react";
import { dedupe, parseListing, searchListing, type Fixture, type Listing } from "@/lib/sports-listing";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import sportsGuideLogo from "@/assets/og-bot-sports-guide.png.asset.json";
import { getSportsGuideHub, syncSportsGuide, type SportsGuidePost } from "@/lib/sports-guide.functions";
import { purchaseSportsGuideAccess } from "@/lib/store.functions";

export const Route = createFileRoute("/_authenticated/sports")({
  head: () => ({
    meta: [
      { title: "Sports Guide · OG BOT" },
      { name: "description", content: "Live daily fixtures, fight cards and TV listings — search any team instantly." },
      { property: "og:title", content: "Sports Guide · OG BOT" },
      { property: "og:description", content: "Live daily fixtures, fight cards and TV listings from OG Sports Guide." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SportsGuidePage,
});

const KEY = ["sports-guide-hub"];

function SportsGuidePage() {
  const qc = useQueryClient();
  const fetchHub = useServerFn(getSportsGuideHub);
  const buy = useServerFn(purchaseSportsGuideAccess);
  const hub = useQuery({
    queryKey: KEY,
    queryFn: () => fetchHub(),
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 60_000,
  });
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);
  const owned = !!hub.data?.owned;

  // Always listening: new, edited and deleted posts sync instantly.
  useEffect(() => {
    if (!owned) return;
    const ch = supabase
      .channel(`sports-guide-live-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sports_guide_posts" }, (payload) => {
        qc.setQueryData(KEY, (old: typeof hub.data) => {
          if (!old) return old;
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id?: string })?.id;
            return { ...old, posts: old.posts.filter((p) => p.id !== id) };
          }
          const row = payload.new as SportsGuidePost;
          if (!row?.id) return old;
          const rest = old.posts.filter((p) => p.id !== row.id);
          return { ...old, posts: [row, ...rest].sort((a, b) => b.posted_at.localeCompare(a.posted_at)) };
        });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") qc.invalidateQueries({ queryKey: KEY });
      });
    return () => {
      supabase.removeChannel(ch);
    };
  }, [owned, qc]);

  const unlock = useMutation({
    mutationFn: () => buy(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["sports-guide-access"] });
      toast.success("Sports Guide unlocked 🏆");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runSync = useServerFn(syncSportsGuide);
  const sync = useMutation({
    mutationFn: () => runSync(),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: KEY });
      toast.success(r.removed > 0 ? `Synced — removed ${r.removed} deleted post${r.removed === 1 ? "" : "s"}` : "Synced — everything up to date");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const words = useMemo(() => dq.toLowerCase().split(/\s+/).filter(Boolean), [dq]);
  const listings = useMemo(() => dedupe(hub.data?.posts ?? []).map(parseListing), [hub.data?.posts]);
  const results = useMemo(
    () => listings.map((l) => searchListing(l, words)).filter((l): l is Listing => !!l),
    [listings, words],
  );
  const matchCount = results.reduce((n, l) => n + (l.fixtures.length || 1), 0);
  const fixtureTotal = listings.reduce((n, l) => n + l.fixtures.length, 0);
  const [showTeams, setShowTeams] = useState(false);
  const teams = useMemo(() => {
    const c = new Map<string, number>();
    for (const l of listings)
      for (const f of l.fixtures) {
        const t = splitTeams(f.event);
        if (!t) continue;
        for (const name of [t.home, t.away]) {
          const k = name.replace(/\s*\(.*?\)\s*/g, "").trim();
          if (k.length > 1 && k.length < 40) c.set(k, (c.get(k) ?? 0) + 1);
        }
      }
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 120);
  }, [listings]);

  if (hub.isLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!owned) {
    const price = hub.data?.coinPrice;
    const balance = hub.data?.balance ?? 0;
    const short = price != null && balance < price;
    return (
      <div className="mx-auto max-w-xl space-y-5 px-4 pb-24 pt-4">
        <div className="overflow-hidden rounded-3xl border-2 border-primary/40 bg-card shadow-glow">
          <div className="relative">
            <img src={sportsGuideLogo.url} alt="OG Sports Guide" className="aspect-[4/3] w-full object-cover" />
            <div className="absolute inset-0 grid place-items-center bg-background/55 backdrop-blur-[2px]">
              <div className="grid h-16 w-16 place-items-center rounded-full border-2 border-primary bg-background/80">
                <Lock className="h-8 w-8 text-primary" />
              </div>
            </div>
          </div>
          <div className="space-y-4 p-5">
            <h1 className="font-display text-2xl font-black uppercase">OG Sports Guide</h1>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>⚽ Every daily fixture, fight card & race — updated live</li>
              <li>🔎 Type any team or fighter and find their event instantly</li>
              <li>⭐ Pin your teams so they're always at the top</li>
              <li>🔔 Telegram kick-off reminders from OG Bot</li>
            </ul>
            <div className="flex items-center justify-between rounded-xl border border-border bg-background/60 px-4 py-3 text-sm">
              <span className="text-muted-foreground">Your balance: {balance} coins</span>
              <span className="font-mono text-lg font-black text-coin">
                {price != null ? `${price} OG Coins` : "—"}
              </span>
            </div>
            {short ? (
              <Button asChild className="w-full bg-gradient-brand font-bold uppercase">
                <Link to="/buy-coins">Top up coins to unlock</Link>
              </Button>
            ) : (
              <Button
                className="w-full bg-gradient-brand font-bold uppercase"
                disabled={unlock.isPending || price == null}
                onClick={() => unlock.mutate()}
              >
                {unlock.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                Unlock Sports Guide
              </Button>
            )}
            <p className="text-center text-[11px] text-muted-foreground">One-time unlock · yours to keep</p>
            <Link
              to="/buy-coins"
              className="block rounded-xl border border-coin/40 bg-coin/10 px-4 py-3 text-center text-xs font-bold text-coin"
            >
              👑 Free for VIP members — including the 15-day free trial. Go VIP →
            </Link>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className="mx-auto max-w-2xl px-3 pb-24 pt-3 sm:px-4">
      <header className="relative overflow-hidden rounded-3xl border-2 border-pitch/60 bg-card shadow-glow">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, color-mix(in oklab, var(--pitch) 38%, transparent) 0 40px, color-mix(in oklab, var(--pitch) 24%, transparent) 40px 80px)",
          }}
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/50 to-background/90" />
        <div className="relative flex items-center gap-3 p-4 sm:gap-4 sm:p-5">
          <img src={sportsGuideLogo.url} alt="" className="h-16 w-16 shrink-0 rounded-2xl border-2 border-coin object-cover shadow-lg sm:h-20 sm:w-20" />
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-destructive-foreground shadow">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive-foreground" /> Live
            </span>
            <h1 className="mt-1 truncate font-display text-3xl font-black uppercase italic leading-none tracking-tight drop-shadow sm:text-4xl">
              Match <span className="text-coin">Centre</span>
            </h1>
            <p className="mt-1 truncate text-xs font-semibold text-foreground/85">
              {fixtureTotal} fixtures · {listings.length} guides
            </p>
          </div>
        </div>

        <div className="relative px-3 pb-4 sm:px-4">
          <div className="flex items-stretch gap-2">
            <div className="min-w-0 flex-1 rounded-2xl bg-gradient-to-r from-coin via-pitch to-coin p-[2px] shadow-glow">
              <div className="relative rounded-[calc(1rem-2px)] bg-card">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-coin" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search teams…"
                  className="h-16 rounded-[calc(1rem-2px)] border-0 bg-transparent pl-12 pr-11 text-lg font-black placeholder:text-sm placeholder:font-semibold placeholder:text-muted-foreground focus-visible:ring-0 sm:text-xl"
                  inputMode="search"
                  autoComplete="off"
                />
                {q && (
                  <button
                    aria-label="Clear search"
                    onClick={() => setQ("")}
                    className="absolute right-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-coin text-coin-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <button
              aria-label="Filter by team"
              aria-expanded={showTeams}
              onClick={() => setShowTeams((v) => !v)}
              className={`grid w-16 shrink-0 place-items-center rounded-2xl border-2 transition-colors ${showTeams ? "border-coin bg-coin text-coin-foreground" : "border-pitch/70 bg-card text-coin"}`}
            >
              <SlidersHorizontal className="h-6 w-6" />
            </button>
            <button
              aria-label="Sync now"
              title="Sync with Telegram now"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
              className="grid w-16 shrink-0 place-items-center rounded-2xl border-2 border-pitch/70 bg-card text-coin transition-colors hover:border-coin disabled:opacity-60"
            >
              <RefreshCw className={`h-6 w-6 ${sync.isPending ? "animate-spin" : ""}`} />
            </button>
          </div>
          {showTeams && (
            <div className="mt-3 max-h-64 overflow-y-auto rounded-2xl border border-border bg-background/90 p-2">
              {teams.length === 0 ? (
                <p className="p-3 text-center text-sm text-muted-foreground">No teams found yet.</p>
              ) : (
                <div className="grid grid-cols-2 gap-1.5">
                  {teams.map(([t, n]) => (
                    <button
                      key={t}
                      onClick={() => {
                        setQ(t);
                        setShowTeams(false);
                      }}
                      className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-card px-3 py-2 text-left text-sm font-bold hover:bg-coin hover:text-coin-foreground"
                    >
                      <span className="truncate">{t}</span>
                      <span className="shrink-0 text-[10px] font-black text-muted-foreground">{n}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {words.length > 0 && (
            <p className="mt-3 px-1 text-sm font-black uppercase tracking-wider text-coin">
              {matchCount} {matchCount === 1 ? "match" : "matches"} for “{dq.trim()}”
            </p>
          )}
        </div>
      </header>

      <section className="mt-4 space-y-3">
        {results.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border py-14 text-center">
            <div className="text-4xl">🏟️</div>
            <p className="mt-2 font-display text-lg font-black uppercase">
              {listings.length ? "No fixtures found" : "Waiting for kick-off"}
            </p>
            <p className="text-sm text-muted-foreground">
              {listings.length ? "Try another team, league or channel." : "New listings appear here the moment they're posted."}
            </p>
            {q && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setQ("")}>
                Clear search
              </Button>
            )}
          </div>
        ) : (
          results.map((l) => <ListingCard key={l.id} listing={l} terms={words} />)
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-r border-border/60 py-2">
      <div className="font-display text-lg font-black text-foreground">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const esc = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!esc.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${esc.join("|")})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded bg-coin/30 px-0.5 text-foreground">{part}</mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

const fmtTime = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const fmtDay = (d: Date) => {
  const key = (x: Date) => x.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const today = key(new Date());
  const tom = key(new Date(Date.now() + 86_400_000));
  const k = key(d);
  if (k === today) return "Today";
  if (k === tom) return "Tomorrow";
  return d.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
};

function splitTeams(event: string) {
  const m = event.match(/^(?:(.+?)\s*[:|]\s*)?(.+?)\s+(?:vs\.?|v|@)\s+(.+)$/i);
  return m ? { tag: m[1], home: m[2], away: m[3], sep: /@/.test(event) ? "@" : "VS" } : null;
}

function FixtureRow({ f, terms }: { f: Fixture; terms: string[] }) {
  const teams = splitTeams(f.event);
  const live = f.at && Date.now() >= f.at.getTime() && Date.now() - f.at.getTime() < 2 * 3600_000;
  return (
    <li className="flex items-stretch gap-3 px-3 py-2.5">
      <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-background/60 py-1 text-center">
        {f.at ? (
          <>
            <span className="font-mono text-sm font-black text-coin">{fmtTime(f.at)}</span>
            <span className={live ? "text-[9px] font-black uppercase text-destructive" : "text-[9px] font-bold uppercase text-muted-foreground"}>
              {live ? "● Live" : fmtDay(f.at)}
            </span>
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground">TBC</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {teams ? (
          <>
            {teams.tag && (
              <div className="truncate text-[10px] font-bold uppercase tracking-wider text-primary">
                <Highlight text={teams.tag} terms={terms} />
              </div>
            )}
            <div className="text-sm font-bold leading-snug">
              <Highlight text={teams.home} terms={terms} />
              <span className="mx-1.5 text-[10px] font-black text-muted-foreground">{teams.sep}</span>
              <Highlight text={teams.away} terms={terms} />
            </div>
          </>
        ) : (
          <div className="text-sm font-bold leading-snug">
            <Highlight text={f.event} terms={terms} />
          </div>
        )}
        <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-coin/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-coin">
          <Tv className="h-3 w-3" /> <Highlight text={f.channel} terms={terms} />
        </div>
      </div>
    </li>
  );
}

function ListingCard({ listing: l, terms }: { listing: Listing; terms: string[] }) {
  const [open, setOpen] = useState(false);
  const limit = terms.length ? 50 : 6;
  const shown = open ? l.fixtures : l.fixtures.slice(0, limit);
  const text = [l.title && `${l.title}${l.date ? ` ${l.date}` : ""}`, ...l.fixtures.map((f) => f.raw), ...l.notes]
    .filter(Boolean)
    .join("\n");
  return (
    <article className="overflow-hidden rounded-3xl border-2 border-pitch/30 bg-card shadow-card">
      <div className="flex items-center gap-2 border-b-2 border-pitch/50 bg-gradient-to-r from-pitch/40 via-pitch/15 to-transparent px-4 py-2.5">
        <Tv className="h-4 w-4 text-coin" />
        <h2 className="min-w-0 flex-1 truncate font-display text-base font-black uppercase tracking-wide">
          {l.title ? <Highlight text={l.title} terms={terms} /> : "OG Sports Guide"}
        </h2>
        <span className="shrink-0 text-[10px] font-bold uppercase text-muted-foreground">
          {l.fixtures.length ? `${l.fixtures.length} ${l.fixtures.length === 1 ? "fixture" : "fixtures"}` : fmtDay(new Date(l.postedAt))}
        </span>
      </div>
      {shown.length > 0 && (
        <ul className="divide-y divide-border/60">
          {shown.map((f, i) => (
            <FixtureRow key={i} f={f} terms={terms} />
          ))}
        </ul>
      )}
      {l.fixtures.length > shown.length && (
        <button onClick={() => setOpen(true)} className="w-full border-t border-border py-2 text-xs font-black uppercase tracking-wider text-coin">
          Show all {l.fixtures.length} fixtures
        </button>
      )}
      {l.notes.length > 0 && (
        <p className="whitespace-pre-wrap break-words px-4 py-3 text-sm leading-relaxed">
          <Highlight text={l.notes.join("\n")} terms={terms} />
        </p>
      )}
      <div className="flex gap-2 border-t border-border/60 px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs"
          onClick={() => {
            navigator.clipboard?.writeText(text);
            toast.success("Copied");
          }}
        >
          <Copy className="mr-1 h-3.5 w-3.5" /> Copy
        </Button>
      </div>
    </article>
  );
}
