import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Crown, ExternalLink, Loader2, Calendar } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useRole } from "@/hooks/use-role";
import { useVipSubscription } from "@/hooks/use-vip-subscription";
import { getStripeEnvironment } from "@/lib/stripe";

import { createBillingPortalSession } from "@/lib/payments.functions";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function VipStatusCard() {
  const { isVip, isLoading: roleLoading } = useRole();
  const { data: sub, isLoading: subLoading } = useVipSubscription();
  const openPortal = useServerFn(createBillingPortalSession);
  const [busy, setBusy] = useState(false);

  async function handleManage() {
    setBusy(true);
    try {
      const res = await openPortal({
        data: {
          returnUrl: window.location.origin + "/settings",
          environment: getStripeEnvironment(),
        },
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message || "Could not open billing portal");
    } finally {
      setBusy(false);
    }
  }

  const loading = roleLoading || subLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Crown className="h-4 w-4 text-primary" /> OG VIP membership
        </CardTitle>
        <CardDescription>
          £5 / month — foul-mouth OG bot, priority replies, and a 10-coin daily safety net.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Status:</span>
          {loading ? (
            <Badge variant="secondary">Checking…</Badge>
          ) : isVip ? (
            <Badge className="bg-gradient-brand text-primary-foreground shadow-glow">
              <Crown className="mr-1 h-3 w-3" /> VIP active
            </Badge>
          ) : (
            <Badge variant="outline">Not subscribed</Badge>
          )}
          {sub?.status && sub.status !== "active" && (
            <Badge variant="secondary" className="capitalize">
              {sub.status.replace(/_/g, " ")}
            </Badge>
          )}
        </div>

        {isVip && sub?.currentPeriodEnd && (
          <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm">
            <Calendar className="h-4 w-4 text-primary" />
            <span>
              {sub.cancelAtPeriodEnd ? "Access ends" : "Renews"} on{" "}
              <span className="font-semibold">{formatDate(sub.currentPeriodEnd)}</span>
            </span>
          </div>
        )}

        <div className="flex min-w-0 flex-wrap gap-2">
          {isVip ? (
            <Button onClick={handleManage} disabled={busy} variant="outline">
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-2 h-4 w-4" />
              )}
              Manage my subscription
            </Button>
          ) : (
            <Button
              asChild
              className="h-auto min-h-11 w-full whitespace-normal bg-gradient-brand py-2 text-center leading-tight text-primary-foreground shadow-glow min-[430px]:w-auto"
            >
              <Link to="/buy-coins" search={{ flow: "vip" } as never}>
                <Crown className="mr-2 h-4 w-4" /> Upgrade to OG VIP — £5/month
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
