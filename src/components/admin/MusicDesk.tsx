import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Music2, RefreshCw, Search, Unlock, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { maskDevIdentity } from "@/lib/dev-identity";
import { AdminEditableBalance, AdminEditableLabel } from "@/components/admin/AdminEditMode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface DeskSong {
  id: string;
  user_id: string;
  title: string | null;
  prompt: string;
  status: string;
  unlocked: boolean;
  error_message: string | null;
  created_at: string;
  email: string | null;
  display_name: string | null;
  coin_balance: number;
}

type Filter = "all" | "processing" | "failed" | "unlocked";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
  { value: "unlocked", label: "Unlocked" },
];

const isProcessing = (s: string) => s === "pending" || s === "processing";

async function invokeReprocess(id: string) {
  const { data, error } = await supabase.functions.invoke("admin-reprocess", {
    body: { song_id: id },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
}

/** Live feed of the latest 100 generations with filters, search, lock/unlock and retry. */
export function MusicDesk() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const songsQuery = useQuery({
    queryKey: ["admin-songs"],
    queryFn: async (): Promise<DeskSong[]> => {
      const { data: songs, error } = await supabase
        .from("songs")
        .select("id, user_id, title, prompt, status, unlocked, error_message, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const list = songs ?? [];
      const ids = Array.from(new Set(list.map((s) => s.user_id)));
      const map = new Map<
        string,
        { email: string | null; display_name: string | null; coin_balance: number }
      >();
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, email, display_name, coin_balance")
          .in("id", ids);
        for (const p of profs ?? []) {
          const m = maskDevIdentity({ email: p.email, display_name: p.display_name });
          map.set(p.id, {
            email: m.email,
            display_name: m.display_name,
            coin_balance: Number(p.coin_balance),
          });
        }
      }
      return list.map((s) => ({
        ...s,
        email: map.get(s.user_id)?.email ?? null,
        display_name: map.get(s.user_id)?.display_name ?? null,
        coin_balance: map.get(s.user_id)?.coin_balance ?? 0,
      }));
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("admin-songs-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "songs" }, () =>
        qc.invalidateQueries({ queryKey: ["admin-songs"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const toggleUnlock = useMutation({
    mutationFn: async ({ id, unlocked }: { id: string; unlocked: boolean }) => {
      const { error } = await supabase.from("songs").update({ unlocked }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-songs"] });
      toast.success("Song updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reprocess = useMutation({
    mutationFn: invokeReprocess,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-songs"] });
      toast.success("Reprocessing started");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const all = songsQuery.data ?? [];
  const failed = all.filter((s) => s.status === "failed");

  const retryAll = useMutation({
    mutationFn: async () => {
      let ok = 0;
      let bad = 0;
      for (const s of failed) {
        try {
          await invokeReprocess(s.id);
          ok++;
        } catch {
          bad++;
        }
      }
      return { ok, bad };
    },
    onSuccess: ({ ok, bad }) => {
      qc.invalidateQueries({ queryKey: ["admin-songs"] });
      if (bad) toast.warning(`Retried ${ok}, ${bad} couldn't restart`);
      else toast.success(`Retrying ${ok} failed track${ok === 1 ? "" : "s"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const counts: Record<Filter, number> = {
    all: all.length,
    processing: all.filter((s) => isProcessing(s.status)).length,
    failed: failed.length,
    unlocked: all.filter((s) => s.unlocked).length,
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((s) => {
      if (filter === "processing" && !isProcessing(s.status)) return false;
      if (filter === "failed" && s.status !== "failed") return false;
      if (filter === "unlocked" && !s.unlocked) return false;
      if (!q) return true;
      return [s.title, s.prompt, s.email, s.display_name].some((v) => v?.toLowerCase().includes(q));
    });
  }, [all, filter, search]);

  return (
    <div className="space-y-3">
      {failed.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3">
          <span className="text-sm font-semibold text-destructive">
            {failed.length} failed track{failed.length === 1 ? "" : "s"} need attention
          </span>
          <Button
            size="sm"
            variant="destructive"
            className="ml-auto"
            disabled={retryAll.isPending}
            onClick={() => retryAll.mutate()}
          >
            {retryAll.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="mr-1.5 h-3.5 w-3.5" />
            )}
            Retry all failed
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition",
                filter === f.value
                  ? "border-primary/50 bg-primary/20 text-primary"
                  : "border-border bg-card/60 text-muted-foreground hover:bg-card",
              )}
            >
              {f.label}
              <span className="tabular-nums opacity-70">{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <div className="relative sm:ml-auto sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, prompt or user"
            className="h-9 pl-8 text-sm"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
        {songsQuery.isLoading ? (
          <div className="grid place-items-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : visible.length === 0 ? (
          <div className="grid place-items-center gap-2 py-16 text-muted-foreground">
            <Music2 className="h-8 w-8" />
            <p className="text-sm">No tracks match.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{s.title || "Untitled"}</span>
                    <StatusPill status={s.status} />
                    {s.unlocked && (
                      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        <Unlock className="h-3 w-3" /> Unlocked
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{s.prompt}</div>
                  {s.status === "failed" && s.error_message && (
                    <div className="truncate text-xs text-destructive/80">{s.error_message}</div>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="truncate">{s.email ?? s.user_id.slice(0, 8)}</span>
                    <AdminEditableLabel
                      userId={s.user_id}
                      value={s.display_name}
                      fallback="No label"
                    />
                    <AdminEditableBalance userId={s.user_id} value={s.coin_balance} />
                    <span className="whitespace-nowrap">
                      {new Date(s.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant={s.unlocked ? "outline" : "default"}
                    disabled={toggleUnlock.isPending}
                    onClick={() => toggleUnlock.mutate({ id: s.id, unlocked: !s.unlocked })}
                  >
                    {s.unlocked ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <Unlock className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1.5">{s.unlocked ? "Lock" : "Unlock"}</span>
                  </Button>
                  {s.status === "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reprocess.isPending || retryAll.isPending}
                      onClick={() => reprocess.mutate(s.id)}
                    >
                      <RefreshCw
                        className={cn("h-3.5 w-3.5", reprocess.isPending && "animate-spin")}
                      />
                      <span className="ml-1.5">Retry</span>
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        status === "completed" && "bg-primary/15 text-primary",
        isProcessing(status) && "bg-muted text-muted-foreground",
        status === "failed" && "bg-destructive/15 text-destructive",
      )}
    >
      {status}
    </span>
  );
}
