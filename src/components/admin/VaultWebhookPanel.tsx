import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, KeyRound, Loader2, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AdminSection } from "./AdminSection";
import {
  addVaultCredential,
  deleteVaultCredential,
  getVaultWebhookSettings,
  listVaultCredentials,
  resyncVaultWebhook,
  saveVaultWebhookSettings,
  setVaultCredentialActive,
  testVaultWebhook,
} from "@/lib/vault.functions";
import { buildVaultReceiverPrompt } from "@/lib/vault-prompt";

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB") : "Never");
const copy = (text: string, label: string) =>
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied`),
    () => toast.error("Couldn't copy — long-press to select instead"),
  );
const hookToast = (h?: { ok: boolean; message: string }) => {
  if (h && !h.ok && h.message !== "Webhook is switched off" && !h.message.startsWith("Add a target"))
    toast.warning(`Saved, but your other app wasn't told: ${h.message}`);
};

export function VaultWebhookPanel() {
  const qc = useQueryClient();
  const getSettings = useServerFn(getVaultWebhookSettings);
  const saveSettings = useServerFn(saveVaultWebhookSettings);
  const test = useServerFn(testVaultWebhook);
  const resync = useServerFn(resyncVaultWebhook);
  const list = useServerFn(listVaultCredentials);
  const add = useServerFn(addVaultCredential);
  const setActive = useServerFn(setVaultCredentialActive);
  const del = useServerFn(deleteVaultCredential);

  const s = useQuery({ queryKey: ["vault-webhook"], queryFn: () => getSettings() });
  const creds = useQuery({ queryKey: ["vault-creds"], queryFn: () => list() });
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ username: "", password: "", note: "" });
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (s.data) { setEnabled(s.data.enabled); setUrl(s.data.targetUrl); }
  }, [s.data]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["vault-webhook"] });
    qc.invalidateQueries({ queryKey: ["vault-creds"] });
  };
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(null); refresh(); }
  };

  const [showKey, setShowKey] = useState(false);
  const prompt = useMemo(() => buildVaultReceiverPrompt(origin || "https://ogbot.co.uk"), [origin]);
  const d = s.data;
  const status = d?.lastTestOk ? "Connected" : "Waiting for other app";
  const badge = status === "Connected" ? "bg-primary/15 text-primary"  : "bg-muted text-muted-foreground";

  return (
    <div className="space-y-4">
      <AdminSection
        icon={<KeyRound className="h-5 w-5 text-primary" />}
        title="OG Vault logins"
        subtitle="Logins shown to Vault pass owners. Adding, switching off or removing one tells your other app straight away."
      >
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Input placeholder="Username / ID" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <Input placeholder="PIN / password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <Input placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <Button size="sm" disabled={!!busy || !form.username || !form.password}
              onClick={() => run("add", async () => {
                const r = await add({ data: form });
                toast.success("Login added");
                hookToast(r.hook);
                setForm({ username: "", password: "", note: "" });
              })}>
              {busy === "add" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Add login
            </Button>
          </div>
          {creds.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {(creds.data ?? []).length === 0 && <li className="p-3 text-xs text-muted-foreground">No logins yet.</li>}
              {(creds.data ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 p-2.5 text-sm">
                  <span className="min-w-0 flex-1 break-all font-mono">
                    {c.username} · {c.password}
                    {c.note && <span className="ml-2 text-xs text-muted-foreground">{c.note}</span>}
                  </span>
                  <Switch checked={c.active} disabled={!!busy}
                    onCheckedChange={(v) => run(`a-${c.id}`, async () => hookToast((await setActive({ data: { id: c.id, active: v } })).hook))} />
                  <Button size="icon" variant="ghost" aria-label={`Remove ${c.username}`} disabled={!!busy}
                    onClick={() => run(`d-${c.id}`, async () => { hookToast((await del({ data: { id: c.id } })).hook); toast.success("Login removed"); })}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </AdminSection>

      <AdminSection
        icon={<Webhook className="h-5 w-5 text-primary" />}
        title="OG Vault API"
        subtitle="Your other app connects here with this key — same as Ledgerly. No address to type."
        action={<span className={`rounded-full px-2.5 py-1 text-xs font-bold ${badge}`}>{status}</span>}
      >
        {s.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
          <div className="space-y-4">
            {d?.secret && (
              <div className="space-y-1.5 rounded-md border border-primary/40 bg-primary/5 p-3">
                <p className="text-sm font-bold">Your OG Vault API key</p>
                <div className="flex gap-2">
                  <Input readOnly type={showKey ? "text" : "password"} value={d.secret} className="font-mono text-xs" />
                  <Button size="sm" variant="ghost" onClick={() => setShowKey((v) => !v)}>{showKey ? "Hide" : "Show"}</Button>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => copy(d.secret, "API key")}>
                    <Copy className="h-4 w-4" />Copy
                  </Button>
                </div>
              </div>
            )}
            <div className="text-xs"><span className="text-muted-foreground">Last connection from your other app: </span>{fmt(d?.lastTestAt ?? null)}</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={!!busy || !d?.secret} onClick={() => run("ping", async () => {
                const r = await fetch(`${origin}/api/public/v1/vault/ping`, { headers: { Authorization: `Bearer ${d!.secret}` } });
                const j = await r.json().catch(() => ({}));
                r.ok ? toast.success(`API working · ${j.active_credentials ?? 0} active logins`) : toast.error(j.error ?? `Ping failed (${r.status})`);
              })}>
                {busy === "ping" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Ping test
              </Button>
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("regen", async () => { await saveSettings({ data: { enabled: false, targetUrl: "", regenerateSecret: true } }); toast.success("New key made — paste it into your other app"); })}>
                New key
              </Button>
            </div>

            <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold">Prompt for your other Lovable project</p>
                <Button size="sm" className="gap-1.5" onClick={() => copy(prompt, "Prompt")}>
                  <Copy className="h-4 w-4" />Copy prompt
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                1. Copy prompt and paste it into your other project. 2. Copy the API key above and paste it into its new OG Vault card (Boss Controls → VIP users). 3. Press Test Connection there — this card turns Connected.
              </p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 text-[11px] leading-relaxed">{prompt}</pre>
            </div>
          </div>
        )}
      </AdminSection>
    </div>
  );
}
