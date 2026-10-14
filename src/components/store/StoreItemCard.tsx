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
import sportsGuideArt from "@/assets/og-bot-sports-guide-badge.webp";

const RARITY: Record<StoreItem["rarity"], { label: string; icon: ReactNode }> = {
  common: {
    label: "Common",
    icon: <Package className="h-3 w-3" />,
  },
  rare: {
    label: "Rare",
    icon: <Sparkles className="h-3 w-3" />,
  },
  epic: {
    label: "Epic",
    icon: <Gem className="h-3 w-3" />,
  },
  legendary: {
    label: "Legendary",
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
    ? sportsGuideArt
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
        "og-store-panel group flex h-full min-w-0 scroll-mt-24 flex-col overflow-hidden p-4",
        isVipPass && "og-store-panel--vault",
        !isVipPass && item.rarity === "legendary" && "og-store-panel--gold",
        !isVipPass && item.rarity === "epic" && "og-store-panel--purple",
      )}
    >
      <span aria-hidden className="og-store-panel__corner og-store-panel__corner--tl" />
      <span aria-hidden className="og-store-panel__corner og-store-panel__corner--br" />
      {/* rarity badge */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="og-store__eyebrow inline-flex items-center gap-1 tracking-wider">
          {isVipPass ? <KeyRound className="h-3 w-3" /> : r.icon}
          {isVipPass ? "OG Vault access" : r.label}
        </span>
        {item.recurring_interval && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-[0.7rem] font-bold uppercase text-amber-300">
            <Repeat className="h-3 w-3" /> /{item.recurring_interval}
          </span>
        )}
      </div>

      {/* image */}
      <div className="mb-3 aspect-[16/10] w-full overflow-hidden rounded-xl border border-border bg-background/50">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={item.name}
            className={cn(
              "h-full w-full transition-transform duration-500 motion-safe:group-hover:scale-105",
              isSportsGuide ? "object-contain p-2" : "object-cover",
            )}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="grid h-full w-full place-items-center">
            {isVipPass ? (
              <KeyRound className="og-st-gold h-14 w-14" />
            ) : (
              <ShoppingBag className="og-st-blue h-14 w-14" />
            )}
          </div>
        )}
      </div>

      {/* name + desc */}
      <h3 className="og-store__title line-clamp-2 text-lg">{item.name}</h3>
      {item.description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
      )}

      {/* meta pills */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {item.coin_reward ? <CoinPill size="sm">+{item.coin_reward} coins</CoinPill> : null}
        {item.perk_slug && !isSportsGuide && (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[0.7rem] font-bold uppercase text-primary">
            <Sparkles className="h-3 w-3" /> {item.perk_slug.replace("role:", "")}
          </span>
        )}
        {stockRemaining !== null && (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-1.5 py-0.5 text-[0.7rem] font-bold uppercase",
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
              <span className="og-st-gold block">FREE trial</span>
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
        <button
          type="button"
          onClick={() => {
            if (ownsSportsGuide) {
              window.location.assign("/sports");
              return;
            }
            onBuy(item.id);
          }}
          disabled={(soldOut && !ownsVipPass) || buying || vaultKept}
          className={cn(
            "og-store-btn w-full min-[400px]:w-auto",
            (isVipPass || item.coin_price !== null) && !ownsSportsGuide && "og-store-btn--gold",
          )}
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
                    ? `${item.coin_price ?? 50} coins`
                    : isSportsGuide
                      ? "Unlock access"
                      : "Buy"}
        </button>
        {onBuyCash && !vaultKept && !soldOut && (
          <button
            type="button"
            onClick={() => onBuyCash(item.id)}
            disabled={buying}
            className="og-store-btn w-full min-[400px]:col-span-2"
          >
            Pay {formatPrice(item.price_cents, item.currency)} by card
          </button>
        )}
      </div>
      {ownsVipPass && vipPass?.username ? (
        <div className="mt-3 space-y-2 rounded-lg border border-primary/30 bg-primary/10 p-3">
          <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-primary">
            <KeyRound className="h-3.5 w-3.5" /> Your Vault login
          </p>
          <p className="text-xs font-semibold text-foreground">
            Important: sign out of the Vault first, then sign in with these details.
          </p>
          {(
            [
              ["Username", vipPass.username],
              ["Password", vipPass.password ?? ""],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-xs uppercase text-muted-foreground">{label}</span>
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
      {isVipPass && !ownsVipPass && vipSoldOut ? (
        <p className="og-st-muted mt-3 text-xs">
          All passes are currently claimed — check back soon.
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
