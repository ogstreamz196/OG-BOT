import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Loader2, Plug, RefreshCw, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  connectTradeBotWebhook,
  listTelegramGroups,
  pingTelegramGroup,
  setGroupWorker,
  syncTelegramGroup,
  type GroupRow,
} from "@/lib/telegram-groups.functions";
import { AdminSection } from "./AdminSection";

const KEY = ["telegram-managed-groups"];

/**
 * Boss → OG Bot → Telegram: the groups OG B0T (the Gaffer) runs, whether it's
 * in each one, and which worker bots are switched on there.
 */
export function TelegramGroupsPanel() {
  const listFn = useServerFn(listTelegramGroups);
  const syncFn = useServerFn(syncTelegramGroup);
  const pingFn = useServerFn(pingTelegramGroup);
  const workerFn = useServerFn(setGroupWorker);
  const connectFn = useServerFn(connectTradeBotWebhook);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: () => listFn(), staleTime: 15_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [newId, setNewId] = useState("");

  async function run(key: string, job: () => Promise<void>) {
    setBusy(key);
    try {
      await job();
    } catch (e) {
      toast.error((e as Error).message || "That didn't work");
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: KEY });
    }
  }

  const sync = (chatId: string) =>
    run(`sync:${chatId}`, async () => {
      const r = await syncFn({ data: { chatId } });
      if (!r.found) toast.error(`OG B0T can't see that chat: ${r.problem}`);
      else
        toast.success(
          `${r.title ?? chatId}: OG B0T ${r.gafferPresent ? "is in" : "isn't in"}, ` +
            `Trade Bot ${r.tradeBot === "in" ? "is in" : r.tradeBot === "not_in" ? "isn't in" : "isn't set up"}`,
        );
    });

  const ping = (chatId: string) =>
    run(`ping:${chatId}`, async () => {
      const r = await pingFn({ data: { chatId } });
      const trade =
        r.tradeBot === "sent"
          ? "Trade Bot pinged too"
          : r.tradeBot === "not_allowed"
            ? "Trade Bot stayed quiet (OG B0T not in, or switched off)"
            : r.tradeBot === "failed"
              ? "Trade Bot couldn't post (is it in the group?)"
              : "Trade Bot isn't set up";
      if (r.gaffer === "sent") toast.success(`OG B0T pinged. ${trade}.`);
      else toast.error(`OG B0T couldn't post: ${r.gafferProblem ?? "unknown"}. ${trade}.`);
    });

  const toggle = (g: GroupRow, on: boolean) =>
    run(`worker:${g.chatId}`, async () => {
      await workerFn({ data: { chatId: g.chatId, worker: "trade", on } });
      toast.success(`Trade Bot ${on ? "on" : "off"} in ${g.title ?? g.chatId}`);
    });

  const connect = () =>
    run("connect", async () => {
      const r = await connectFn();
      toast.success(`Trade Bot connected${r.botUsername ? ` (${r.botUsername})` : ""}`);
    });

  const data = q.data;
  return (
    <AdminSection
      icon={<Users className="h-5 w-5 text-primary" />}
      title="Telegram Groups & Worker Fleet"
      subtitle="OG B0T is the Gaffer. Worker bots (first: the OG Trade Bot) only work in a group while OG B0T is in it, and only where you switch them on."
    >
      <ol className="mb-4 space-y-1 rounded-xl border border-border/60 p-3 text-sm text-muted-foreground">
        <li>
          <span className="font-semibold text-foreground">Step 1:</span> add OG B0T to the group
          (only you can). Turn its Group Privacy off in BotFather so it hears everyone.
        </li>
        <li>
          <span className="font-semibold text-foreground">Step 2:</span> add the worker bots (the OG
          Trade Bot). Added before OG B0T, a worker says so and leaves.
        </li>
        <li>
          <span className="font-semibold text-foreground">Step 3:</span> tap Sync, then Test Ping.
        </li>
      </ol>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={connect}
          disabled={busy === "connect" || data?.tradeBotConfigured === false}
        >
          {busy === "connect" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plug className="mr-2 h-4 w-4" />
          )}
          Connect Trade Bot webhook
        </Button>
        {data?.tradeBotConfigured === false && (
          <span className="text-xs text-amber-400">Add the SIGNALS_BOT_TOKEN secret first.</span>
        )}
      </div>

      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const id = newId.trim();
          if (id) void sync(id).then(() => setNewId(""));
        }}
      >
        <Input
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          placeholder="Add a group by chat ID, e.g. -1001234567890"
          className="max-w-xs"
          inputMode="numeric"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!newId.trim() || !!busy}>
          Add & sync
        </Button>
      </form>

      {q.isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading groups…</p>
      ) : data && !data.ready ? (
        <p className="text-sm text-amber-400">
          The group register isn't set up yet (migration 20261027010000_telegram_managed_groups).
        </p>
      ) : !data?.groups.length ? (
        <p className="text-sm text-muted-foreground">
          No groups yet. Add OG B0T to a group and it shows up here.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {data.groups.map((g) => (
            <li key={g.chatId} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground">{g.title ?? "Untitled"}</p>
                <p className="text-xs text-muted-foreground">
                  {g.chatId} · {g.type}
                </p>
                <p
                  className={g.gafferPresent ? "text-sm text-emerald-400" : "text-sm text-rose-400"}
                >
                  {g.gafferPresent ? "🟢 OG B0T connected" : "🔴 OG B0T not present"}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <Bot className="h-4 w-4 text-muted-foreground" />
                Trade Bot
                <Switch
                  checked={g.workers.includes("trade")}
                  onCheckedChange={(on) => void toggle(g, on)}
                  disabled={busy === `worker:${g.chatId}`}
                  aria-label={`Trade Bot in ${g.title ?? g.chatId}`}
                />
              </label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void sync(g.chatId)}
                  disabled={busy === `sync:${g.chatId}`}
                >
                  {busy === `sync:${g.chatId}` ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 h-4 w-4" />
                  )}
                  Sync
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void ping(g.chatId)}
                  disabled={busy === `ping:${g.chatId}`}
                >
                  {busy === `ping:${g.chatId}` ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-1 h-4 w-4" />
                  )}
                  Test Ping
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminSection>
  );
}
