import { useMemo, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Send, Circle, Radio, ShieldAlert, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRole } from "@/hooks/use-role";
import { useOnlineUsers, type OnlineUser } from "@/hooks/use-presence";
import { maskDevIdentity } from "@/lib/dev-identity";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BossNav } from "@/components/admin/BossNav";
import { FreeAccessPanel } from "@/components/admin/FreeAccessPanel";

export const Route = createFileRoute("/_authenticated/developer")({
  component: DeveloperPage,
});

type OutboundLog = {
  id: string;
  target: string;
  content: string;
  at: string;
};

function DeveloperPage() {
  const { isDev, isLoading } = useRole();
  const { user } = useAuth();
  const online = useOnlineUsers();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [log, setLog] = useState<OutboundLog[]>([]);

  const others = useMemo(
    () => online.filter((u) => u.user_id !== user?.id).map(maskOnline),
    [online, user?.id],
  );
  const selected = others.find((u) => u.user_id === selectedId) ?? null;

  const send = useMutation({
    mutationFn: async (vars: { target: string; content: string; targetLabel: string }) => {
      const toastId = toast.loading(`Posting to ${vars.targetLabel}'s OG Bot…`);
      try {
        const { data, error } = await supabase.rpc("dev_send_og_message_as_bot", {
          target_user_id: vars.target,
          message_content: vars.content,
        });
        if (error) throw error;
        toast.success(`Delivered to ${vars.targetLabel}'s OG Bot history`, { id: toastId });
        return data;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Send failed", { id: toastId });
        throw e;
      }
    },
    onSuccess: (_, vars) => {
      setLog((prev) => [
        {
          id: crypto.randomUUID(),
          target: vars.target,
          content: vars.content,
          at: new Date().toISOString(),
        },
        ...prev,
      ]);
      setDraft("");
    },
  });

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading…</div>;
  if (!isDev) {
    throw redirect({ to: "/" });
  }

  return (
    <div className="px-4 py-6 md:px-8">
      <BossNav />
      <FreeAccessPanel />
      <header className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Radio className="h-6 w-6 shrink-0 text-primary" />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold sm:text-2xl">Live users</h1>
            <p className="truncate text-xs text-muted-foreground sm:text-sm">
              Realtime presence — speak through OG Bot in their widget.
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-[320px,1fr]">
        <aside className="glass-panel rounded-2xl border border-border p-3">
          <div className="mb-2 flex items-center justify-between px-1 text-xs uppercase tracking-wider text-muted-foreground">
            <span>Online now</span>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-primary">
              {others.length}
            </span>
          </div>
          {others.length === 0 ? (
            <div className="px-2 py-6 text-sm text-muted-foreground">No other users connected.</div>
          ) : (
            <ul className="space-y-1">
              {others.map((u) => {
                const label = u.display_name || u.email || u.user_id.slice(0, 8);
                return (
                  <li key={u.user_id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedId(u.user_id)}
                      className={cn(
                        "flex flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left transition hover:bg-card",
                        selectedId === u.user_id && "bg-card ring-1 ring-primary/40",
                      )}
                    >
                      <Circle className="h-2.5 w-2.5 fill-emerald-400 text-emerald-400" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{label}</div>
                        <div className="truncate text-[11px] text-muted-foreground">{u.email}</div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="glass-panel flex min-h-[420px] flex-col rounded-2xl border border-border p-4">
          {!selected ? (
            <div className="m-auto flex flex-col items-center gap-2 text-muted-foreground">
              <ShieldAlert className="h-6 w-6" />
              <p>Select an online user to speak as OG Bot.</p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2 border-b border-border pb-3">
                <Circle className="h-2.5 w-2.5 fill-emerald-400 text-emerald-400" />
                <div className="min-w-0">
                  <div className="truncate font-semibold">
                    {selected.display_name || selected.email}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    Posting into their OG Bot chat as the bot
                  </div>
                </div>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                {log.filter((l) => l.target === selected.user_id).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No messages sent yet.</p>
                ) : (
                  log
                    .filter((l) => l.target === selected.user_id)
                    .map((l) => (
                      <div
                        key={l.id}
                        className="ml-auto max-w-[80%] rounded-2xl rounded-tr-md bg-primary/15 px-3 py-2 text-sm"
                      >
                        <div className="whitespace-pre-wrap">{l.content}</div>
                        <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                          {new Date(l.at).toLocaleTimeString()}
                        </div>
                      </div>
                    ))
                )}
              </div>

              <form
                className="mt-3 flex items-end gap-2 border-t border-border pt-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = draft.trim();
                  if (!text) return;
                  send.mutate({
                    target: selected.user_id,
                    content: text,
                    targetLabel:
                      selected.display_name || selected.email || selected.user_id.slice(0, 8),
                  });
                }}
              >
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Type as OG Bot…"
                  rows={2}
                  className="resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      const text = draft.trim();
                      if (text) {
                        send.mutate({
                          target: selected.user_id,
                          content: text,
                          targetLabel:
                            selected.display_name || selected.email || selected.user_id.slice(0, 8),
                        });
                      }
                    }
                  }}
                />
                <Button type="submit" disabled={!draft.trim() || send.isPending}>
                  {send.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function maskOnline(u: OnlineUser): OnlineUser {
  const masked = maskDevIdentity({
    email: u.email ?? undefined,
    display_name: u.display_name ?? undefined,
  });
  return {
    ...u,
    email: masked?.email ?? u.email,
    display_name: masked?.display_name ?? u.display_name,
  };
}
