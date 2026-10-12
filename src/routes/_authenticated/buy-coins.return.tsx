import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Coins, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { reconcileCoinSession } from "@/lib/payments.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { OgVipIdCard } from "@/components/vip/OgVipIdCard";

export const Route = createFileRoute("/_authenticated/buy-coins/return")({
  component: BuyCoinsReturn,
  head: () => ({
    meta: [
      { title: "Purchase complete — OG BOT" },
      {
        name: "description",
        content: "Your OG coin purchase is confirmed and your balance updated.",
      },
      { property: "og:title", content: "Purchase complete — OG BOT" },
      { property: "og:description", content: "Your OG coin purchase is confirmed." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

type State =
  | { kind: "loading" }
  | { kind: "done"; coins: number; balance: number }
  | { kind: "vip"; ogVipId: string | null }
  | { kind: "pending" }
  | { kind: "error"; message: string };

function BuyCoinsReturn() {
  const qc = useQueryClient();
  const handled = useRef(false);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (handled.current || typeof window === "undefined") return;
    handled.current = true;
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId || sessionId.includes("{")) {
      setState({ kind: "error", message: "We couldn't find that payment." });
      return;
    }
    void (async () => {
      try {
        const res = await reconcileCoinSession({
          data: { sessionId, environment: getStripeEnvironment() },
        });
        if ("error" in res) {
          setState({ kind: "error", message: res.error });
          return;
        }
        if (res.status === "pending") setState({ kind: "pending" });
        else if (res.status === "vip_granted")
          setState({ kind: "vip", ogVipId: "ogVipId" in res ? (res.ogVipId ?? null) : null });
        else
          setState({
            kind: "done",
            coins: "coins" in res ? (res.coins ?? 0) : 0,
            balance: "balance" in res ? (res.balance ?? 0) : 0,
          });
        await qc.invalidateQueries({ queryKey: ["profile"] });
      } catch (e) {
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "Payment check failed",
        });
      }
    })();
  }, [qc]);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-10">
      <Card className="border-primary/40 bg-card/80 shadow-glow">
        <CardContent className="space-y-4 p-6 text-center sm:p-8">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/20 text-primary">
            {state.kind === "loading" ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : state.kind === "error" ? (
              <TriangleAlert className="h-7 w-7 text-destructive" />
            ) : state.kind === "pending" ? (
              <Coins className="h-7 w-7" />
            ) : (
              <CheckCircle2 className="h-7 w-7" />
            )}
          </div>

          <h1 className="font-display text-2xl font-black uppercase tracking-[0.06em]">
            {state.kind === "loading"
              ? "Confirming your payment"
              : state.kind === "error"
                ? "Something went wrong"
                : state.kind === "pending"
                  ? "Payment still processing"
                  : state.kind === "vip"
                    ? "VIP unlocked"
                    : "Payment complete"}
          </h1>

          <p className="text-sm text-muted-foreground">
            {state.kind === "loading" && "Hang tight — checking with the card processor."}
            {state.kind === "error" && state.message}
            {state.kind === "pending" &&
              "Your coins land as soon as the bank confirms. Check back in a minute."}
            {state.kind === "vip" && "Your VIP perks are active across the whole hub."}
            {state.kind === "done" &&
              `${state.coins} OG coins added. Your balance is now ${state.balance}.`}
          </p>
          {state.kind === "vip" && state.ogVipId && <OgVipIdCard id={state.ogVipId} />}

          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-center">
            <Button asChild className="font-black uppercase tracking-[0.1em]">
              <Link to="/library">Make a track</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/store">Back to the Store</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
