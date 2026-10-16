import { Suspense, lazy } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";

// The RevenueCat Web SDK is browser-only, so the provider is loaded lazily
// after hydration and never evaluated during SSR.
const RevenueCatProvider = lazy(() =>
  import("./RevenueCatProvider").then((m) => ({ default: m.RevenueCatProvider })),
);

export function RevenueCatBridge({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // During SSR (and the first client render) the RevenueCat provider is not
  // available, so children must render directly — otherwise the whole page
  // tree renders nothing on the server and every route fails.
  return (
    <ClientOnly fallback={<>{children}</>}>
      <Suspense fallback={<>{children}</>}>
        {/* Guest (anonymous) sessions never become RevenueCat customers. */}
        <RevenueCatProvider userId={user?.is_anonymous ? undefined : user?.id}>
          {children}
        </RevenueCatProvider>
      </Suspense>
    </ClientOnly>
  );
}
