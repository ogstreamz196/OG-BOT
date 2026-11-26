import { createFileRoute } from "@tanstack/react-router";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";
import { log, processStripeEvent } from "@/lib/stripe-events.server";

// Stripe's direct webhook. The same events also reach OG B0T through the
// OGSTREAMZ hub's shared webhook (stripe-hub-events.server.ts); both paths
// share processStripeEvent, so each event is handled once.
export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          log("error", "invalid env param", { rawEnv });
          return Response.json({ received: true, ignored: "invalid env" });
        }
        const env: StripeEnv = rawEnv;
        try {
          const event = (await verifyWebhook(request, env)) as {
            id: string;
            type: string;
            data: { object: any };
          };
          if (!event?.id || !event?.type) {
            log("error", "event missing id/type", {});
            return Response.json({ received: true, ignored: "shape" });
          }

          const outcome = await processStripeEvent(event, env);
          if (outcome === "duplicate") return Response.json({ received: true, duplicate: true });
          return Response.json({ received: true });
        } catch (e) {
          log("error", "webhook error", { err: String((e as Error)?.message ?? e) });
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
