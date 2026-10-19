import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runTransferReadiness, type ReadinessItem } from "@/lib/transfer-readiness.functions";

const CHECKLIST = [
  "Code backup downloaded or GitHub synced",
  "Backend data export requested",
  "Database snapshot numbers noted",
  "API & Integrations → Ping all is green",
  "Custom domains (ogbot.co.uk) still connected after move",
  "Telegram connector reconnected in new workspace",
  "Google Drive / Sheets connectors reconnected",
  "Telegram webhook re-tested",
  "Stripe live payment tested with small amount",
  "Android app opens and signs in",
  "Test song created end-to-end",
  "Battle Zone roast works",
  "Vault API self-ping OK",
  "Ledgerly ping OK",
];
const STORE = "og.transferChecklist.v1";

const Icon = ({ s }: { s: ReadinessItem["status"] }) =>
  s === "ok" ? (
    <CheckCircle2 className="h-4 w-4 text-primary" />
  ) : s === "warn" ? (
    <AlertTriangle className="h-4 w-4 text-accent" />
  ) : (
    <XCircle className="h-4 w-4 text-destructive" />
  );

export function TransferReadiness() {
  const run = useServerFn(runTransferReadiness);
  const [items, setItems] = useState<ReadinessItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      setDone(JSON.parse(localStorage.getItem(STORE) || "{}"));
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = (k: string) => {
    const next = { ...done, [k]: !done[k] };
    setDone(next);
    localStorage.setItem(STORE, JSON.stringify(next));
  };

  const check = async () => {
    setBusy(true);
    setErr(null);
    try {
      setItems((await run()).items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Check failed");
    } finally {
      setBusy(false);
    }
  };

  const ticked = CHECKLIST.filter((c) => done[c]).length;
  const sections = items ? [...new Set(items.map((i) => i.section))] : [];

  return (
    <div className="space-y-6">
      <section className="og-panel rounded-2xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-black">Transfer readiness</h2>
            <p className="text-xs text-muted-foreground">
              Free checks only — no AI or music credits used. Key pings stay in API & Integrations.
            </p>
          </div>
          <Button onClick={check} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Run checks
          </Button>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        {sections.map((s) => (
          <div key={s} className="mt-3">
            <h3 className="mb-1 text-xs font-bold uppercase text-muted-foreground">{s}</h3>
            {items!
              .filter((i) => i.section === s)
              .map((i) => (
                <div key={i.key} className="flex gap-2 border-b border-border/50 py-2 text-sm">
                  <Icon s={i.status} />
                  <div className="min-w-0">
                    <div className="font-semibold">{i.label}</div>
                    <div className="text-xs text-muted-foreground break-words">{i.detail}</div>
                    {i.fix && <div className="text-xs text-foreground/80">→ {i.fix}</div>}
                  </div>
                </div>
              ))}
          </div>
        ))}
      </section>

      <section className="og-panel rounded-2xl border border-border bg-card p-4">
        <h2 className="font-display text-lg font-black">
          Move checklist ({ticked}/{CHECKLIST.length})
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">Tick before and after moving workspace.</p>
        {CHECKLIST.map((c) => (
          <label key={c} className="flex cursor-pointer items-center gap-2 py-1.5 text-sm">
            <input type="checkbox" checked={!!done[c]} onChange={() => toggle(c)} className="h-4 w-4" />
            <span className={done[c] ? "text-muted-foreground line-through" : ""}>{c}</span>
          </label>
        ))}
      </section>
    </div>
  );
}
