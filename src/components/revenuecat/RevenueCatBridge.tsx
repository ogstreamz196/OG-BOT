import { useAuth } from "@/hooks/use-auth";
import { RevenueCatProvider } from "./RevenueCatProvider";

/**
 * Always the same tree on the server and the client. The provider itself
 * loads nothing: the SDK is only fetched in the phone apps, when a purchase
 * screen calls useRevenueCat (see RevenueCatProvider).
 */
export function RevenueCatBridge({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return (
    // Guest (anonymous) sessions never become RevenueCat customers.
    <RevenueCatProvider userId={user?.is_anonymous ? undefined : user?.id}>
      {children}
    </RevenueCatProvider>
  );
}
