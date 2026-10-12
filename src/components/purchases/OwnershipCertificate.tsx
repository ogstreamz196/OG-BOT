import { Coins, Crown, Printer, ShieldCheck, X } from "lucide-react";
import { useProfile } from "@/hooks/use-profile";
import type { PurchaseRow } from "@/lib/payments.functions";

const SUPPORT_EMAIL = "ogbot196@gmail.com";

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function serialFor(row: PurchaseRow) {
  return `OG-${new Date(row.created_at).getFullYear()}-${row.id.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

export function OwnershipCertificate({ row, onClose }: { row: PurchaseRow; onClose: () => void }) {
  const { data: profile } = useProfile();
  const issued = new Date(row.created_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const time = new Date(row.created_at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const holder = profile?.display_name || "OG Member";
  const refunded = row.stripe?.refunded;

  return (
    <div
      className="og-cert-overlay fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-background/85 p-3 backdrop-blur-md sm:items-center sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Certificate of ownership"
    >
      <div className="w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
        <div className="og-cert-actions mb-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-black uppercase tracking-[0.14em] text-primary-foreground hover:bg-primary/90"
          >
            <Printer className="h-4 w-4" /> Save / Print
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <article className="og-certificate relative overflow-hidden rounded-3xl border-2 border-coin/60 bg-card p-1.5 shadow-glow">
          <div className="relative rounded-[1.25rem] border border-coin/30 bg-gradient-to-b from-primary/15 via-card to-card px-5 py-7 sm:px-9 sm:py-10">
            {/* Watermark */}
            <Crown
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 text-coin/[0.06]"
            />

            <header className="relative text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.4em] text-coin">
                OGSTREAMZ · OG BOT
              </p>
              <h2 className="font-display mt-3 text-2xl font-black uppercase leading-tight tracking-[0.04em] text-foreground sm:text-3xl">
                Certificate of Ownership
              </h2>
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                Official purchase receipt
              </p>
              <div className="mx-auto mt-4 h-px w-40 bg-gradient-to-r from-transparent via-coin to-transparent" />
            </header>

            <section className="relative mt-6 text-center">
              <p className="text-sm text-muted-foreground">This certifies that</p>
              <p className="font-display mt-1 break-words text-3xl font-black text-primary sm:text-4xl">
                {holder}
              </p>
              {profile?.og_vip_id ? (
                <p className="mt-1 inline-flex items-center gap-1 font-mono text-xs font-black tracking-widest text-coin">
                  <Crown className="h-3.5 w-3.5" /> {profile.og_vip_id}
                </p>
              ) : null}
              <p className="mt-3 text-sm text-muted-foreground">is the rightful owner of</p>
              <p className="mt-2 inline-flex items-center gap-2 text-4xl font-black tabular-nums text-foreground">
                {row.amount} <Coins className="h-8 w-8 text-coin" />
              </p>
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-coin">OG Coins</p>
            </section>

            <dl className="relative mt-7 grid grid-cols-2 gap-3 text-left text-xs">
              {[
                ["Certificate no.", serialFor(row)],
                ["Issued", `${issued} · ${time}`],
                [
                  "Amount paid",
                  row.stripe ? money(row.stripe.amountPaid, row.stripe.currency) : "—",
                ],
                ["Status", refunded ? "Refunded — void" : "Paid · Valid"],
                ["Account", profile?.email ?? "—"],
                ["Payment", "Card · secured by Stripe"],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="min-w-0 rounded-xl border border-border bg-background/60 p-3"
                >
                  <dt className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground">
                    {k}
                  </dt>
                  <dd className="mt-1 break-words font-semibold text-foreground">{v}</dd>
                </div>
              ))}
            </dl>

            <footer className="relative mt-7 flex items-end justify-between gap-4">
              <div className="min-w-0 text-[10px] leading-relaxed text-muted-foreground">
                <p>
                  OG Coins are a non-transferable licence for use inside OG BOT. Coins already used
                  cannot be refunded.
                </p>
                <p className="mt-1">
                  Questions:{" "}
                  <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-primary">
                    {SUPPORT_EMAIL}
                  </a>
                </p>
              </div>
              <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full border-2 border-coin bg-coin/10 text-center text-coin">
                <div>
                  <ShieldCheck className="mx-auto h-6 w-6" />
                  <p className="text-[8px] font-black uppercase tracking-widest">OG Verified</p>
                </div>
              </div>
            </footer>
          </div>
        </article>
      </div>
    </div>
  );
}
