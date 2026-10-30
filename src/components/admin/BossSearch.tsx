import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, Loader2, Search, SlidersHorizontal, User, X } from "lucide-react";
import { useBossMembers } from "@/hooks/use-boss-members";
import { memberMatches, searchSettings, type BossSetting } from "@/lib/boss-search";
import type { BossMember } from "@/lib/admin-members.functions";
import { cn } from "@/lib/utils";

const MEMBER_LIMIT = 5;

type Hit =
  | { kind: "setting"; key: string; setting: BossSetting }
  | { kind: "member"; key: string; member: BossMember }
  | { kind: "all-members"; key: string; count: number };

/**
 * One box in the Boss header that finds any Boss setting (opening the exact
 * tab) or any member (opening their page). Members load the first time the
 * box is used, from the same cache as the Members list.
 */
export function BossSearch({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [used, setUsed] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const membersQ = useBossMembers(used);

  const query = q.trim();
  const hits = useMemo<Hit[]>(() => {
    if (!query) return [];
    const settings: Hit[] = searchSettings(query).map((s) => ({
      kind: "setting",
      key: `s:${s.where}:${s.title}`,
      setting: s,
    }));
    const matched = (membersQ.data ?? []).filter((m) => memberMatches(m, query));
    const members: Hit[] = matched
      .slice(0, MEMBER_LIMIT)
      .map((m) => ({ kind: "member", key: `m:${m.id}`, member: m }));
    if (matched.length > MEMBER_LIMIT) {
      members.push({ kind: "all-members", key: "m:all", count: matched.length });
    }
    return [...settings, ...members];
  }, [query, membersQ.data]);

  useEffect(() => setActive(0), [query]);

  // Close when tapping anywhere outside the box.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function go(hit: Hit) {
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    if (hit.kind === "member") {
      void navigate({ to: "/admin/users/$userId", params: { userId: hit.member.id } });
    } else if (hit.kind === "all-members") {
      void navigate({ to: "/admin/users", search: { q: query } });
    } else {
      const s = hit.setting;
      if (s.to === "/settings") void navigate({ to: "/settings", hash: s.hash });
      else if (s.to === "/admin/users") void navigate({ to: "/admin/users", search: {} });
      else if (s.to === "/admin") void navigate({ to: "/admin" });
      else void navigate({ to: s.to, search: s.tab ? { tab: s.tab } : {} });
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    } else if (e.key === "ArrowDown" && hits.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === "ArrowUp" && hits.length) {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  }

  const settingHits = hits.filter((h) => h.kind === "setting");
  const memberHits = hits.filter((h) => h.kind !== "setting");
  const loadingMembers = used && membersQ.isLoading;

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setUsed(true);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search settings or members…"
        aria-label="Search Boss settings and members"
        aria-expanded={open && !!query}
        aria-controls="boss-search-results"
        role="combobox"
        autoComplete="off"
        className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-8 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary [&::-webkit-search-cancel-button]:hidden"
      />
      {q && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && query && (
        <div
          id="boss-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-xl sm:left-auto sm:w-96"
        >
          {settingHits.length > 0 && <GroupLabel>Settings</GroupLabel>}
          {settingHits.map((h) => (
            <Row key={h.key} hit={h} active={hits[active] === h} onPick={go} />
          ))}
          {(memberHits.length > 0 || loadingMembers) && <GroupLabel>Members</GroupLabel>}
          {memberHits.map((h) => (
            <Row key={h.key} hit={h} active={hits[active] === h} onPick={go} />
          ))}
          {loadingMembers && (
            <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading members…
            </p>
          )}
          {!hits.length && !loadingMembers && (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  );
}

function Row({ hit, active, onPick }: { hit: Hit; active: boolean; onPick: (h: Hit) => void }) {
  let Icon = SlidersHorizontal;
  let title: string;
  let sub: string;
  if (hit.kind === "setting") {
    title = hit.setting.title;
    sub = hit.setting.where;
  } else if (hit.kind === "member") {
    Icon = User;
    title = hit.member.display_name || hit.member.email || "No name";
    sub = [
      hit.member.display_name ? hit.member.email : null,
      hit.member.telegram_username ? `Telegram ${hit.member.telegram_username}` : null,
      hit.member.og_vip_id,
    ]
      .filter(Boolean)
      .join(" · ");
  } else {
    Icon = Search;
    title = `See all ${hit.count} matching members`;
    sub = "Open the Members list";
  }
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      // Keep focus in the input so the list doesn't close before the click lands.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(hit)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition",
        active ? "bg-muted" : "hover:bg-muted/60",
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}
