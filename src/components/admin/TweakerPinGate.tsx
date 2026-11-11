import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock, ShieldCheck, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { getTweakerPinState, setTweakerPin, verifyTweakerPin } from "@/lib/tweaker-pin.functions";
import { cleanPin, pinError, PIN_MIN, TWEAKER_UNLOCK_FLAG } from "@/lib/tweaker-pin";
import { Button } from "@/components/ui/button";
import { AdminSection } from "./AdminSection";

const readFlag = () => {
  try {
    return sessionStorage.getItem(TWEAKER_UNLOCK_FLAG) === "1";
  } catch {
    return false;
  }
};

/**
 * PIN lock for the TradeTweaker control room. It's a second lock on top of the
 * admin gate. With no PIN set the room is open (with a prompt to lock it); once
 * a PIN is set it must be entered once per browser session. Changing the PIN
 * later is a Boss-dashboard job — kept out of the locked room on purpose.
 */
export function TweakerPinGate({ children }: { children: ReactNode }) {
  const loadState = useServerFn(getTweakerPinState);
  const verify = useServerFn(verifyTweakerPin);
  const setPin = useServerFn(setTweakerPin);
  const state = useQuery({
    queryKey: ["tweaker-pin-state"],
    queryFn: () => loadState(),
    staleTime: 60_000,
  });
  const [unlocked, setUnlocked] = useState(readFlag);
  const [pin, setPinInput] = useState("");

  const unlock = useMutation({
    mutationFn: () => verify({ data: { pin } }),
    onSuccess: (res) => {
      if (res.ok) {
        try {
          sessionStorage.setItem(TWEAKER_UNLOCK_FLAG, "1");
        } catch {
          /* private mode */
        }
        setUnlocked(true);
        setPinInput("");
      } else {
        toast.error("Wrong PIN.");
      }
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't check that"),
  });

  const firstSet = useMutation({
    mutationFn: () => setPin({ data: { pin } }),
    onSuccess: () => {
      toast.success("PIN set. This room is now locked to that PIN.");
      setPinInput("");
      setUnlocked(true);
      try {
        sessionStorage.setItem(TWEAKER_UNLOCK_FLAG, "1");
      } catch {
        /* private mode */
      }
      state.refetch();
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't set that"),
  });

  if (state.isLoading) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Checking the lock…
      </p>
    );
  }

  const isSet = state.data?.set ?? false;

  // PIN set and not yet unlocked this session → the lock screen.
  if (isSet && !unlocked) {
    return (
      <AdminSection
        icon={<Lock className="h-4 w-4 text-amber-400" />}
        title="Control room locked"
        subtitle="Enter the signal control-room PIN to carry on. It unlocks for this browser until you close it."
      >
        <form
          className="flex max-w-sm flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (pin.length >= PIN_MIN) unlock.mutate();
          }}
        >
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Control room PIN"
            placeholder="PIN"
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-center text-lg tracking-[0.4em] text-foreground"
            value={pin}
            onChange={(e) => setPinInput(cleanPin(e.target.value))}
          />
          <Button type="submit" disabled={pin.length < PIN_MIN || unlock.isPending}>
            {unlock.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 h-4 w-4" />
            )}
            Unlock
          </Button>
          <p className="text-xs text-muted-foreground">
            Forgotten it? Set a new one from the Boss dashboard.
          </p>
        </form>
      </AdminSection>
    );
  }

  // Unlocked, or no PIN set yet. When unset, prompt to lock the room.
  return (
    <>
      {!isSet ? (
        <AdminSection
          icon={<ShieldAlert className="h-4 w-4 text-amber-400" />}
          title="This room isn't locked yet"
          subtitle="Anyone with Boss access can open it. Set a PIN to lock the control room. You can change it later from the Boss dashboard."
          muted
        >
          <form
            className="flex max-w-sm flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!pinError(pin)) firstSet.mutate();
            }}
          >
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              aria-label="New control room PIN"
              placeholder={`New PIN (${PIN_MIN}+ digits)`}
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-center text-lg tracking-[0.4em] text-foreground"
              value={pin}
              onChange={(e) => setPinInput(cleanPin(e.target.value))}
            />
            <Button type="submit" disabled={!!pinError(pin) || firstSet.isPending}>
              {firstSet.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Lock className="mr-2 h-4 w-4" />
              )}
              Set PIN &amp; lock
            </Button>
          </form>
        </AdminSection>
      ) : null}
      {children}
    </>
  );
}
