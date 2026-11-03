import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Loader2, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { addAiKeyFn, listAiKeysFn, testAiKeyFn, updateAiKeyFn } from "@/lib/ai-keys.functions";
import { cn } from "@/lib/utils";
import { AdminSection } from "./AdminSection";

const PROVIDERS = [
  { value: "pollinations", label: "Pollinations (free)" },
  { value: "openrouter", label: "OpenRouter (free models)" },
  { value: "gemini", label: "Gemini (free tier)" },
] as const;
type Provider = (typeof PROVIDERS)[number]["value"];
const NAME = Object.fromEntries(PROVIDERS.map((p) => [p.value, p.label])) as Record<
  Provider,
  string
>;

/**
 * Boss → System → API keys: extra free AI keys, as many as you like. They're
 * kept encrypted in the OGSTREAMZ hub, not on Lovable, and the bot tries them
 * before the keys it already had. A key is never shown again once added.
 */
export function ExtraAiKeysPanel() {
  const qc = useQueryClient();
  const list = useServerFn(listAiKeysFn);
  const add = useServerFn(addAiKeyFn);
  const update = useServerFn(updateAiKeyFn);
  const test = useServerFn(testAiKeyFn);
  const keys = useQuery({ queryKey: ["extra-ai-keys"], queryFn: () => list() });
  const [provider, setProvider] = useState<Provider>("pollinations");
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [testing, setTesting] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["extra-ai-keys"] });

  const adding = useMutation({
    mutationFn: () => add({ data: { provider, key, label: label || null } }),
    onSuccess: () => {
      setKey("");
      setLabel("");
      toast.success(`${NAME[provider]} key added. The bot uses it within a minute.`);
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't add the key"),
  });
  const changing = useMutation({
    mutationFn: (v: { id: string; action: "on" | "off" | "remove" }) => update({ data: v }),
    onSuccess: refresh,
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't change the key"),
  });
  const runTest = async (id: string) => {
    setTesting(id);
    try {
      const r = await test({ data: { id } });
      r.status.startsWith("Working") ? toast.success(r.status) : toast.error(r.status);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(null);
    }
  };

  const problem = keys.data?.problem ?? null;
  const rows = keys.data?.rows ?? [];

  return (
    <AdminSection
      icon={<KeyRound className="h-4 w-4 text-emerald-400" />}
      title="API vault"
      subtitle="Your extra free AI keys. Add as many Pollinations, OpenRouter and Gemini keys as you like. They're stored encrypted in your own OGSTREAMZ database, not on Lovable, and the bot tries them first. When none are added or they're all used up, it falls back to the keys it already has. A key is never shown again after you add it. This vault moves into OG KEYS, your own password and key manager, when it's built."
    >
      {keys.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : problem === "not_connected" ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          Not connected yet. Add the OGSTREAMZ secret key as <b>OG_HUB_SERVICE_KEY</b> in Lovable's
          secrets, then come back. Until then the bot keeps using its current keys.
        </p>
      ) : (
        <div className="space-y-4">
          {problem && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              {problem}
            </p>
          )}

          <form
            className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,10rem)_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              if (key.trim()) adding.mutate();
            }}
          >
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              className="h-10 rounded-md border border-border bg-background px-2 text-sm"
              aria-label="Provider"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <Input
              type="password"
              autoComplete="off"
              placeholder="Paste the key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              aria-label="API key"
            />
            <Input
              placeholder="Name (optional)"
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
              aria-label="Name"
            />
            <Button type="submit" disabled={!key.trim() || adding.isPending} className="gap-2">
              {adding.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add key
            </Button>
          </form>

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No extra keys yet, so the bot is using its current ones.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {NAME[r.provider as Provider] ?? r.provider}
                      {r.label ? ` · ${r.label}` : ""}{" "}
                      <span className="font-mono text-xs text-muted-foreground">{r.key_hint}</span>
                    </p>
                    <p
                      className={cn(
                        "text-xs",
                        r.last_status?.startsWith("Working")
                          ? "text-emerald-400"
                          : r.last_status
                            ? "text-rose-400"
                            : "text-muted-foreground",
                      )}
                    >
                      {r.last_status ?? "Not tested yet"}
                      {r.last_checked_at
                        ? ` · ${new Date(r.last_checked_at).toLocaleString("en-GB")}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    disabled={testing === r.id}
                    onClick={() => runTest(r.id)}
                  >
                    {testing === r.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )}
                    Test
                  </Button>
                  <Switch
                    checked={r.enabled}
                    disabled={changing.isPending}
                    onCheckedChange={(on) =>
                      changing.mutate({ id: r.id, action: on ? "on" : "off" })
                    }
                    aria-label="Use this key"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove key"
                    disabled={changing.isPending}
                    onClick={() => {
                      if (
                        window.confirm("Remove this key? You'd need to paste it again to use it.")
                      )
                        changing.mutate({ id: r.id, action: "remove" });
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-rose-400" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </AdminSection>
  );
}
