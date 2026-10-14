import { forwardRef, type ReactNode, type KeyboardEvent, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Coins, Crown, Flag, Loader2, Send, Trophy } from "lucide-react";
import { TypingDots } from "@/components/ui/typing-dots";
import ogBotLogo from "@/assets/og-bot-master-logo.webp";
import "@/components/battle/battle-arena.css";

/**
 * Shared "OG BOT Battle Chat" presentation for the guest and member Battle
 * Zone. These parts only draw things; every action, query and realtime
 * channel stays in GuestBattle / CommunityRoom.
 */

export function ArenaFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`og-arena ${className ?? ""}`}>{children}</div>;
}

export function ArenaHeader({
  subtitle,
  thinking,
  purse,
  earned,
  streakDays,
  ranksOpen,
  onToggleRanks,
  onBank,
  bankPending,
  menu,
  className,
  compact,
}: {
  /** Compact: no title line, for pages that already show their own header. */
  compact?: boolean;
  subtitle: string;
  thinking: boolean;
  purse: string;
  earned?: number | null;
  streakDays?: number;
  ranksOpen: boolean;
  onToggleRanks: () => void;
  onBank: () => void;
  bankPending?: boolean;
  menu?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`ar-header ${className ?? ""}`}>
      <span className="ar-avatar" data-thinking={thinking ? "true" : "false"}>
        <img src={ogBotLogo} alt="OG Bot" width={80} height={80} decoding="async" />
      </span>
      <div className="min-w-0">
        {compact ? null : <p className="ar-title truncate">OG BOT Battle Zone</p>}
        <p className="ar-silver mt-1 flex min-w-0 items-center gap-1.5 text-[0.7rem] font-bold">
          <span className="ar-live-dot shrink-0" aria-hidden />
          <span className="truncate">{thinking ? "OG Bot is cooking a comeback…" : subtitle}</span>
        </p>
      </div>
      <div className="col-span-2 flex items-center justify-between gap-1 sm:col-span-1 sm:justify-end sm:gap-2">
        <span className="ar-chip" aria-live="polite" title="Battle purse">
          <Coins className="ar-gold h-3.5 w-3.5" aria-hidden />
          {purse}
          {earned ? <span className="ar-pop">+{(earned / 10).toFixed(2)}</span> : null}
          {(streakDays ?? 0) > 1 ? (
            <span className="ar-gold" title={`${streakDays}-day streak`}>
              🔥{streakDays}
            </span>
          ) : null}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="ar-icon-btn flex gap-1"
            aria-expanded={ranksOpen}
            aria-label="Ranks"
            onClick={onToggleRanks}
          >
            <Trophy className="h-3.5 w-3.5" aria-hidden />
            <span>Ranks</span>
          </button>
          <button
            type="button"
            className="ar-icon-btn ar-icon-btn--bank gap-1"
            aria-label="Bank coins"
            disabled={bankPending}
            onClick={onBank}
          >
            {bankPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Flag className="h-3.5 w-3.5" aria-hidden />
            )}
            <span>Bank</span>
          </button>
          {menu}
        </div>
      </div>
    </header>
  );
}

export function ArenaRanks({
  loading,
  rows,
}: {
  loading: boolean;
  rows: { userId: string; name: string; coinsWon: number; isMe?: boolean }[];
}) {
  return (
    <div className="ar-panel">
      <p className="ar-silver mb-1 text-[0.7rem] font-black uppercase tracking-wider">
        Most savage roasters
      </p>
      {loading ? (
        <p className="ar-silver py-1 text-xs">Counting the bodies…</p>
      ) : rows.length === 0 ? (
        <p className="ar-silver py-1 text-xs">Nobody has banked a win yet. Be the first.</p>
      ) : (
        <ol className="space-y-0.5">
          {rows.slice(0, 10).map((row, i) => (
            <li
              key={row.userId}
              className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs ${row.isMe ? "ar-white font-black" : "ar-silver"}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 tabular-nums">{i + 1}</span>
                <span className="truncate">
                  {row.name}
                  {row.isMe ? " (you)" : ""}
                </span>
              </span>
              <span className="ar-gold shrink-0 font-black tabular-nums">{row.coinsWon} OG</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ArenaRoastOfDay({ name, content }: { name: string; content: string }) {
  return (
    <div className="ar-panel ar-panel--roast flex items-start gap-2">
      <span aria-hidden className="text-sm leading-none">
        👑
      </span>
      <div className="min-w-0">
        <p className="ar-gold text-[0.7rem] font-black uppercase tracking-wider">
          Roast of the day — {name}
        </p>
        <p className="ar-white line-clamp-2 text-xs">{content}</p>
      </div>
    </div>
  );
}

function initials(name: string | null | undefined) {
  if (!name) return "OG";
  return (
    name
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "OG"
  );
}

export function ArenaMessage({
  kind,
  mine,
  name,
  time,
  content,
  vip,
  vipId,
  scoreTenths,
  onVipClick,
  menu,
}: {
  kind: "user" | "bot";
  mine: boolean;
  name: string;
  time: string;
  content: string;
  vip?: boolean;
  vipId?: string | null;
  scoreTenths?: number | null;
  onVipClick?: () => void;
  menu?: ReactNode;
}) {
  const isBot = kind === "bot";
  const shownName = vip && vipId ? vipId : name;
  return (
    <div className={`ar-row ${mine ? "ar-row--mine" : ""}`}>
      <span className={`ar-face ${isBot ? "ar-face--bot" : vip ? "ar-face--vip" : ""}`}>
        {isBot ? <img src={ogBotLogo} alt="OG Bot" width={40} height={40} /> : initials(shownName)}
      </span>
      <div
        className={`ar-bubble ${isBot ? "ar-bubble--bot" : "ar-bubble--user"} ${vip && !isBot ? "ar-bubble--vip" : ""}`}
      >
        <p className="ar-meta">
          {vip && !isBot ? (
            onVipClick ? (
              <button
                type="button"
                className="ar-name-vip"
                onClick={onVipClick}
                aria-label={`${shownName}, OG VIP member`}
              >
                <Crown className="h-3 w-3" aria-hidden />
                {shownName}
              </button>
            ) : (
              <span className="ar-name-vip">
                <Crown className="h-3 w-3" aria-hidden />
                {shownName}
              </span>
            )
          ) : (
            <span className={isBot ? "ar-red" : mine ? "ar-white" : undefined}>{shownName}</span>
          )}
          {time ? <span aria-hidden>·</span> : null}
          {time ? <span>{time}</span> : null}
        </p>
        <div className="ar-text">{content}</div>
        {isBot && scoreTenths && scoreTenths > 0 ? (
          <span className="ar-score" title="Coins that roast earned">
            🔥 Roast scored · +{(scoreTenths / 10).toFixed(2)} OG
          </span>
        ) : null}
      </div>
      {menu}
    </div>
  );
}

export function ArenaEmpty({ loading }: { loading?: boolean }) {
  return (
    <div className="ar-empty">
      <img src={ogBotLogo} alt="" aria-hidden width={320} height={254} />
      {loading ? (
        <p className="ar-silver flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the Battle Zone…
        </p>
      ) : (
        <>
          <h3>😈 Think you can handle OG Bot?</h3>
          <p>Drop your first roast. Let's see if you can take the heat or bank some OG Coins.</p>
        </>
      )}
    </div>
  );
}

export function ArenaTyping({ label }: { label: string }) {
  return (
    <div className="ar-silver flex items-center gap-2 px-3 pb-1 text-xs">
      <TypingDots size="sm" aria-label={label} />
      <span className="truncate">{label}</span>
    </div>
  );
}

export const ArenaComposer = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (v: string) => void;
    onSubmit: (e: FormEvent) => void;
    pending: boolean;
    disabled?: boolean;
    maxLength: number;
    placeholder?: string;
  }
>(function ArenaComposer(
  {
    value,
    onChange,
    onSubmit,
    pending,
    disabled,
    maxLength,
    placeholder = "Fire your next shot at OG Bot...",
  },
  ref,
) {
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Desktop: Enter sends, Shift+Enter newline. Touch: Enter is a newline; tap Send.
    const isTouch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !isTouch) {
      e.preventDefault();
      onSubmit(e as unknown as FormEvent);
    }
  };
  return (
    <form onSubmit={onSubmit} className="ar-console" style={{ touchAction: "manipulation" }}>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="Your roast"
        rows={2}
        maxLength={maxLength}
        enterKeyHint="send"
        disabled={disabled}
      />
      <button
        type="submit"
        className="ar-send"
        disabled={!value.trim() || pending || disabled}
        aria-label="Send message"
      >
        {pending ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        ) : (
          <Send className="h-5 w-5" aria-hidden />
        )}
      </button>
    </form>
  );
});

export function ArenaVipPromo({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="OG VIP"
      className="og-arena-vars fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="ar-vip-sheet w-full max-w-sm p-5 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <Crown className="ar-gold mx-auto h-9 w-9" aria-hidden />
        <h3 className="ar-white mt-2 font-display text-xl uppercase">Go OG VIP</h3>
        <p className="ar-silver mt-1 text-sm">The gold crown is for OG VIP members.</p>
        <ul className="ar-white mt-3 space-y-1.5 text-left text-sm">
          <li>👑 Your own gold OG VIP ID in the Battle Zone</li>
          <li>💸 13% lifetime cashback when your referrals spend coins</li>
          <li>🤬 Foul-mouth OG Bot, unfiltered</li>
        </ul>
        <div className="mt-4 grid gap-2">
          <Link to="/store" hash="section-vip" className="ar-vip-cta" onClick={onClose}>
            See OG VIP · from £4.99
          </Link>
          <button type="button" onClick={onClose} className="ar-silver h-9 text-xs font-bold">
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
