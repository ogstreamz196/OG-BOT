import type { ReactNode } from "react";
import {
  Coins,
  Package,
  Sparkles,
  Crown,
  Gem,
  ShoppingBag,
  Repeat,
  ExternalLink,
  Check,
  Loader2,
  Copy,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CoinPill } from "@/components/ui/coin-pill";
import type { StoreItem } from "@/lib/store.functions";
import { cn } from "@/lib/utils";
import sportsGuideLogo from "@/assets/og-bot-sports-guide.png.asset.json";

const RARITY: Record<
  StoreItem["rarity"],
  { label: string; ring: string; glow: string; icon: ReactNode }
> = {
  common: {
    label: "Common",
    ring: "border-slate-500/40",
    glow: "shadow-[0_0_24px_-8px_hsl(220_10%_60%/.4)]",
    icon: <Package className="h-3 w-3" />,
  },
  rare: {
    label: "Rare",
    ring: "border-cyan-400/50",
    glow: "shadow-[0_0_28px_-6px_hsl(190_90%_55%/.55)]",
    icon: <Sparkles className="h-3 w-3" />,
  },
  epic: {
    label: "Epic",
    ring: "border-fuchsia-400/60",
    glow: "shadow-[0_0_32px_-4px_hsl(290_90%_60%/.6)]",
    icon: <Gem className="h-3 w-3" />,
  },
  legendary: {
    label: "Legendary",
    ring: "border-amber-400/70",
    glow: "shadow-[0_0_36px_-2px_hsl(40_100%_55%/.7)]",
    icon: <Crown className="h-3 w-3" />,
  },
};

function trialDaysLeft(endsAt?: string | null) {
  if (!endsAt) return "Trial active";
  const days = Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000));
  return days === 1 ? "1 day left" : `${days} days left`;
}

function formatPrice(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function StoreItemCard({
  item,
  onBuy,
  onBuyCash,
  buying,
  sportsGuideState,
  sportsGuideInviteUrl,
  vipPass,
}: {
  item: StoreItem;
  onBuy: (id: string) => void;
  onBuyCash?: (id: string) => void;
  buying?: boolean;
  sportsGuideState?: "unowned" | "owned" | "invite_sent" | "joined" | "revoked";
  sportsGuideInviteUrl?: string;
  vipPass?: {
    owned: boolean;
    vipFree?: boolean;
    trial?: boolean;
    trialEndsAt?: string | null;
    username: string | null;
    password: string | null;
    available: number;
  };
}) {
  const r = RARITY[item.rarity];
  const stockRemaining = item.stock === null ? null : Math.max(0, item.stock - item.stock_sold);
  const stockSoldOut = stockRemaining !== null && stockRemaining === 0;
  const isSportsGuide = item.slug === "og-sports-guide-access";
  const ownsSportsGuide =
    isSportsGuide && sportsGuideState && !["unowned", "revoked"].includes(sportsGuideState);
  // Phone apps block insecure (http) images, so always load them over https.
  const imageUrl = isSportsGuide
    ? sportsGuideLogo.url
    : item.image_url?.replace(/^http:\/\//i, "https://");
  const isVipPass = item.slug === "og-vip-pass";
  const ownsVipPass = isVipPass && !!vipPass?.owned;
  const vaultKept = ownsVipPass && !vipPass?.trial;
  const vipSoldOut = isVipPass && !ownsVipPass && (vipPass?.available ?? 0) === 0;

  const soldOut = stockSoldOut || vipSoldOut;

  return (
    <div
      id={`item-${item.slug}`}
      className={cn(
        "group relative flex h-full min-w-0 scroll-mt-24 flex-col overflow-hidden rounded-lg border bg-store-card p-4 shadow-card transition-colors",
        r.ring,
        r.glow,
      )}
    >
      {/* rarity badge */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-muted-foreground">
          {r.icon}
          {r.label}
        </span>
        {item.recurring_interval && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-300">
            <Repeat className="h-3 w-3" /> /{item.recurring_interval}
          </span>
        )}
      </div>

      {/* image */}
      <div className="mb-3 aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-background/50">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={item.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-primary/60">
            <ShoppingBag className="h-16 w-16" />
          </div>
        )}
      </div>

      {/* name + desc */}
      <h3 className="line-clamp-2 font-display text-base font-black uppercase">{item.name}</h3>
      {item.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
      )}

      {/* meta pills */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {item.coin_reward ? <CoinPill size="sm">+{item.coin_reward} coins</CoinPill> : null}
        {item.perk_slug && !isSportsGuide && (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-primary">
            <Sparkles className="h-3 w-3" /> {item.perk_slug.replace("role:", "")}
          </span>
        )}
        {stockRemaining !== null && (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase",
              soldOut
                ? "bg-destructive/20 text-destructive"
                : stockRemaining <= 5
                  ? "bg-amber-500/20 text-amber-300"
                  : "bg-white/5 text-muted-foreground",
            )}
          >
            {soldOut ? "Sold out" : `${stockRemaining} left`}
          </span>
        )}
      </div>

      {/* footer */}
      <div className="mt-auto flex flex-col gap-3 pt-4 min-[400px]:grid min-[400px]:grid-cols-[minmax(0,1fr)_auto] min-[400px]:items-end">
        <div className="min-w-0 font-mono text-lg font-bold leading-tight text-foreground sm:text-xl">
          {isVipPass && vipPass?.trial ? (
            <>
              <span className="block text-coin">FREE trial 👑</span>
              <span className="block text-xs font-semibold text-muted-foreground">
                {trialDaysLeft(vipPass.trialEndsAt)} · then £10 or 50 OG Coins
              </span>
            </>
          ) : isVipPass && !ownsVipPass ? (
            <>
              {item.coin_price ?? 50} OG Coins
              <span className="block text-xs font-semibold text-muted-foreground">
                or {formatPrice(item.price_cents, item.currency)} by card
              </span>
            </>
          ) : item.coin_price !== null ? (
            `${item.coin_price} OG Coins`
          ) : (
            formatPrice(item.price_cents, item.currency)
          )}
        </div>
        <Button
          size="sm"
          onClick={() => {
            if (ownsSportsGuide) {
              window.location.assign("/sports");
              return;
            }
            onBuy(item.id);
          }}
          disabled={(soldOut && !ownsVipPass) || buying || vaultKept}
          className="w-full bg-gradient-brand font-bold uppercase tracking-wider min-[400px]:w-auto"
        >
          {buying ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : ownsSportsGuide ? (
            <ExternalLink className="mr-1 h-4 w-4" />
          ) : vaultKept ? (
            <Check className="mr-1 h-4 w-4" />
          ) : (
            <Coins className="mr-1 h-4 w-4" />
          )}
          {vaultKept
            ? "Unlocked"
            : soldOut
              ? "Sold out"
              : buying
                ? "…"
                : ownsSportsGuide
                  ? "Open Sports Guide"
                  : isVipPass
                    ? "50 coins"
                    : "Buy"}
        </Button>
        {onBuyCash && !vaultKept && !soldOut && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onBuyCash(item.id)}
            disabled={buying}
            className="w-full font-bold uppercase tracking-wider min-[400px]:col-span-2"
          >
            Pay {formatPrice(item.price_cents, item.currency)} by card
          </Button>
        )}
      </div>
      {ownsVipPass && vipPass?.username ? (
        <div className="mt-3 space-y-2 rounded-lg border border-primary/30 bg-primary/10 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-primary">
            <KeyRound className="h-3.5 w-3.5" /> Your VIP login
          </p>
          {(
            [
              ["Username", vipPass.username],
              ["Password", vipPass.password ?? ""],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-[11px] uppercase text-muted-foreground">
                {label}
              </span>
              <code className="min-w-0 flex-1 truncate rounded bg-background/70 px-2 py-1 font-mono text-xs">
                {value}
              </code>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Copy ${label.toLowerCase()}`}
                onClick={() => {
                  navigator.clipboard?.writeText(value).then(
                    () => toast.success(`${label} copied`),
                    () => toast.error("Couldn’t copy — select it manually"),
                  );
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      {isVipPass && !ownsVipPass ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {vipSoldOut
            ? "All passes are currently claimed — check back soon."
            : `${vipPass?.available ?? 0} passes left`}
        </p>
      ) : null}
      {ownsSportsGuide ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">
          <Check className="h-4 w-4" /> Access owned · link unlocked
        </div>
      ) : null}
    </div>
  );
}
