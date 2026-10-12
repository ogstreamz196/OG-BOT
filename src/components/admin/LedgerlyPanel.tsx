import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BookOpenCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AdminSection } from "./AdminSection";
import { getLedgerlySettings, saveLedgerlySettings, testLedgerlyConnection } from "@/lib/ledgerly.functions";

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB") : "Never");

export function LedgerlyPanel() {
  const qc = useQueryClient();
  const get = useServerFn(getLedgerlySettings);
  const save = useServerFn(saveLedgerlySettings);
  const test = useServerFn(testLedgerlyConnection);
  const q = useQuery({ queryKey: ["ledgerly-settings"], queryFn: () => get() });
  const [enabled, setEnabled] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  useEffect(() => { if (q.data) setEnabled(q.data.enabled); }, [q.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["ledgerly-settings"] });

  const onSave = async (removeKey = false) => {
    setBusy(removeKey ? "remove" : "save");
    try {
      await save({ data: { enabled, apiKey: key || undefined, removeKey } });
      setKey("");
      toast.success(removeKey ? "Key removed" : "Ledgerly settings saved");
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(null); }
  };
  const onTest = async () => {
    setBusy("test");
    try {
      const r = await test();
      r.ok ? toast.success(r.message) : toast.error(r.message);
      refresh();
    } finally { setBusy(null); }
  };
  const d = q.data;
  const status = !d?.hasKey ? "Not configured" : d.lastError || d.lastTestOk === false ? "Error" : d.lastTestOk ? "Connected" : "Not configured";
  const badge = status === "Connected" ? "bg-primary/15 text-primary" : status === "Error" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground";

  return (
    <AdminSection
      icon={<BookOpenCheck className="h-5 w-5 text-primary" />}
      title="Ledgerly Integration"
      subtitle="Sends every paid live sale (and refunds) to Ledgerly automatically."
      action={<span className={`rounded-full px-2.5 py-1 text-xs font-bold ${badge}`}>{status}</span>}
    >
      {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
        <div className="space-y-4">
          <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            Create a key in Ledgerly → More → Connect sites, paste it here, then press Test Connection.
          </p>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">Ledgerly sync — turn on to send sales</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </label>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Ledgerly API Key {d?.hasKey && <>· saved {d.keyHint}{d.keyName && <> ({d.keyName})</>}</>}
            </label>
            <Input type="password" autoComplete="off" placeholder="lk_live_..." value={key}
              onChange={(e) => setKey(e.target.value)} />
          </div>
          <div className="grid gap-1 text-xs">
            <div><span className="text-muted-foreground">Last successful sync: </span>{fmt(d?.lastSyncAt ?? null)}</div>
            <div><span className="text-muted-foreground">Last test: </span>{fmt(d?.lastTestAt ?? null)}</div>
          </div>
          {d?.lastError && <p className="rounded-md border border-destructive/40 p-2 text-xs text-destructive">Last error: {d.lastError}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onSave(false)} disabled={!!busy}>
              {busy === "save" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Save Settings
            </Button>
            <Button size="sm" variant="outline" onClick={onTest} disabled={!!busy || !d?.hasKey}>
              {busy === "test" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Test Connection
            </Button>
            {d?.hasKey && (
              <Button size="sm" variant="ghost" onClick={() => onSave(true)} disabled={!!busy}>
                {busy === "remove" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Remove key
              </Button>
            )}
          </div>
        </div>
      )}
    </AdminSection>
  );
}
