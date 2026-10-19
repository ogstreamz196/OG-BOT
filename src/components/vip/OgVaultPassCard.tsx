import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Copy, Eye, EyeOff, Loader2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getVipPassStatus } from "@/lib/vip-pass.functions";

const MASK = "••••••••";

async function copy(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Couldn't copy. Long-press to copy instead.");
  }
}

/** The member's OG Vault login. The server picks the current 2-hour credential. */
export function OgVaultPassCard() {
  const statusFn = useServerFn(getVipPassStatus);
  const [revealed, setRevealed] = useState(false);
  const status = useQuery({
    queryKey: ["vip-pass-status"],
    queryFn: () => statusFn(),
    staleTime: 60_000,
    // The login rotates every 2 hours, so keep the shown one current.
    refetchInterval: revealed ? 5 * 60_000 : false,
  });

  if (status.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking your Vault pass…
      </div>
    );
  }
  if (status.isError || !status.data) return null;
  const { owned, username, password } = status.data;

  if (!owned) {
    return (
      <div className="rounded-2xl border border-border bg-card/60 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted-foreground">
          🔐 OG Vault Access Pass · Locked 🔒
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Get lifetime access to the private OG App Store and exclusive tools.
        </p>
        <Button asChild variant="outline" className="mt-3 w-full gap-2 font-bold">
          <Link to="/store">
            <ShoppingCart className="h-4 w-4" /> Get Vault Pass · £10 or 50 Coins
          </Link>
        </Button>
      </div>
    );
  }

  const ready = !!username && !!password;
  return (
    <div className="rounded-2xl border border-zinc-300/40 border-l-4 border-l-zinc-300 bg-gradient-to-br from-zinc-400/[0.18] via-card/70 to-card/60 p-4 shadow-glow backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-coin">
          🔐 OG Vault Access Pass
        </p>
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[0.7rem] font-bold text-emerald-300">
          Active & Verified ✅
        </span>
      </div>

      {!ready ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Your Vault login is being refreshed. Check back in a few minutes.
        </p>
      ) : (
        <>
          <div className="mt-3 space-y-2">
            <Credential
              label="Vault ID"
              value={revealed ? username.toUpperCase() : MASK}
              onCopy={revealed ? () => copy(username, "Vault ID") : undefined}
            />
            <Credential
              label="Vault PIN"
              value={revealed ? password : MASK}
              onCopy={revealed ? () => copy(password, "Vault PIN") : undefined}
            />
          </div>
          {revealed && (
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              <p>Sign out of the Vault first, then sign in with these credentials.</p>
              <p>⏳ Rotates automatically every 2 hours for security.</p>
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            className="mt-3 w-full gap-2 font-bold"
            onClick={() => {
              if (!revealed) void status.refetch();
              setRevealed((v) => !v);
            }}
          >
            {revealed ? (
              <>
                <EyeOff className="h-4 w-4" /> 🙈 Hide details
              </>
            ) : (
              <>
                <Eye className="h-4 w-4" /> 👁️ Reveal Vault Pass details
              </>
            )}
          </Button>
        </>
      )}
    </div>
  );
}

function Credential({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/40 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-base font-bold tracking-wider">{value}</p>
      </div>
      {onCopy && (
        <Button type="button" size="sm" variant="outline" onClick={onCopy} className="shrink-0">
          <Copy className="mr-1 h-4 w-4" /> Copy
        </Button>
      )}
    </div>
  );
}
