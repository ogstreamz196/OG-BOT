import { Capacitor } from "@capacitor/core";
const clientToken = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN) as string | undefined;

export function PaymentTestModeBanner() {
  // Card checkout is website-only; the app uses Google Play billing.
  if (Capacitor.isNativePlatform()) return null;
  if (!clientToken) {
    return (
      <div
        role="status"
        className="mb-3 w-full border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-xs font-medium text-destructive sm:rounded-md"
      >
        Checkout is unavailable until payments are reconnected.
      </div>
    );
  }
  if (clientToken.startsWith("pk_test_")) {
    return (
      <div
        role="status"
        className="mb-3 w-full border border-primary/30 bg-primary/10 px-3 py-2 text-center text-xs font-medium text-primary sm:rounded-md"
      >
        All payments made in the preview are in test mode.{" "}
        <a
          href="https://docs.lovable.dev/features/payments#test-and-live-environments"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline"
        >
          Read about test and live payment environments
        </a>
      </div>
    );
  }
  return null;
}
