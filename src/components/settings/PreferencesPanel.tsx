import { useEffect, useState } from "react";
import { SlidersHorizontal, Minus, Plus, Crown } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  useFoulIntensity,
  useFoulMouth,
  useSetFoulIntensity,
  useSetFoulMouth,
} from "@/hooks/use-foul-mouth";
import { useRole } from "@/hooks/use-role";
import { useAuth } from "@/hooks/use-auth";
import {
  useDisplayPrefs,
  useSetDisplayPrefs,
  clampScale,
  type Density,
} from "@/hooks/use-display-prefs";
import { useAura, type AuraLevel } from "@/hooks/use-aura";
import { Segmented, SettingRow, SettingsCard } from "./SettingsCard";

/**
 * Every setting a member can change, in one card. Only settings the app
 * actually uses live here: OG Bot's language (saved to the account), alerts
 * (the device's own permission), and how the app looks (saved to the account).
 */
/** Same scale as the song wizard's swearing slider (user_preferences.foul_intensity). */
export const FOUL_LEVELS = ["Clean", "Mild", "Spicy", "Savage"] as const;

export function PreferencesPanel() {
  const { user } = useAuth();
  const { foulMouth, isLoading } = useFoulMouth();
  const setFoulMouth = useSetFoulMouth();
  const { intensity } = useFoulIntensity();
  const setIntensity = useSetFoulIntensity();
  const { isVip } = useRole();
  const display = useDisplayPrefs();
  const setDisplay = useSetDisplayPrefs();
  const aura = useAura();

  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">("unsupported");
  const [storagePersisted, setStoragePersisted] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof Notification !== "undefined") setNotifPerm(Notification.permission);
    navigator.storage
      ?.persisted?.()
      .then(setStoragePersisted)
      .catch(() => {});
  }, []);

  async function allowNotifications() {
    if (typeof Notification === "undefined") return;
    try {
      const res = await Notification.requestPermission();
      setNotifPerm(res);
      toast.success(res === "granted" ? "Alerts are on" : "Alerts kept off");
    } catch {
      /* noop */
    }
  }

  async function keepOffline() {
    try {
      const v = (await navigator.storage?.persist?.()) ?? false;
      setStoragePersisted(v);
      toast.success(v ? "Your library stays saved on this device" : "Your browser said no");
    } catch {
      toast.error("Couldn't turn that on here");
    }
  }

  function reshowPrompt() {
    try {
      localStorage.removeItem(`og:perms:asked:${user?.id ?? ""}`);
      toast.success("You'll see the permissions prompt again next visit");
    } catch {
      /* noop */
    }
  }

  const STEP = 0.05;
  const scalePct = Math.round(display.textScale * 100);
  const bump = (d: number) => setDisplay.mutate({ textScale: clampScale(display.textScale + d) });

  return (
    <SettingsCard
      icon={<SlidersHorizontal className="h-5 w-5" />}
      title="App preferences"
      hint="How OG B0T talks and how the app looks. Changes save as soon as you tap them."
      tone="orange"
    >
      <SettingRow
        label="OG B0T Foul Mouth"
        hint={
          isVip ? (
            "Let OG B0T swear and go fully savage in replies."
          ) : (
            <>
              VIP only.{" "}
              <Link
                to="/buy-coins"
                search={{ flow: "vip" } as never}
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                Unlock with OG VIP
              </Link>
            </>
          )
        }
      >
        {!isVip && <Crown className="h-4 w-4 text-coin" aria-hidden />}
        <Switch
          aria-label="Foul Mouth"
          checked={isVip && foulMouth}
          disabled={!isVip || isLoading || setFoulMouth.isPending}
          onCheckedChange={(v) => setFoulMouth.mutate(v)}
        />
      </SettingRow>

      <Segmented<string>
        label="Language in your songs"
        value={String(intensity)}
        onChange={(v) => setIntensity.mutate(Number(v))}
        options={FOUL_LEVELS.map((label, i) => ({ value: String(i), label }))}
      />

      <SettingRow
        label="Alerts on this device"
        hint={
          notifPerm === "granted"
            ? "On. We'll ping you when a song is ready."
            : notifPerm === "denied"
              ? "Blocked. Turn them on in your browser or phone settings."
              : notifPerm === "unsupported"
                ? "This device doesn't support alerts."
                : "Get a ping when your song is ready."
        }
      >
        {notifPerm === "granted" ? (
          <span className="text-xs font-semibold text-primary">On</span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={allowNotifications}
            disabled={notifPerm !== "default"}
          >
            Turn on
          </Button>
        )}
      </SettingRow>

      <SettingRow label="Text size" hint="Saved to your account, used on every device.">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Smaller text"
          disabled={display.textScale <= 0.85 || setDisplay.isPending}
          onClick={() => bump(-STEP)}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <button
          type="button"
          className="w-11 text-center text-sm font-semibold tabular-nums"
          title="Reset to 100%"
          aria-label={`Text size ${scalePct}%. Tap to reset.`}
          onClick={() => setDisplay.mutate({ textScale: 1 })}
        >
          {scalePct}%
        </button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Bigger text"
          disabled={display.textScale >= 1.5 || setDisplay.isPending}
          onClick={() => bump(STEP)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </SettingRow>

      <Segmented<Density>
        label="Spacing"
        value={display.density}
        onChange={(v) => setDisplay.mutate({ density: v })}
        options={[
          { value: "compact", label: "Tight" },
          { value: "comfortable", label: "Normal" },
          { value: "spacious", label: "Roomy" },
        ]}
      />

      <Segmented<AuraLevel>
        label="Red glow"
        value={aura.level}
        onChange={(v) => aura.setLevel(v)}
        options={[
          { value: "off", label: "Off" },
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ]}
      />

      <details className="group rounded-xl border border-border bg-background/40 p-3 text-sm">
        <summary className="cursor-pointer select-none font-medium text-muted-foreground group-open:text-foreground">
          More
        </summary>
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium leading-tight">Keep my library on this device</p>
              <p className="text-xs text-muted-foreground">
                {storagePersisted
                  ? "On. Your browser won't clear it."
                  : "Stops your browser clearing saved tracks."}
              </p>
            </div>
            {storagePersisted ? (
              <span className="shrink-0 text-xs font-semibold text-primary">On</span>
            ) : (
              <Button size="sm" variant="outline" onClick={keepOffline}>
                Turn on
              </Button>
            )}
          </div>
          <button
            type="button"
            onClick={reshowPrompt}
            className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
          >
            Show the permissions prompt again
          </button>
        </div>
      </details>
    </SettingsCard>
  );
}
