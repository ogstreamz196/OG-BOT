// Web SDK is loaded lazily (dynamic import only inside handlers). Its module
// scope performs operations the Cloudflare worker forbids at global scope, so
// a static import here crashes every SSR page.
import type {
  CustomerInfo as CustomerInfoWeb,
  Offerings as OfferingsWeb,
  Package as PackageWeb,
} from "@revenuecat/purchases-js";
import type {
  CustomerInfo as CustomerInfoCap,
  PurchasesOfferings as OfferingsCap,
  PurchasesPackage as PackageCap,
} from "@revenuecat/purchases-capacitor";
import { Capacitor } from "@capacitor/core";

type RCWebModule = typeof import("@revenuecat/purchases-js");
type PurchasesWebInstance = Awaited<ReturnType<RCWebModule["Purchases"]["configure"]>>;

// Native SDK is loaded lazily so the web server never evaluates it.
const loadNative = () => import("@revenuecat/purchases-capacitor").then((m) => m.Purchases);
const loadWeb = (): Promise<RCWebModule> => import("@revenuecat/purchases-js");

// RevenueCat public SDK keys (these ship inside the apps; they aren't secrets).
// Each can be set per build with VITE_REVENUECAT_*_KEY. Android keeps its
// live key as the default; iOS and web have none until a real key is set, so
// a store build never runs against a test key: without one, in-app purchases
// are simply unavailable on that platform.
const env = import.meta.env as Record<string, string | undefined>;
const RC_ANDROID_API_KEY =
  env.VITE_REVENUECAT_ANDROID_KEY?.trim() || "goog_dIqlVeXWmOVtTicDbLnkWOkNUTb";
const RC_IOS_API_KEY = env.VITE_REVENUECAT_IOS_KEY?.trim() || "";
const RC_WEB_API_KEY = env.VITE_REVENUECAT_WEB_KEY?.trim() || "";

/** The key RevenueCat needs on this platform, or "" when none is configured. */
function apiKeyFor(platform: string): string {
  if (platform === "ios") return RC_IOS_API_KEY;
  if (platform === "android") return RC_ANDROID_API_KEY;
  return RC_WEB_API_KEY;
}

function noKeyNotice(platform: string) {
  if (import.meta.env.DEV) {
    console.info(
      `RevenueCat: no ${platform} key (VITE_REVENUECAT_${platform.toUpperCase()}_KEY), in-app purchases are off.`,
    );
  }
}

let purchasesWebInstance: PurchasesWebInstance | null = null;
let isNativeConfigured = false;

/**
 * Configure and initialize RevenueCat for Web or Native
 */
export async function configureRevenueCat(appUserId?: string) {
  if (typeof window === "undefined") return;

  if (Capacitor.isNativePlatform()) {
    const platform = Capacitor.getPlatform();
    const apiKey = apiKeyFor(platform);
    if (!apiKey) {
      noKeyNotice(platform);
      return;
    }
    try {
      await (
        await loadNative()
      ).setLogLevel({ level: (import.meta.env.DEV ? "DEBUG" : "WARN") as any });

      if (appUserId) {
        await (await loadNative()).configure({ apiKey, appUserID: appUserId });
      } else {
        await (await loadNative()).configure({ apiKey });
      }
      isNativeConfigured = true;
      console.log(
        `RevenueCat Native SDK configured for ${platform} with appUserId:`,
        appUserId || "anonymous",
      );
    } catch (error) {
      console.error("Failed to initialize RevenueCat Native", error);
    }
  } else {
    if (!RC_WEB_API_KEY) {
      noKeyNotice("web");
      return;
    }
    const rc = await loadWeb();
    const finalUserId = appUserId || rc.Purchases.generateRevenueCatAnonymousAppUserId();
    purchasesWebInstance = rc.Purchases.configure(RC_WEB_API_KEY, finalUserId);
    console.log("RevenueCat Web SDK configured with appUserId:", finalUserId);
  }
}

/**
 * Check if the user has the VIP Pass entitlement
 */
export async function checkVipEntitlement(): Promise<boolean> {
  try {
    const customerInfo = await getCustomerInfo();
    return customerInfo?.entitlements.active["og_vip_pass"] !== undefined;
  } catch (error) {
    console.error("Error checking VIP entitlement:", error);
    return false;
  }
}

/**
 * Fetch the current Customer Info
 */
export async function getCustomerInfo(): Promise<CustomerInfoWeb | CustomerInfoCap | null> {
  try {
    if (Capacitor.isNativePlatform() && isNativeConfigured) {
      const info = await (await loadNative()).getCustomerInfo();
      return info.customerInfo;
    } else if (purchasesWebInstance) {
      return await purchasesWebInstance.getCustomerInfo();
    }
    return null;
  } catch (error) {
    console.error("Error fetching Customer Info:", error);
    return null;
  }
}

/**
 * Fetch available Offerings configured in the RevenueCat dashboard
 */
export async function getOfferings(): Promise<OfferingsWeb | OfferingsCap | null> {
  try {
    if (Capacitor.isNativePlatform() && isNativeConfigured) {
      const offerings = await (await loadNative()).getOfferings();
      return offerings as any;
    } else if (purchasesWebInstance) {
      return await purchasesWebInstance.getOfferings();
    }
    return null;
  } catch (error) {
    console.error("Error fetching offerings:", error);
    return null;
  }
}

/**
 * Purchase a specific package
 */
export async function purchasePackage(
  rcPackage: PackageWeb | PackageCap,
): Promise<CustomerInfoWeb | CustomerInfoCap | null> {
  try {
    if (Capacitor.isNativePlatform() && isNativeConfigured) {
      const result = await (
        await loadNative()
      ).purchasePackage({
        aPackage: rcPackage as PackageCap,
      });
      return result.customerInfo;
    } else if (purchasesWebInstance) {
      const result = await purchasesWebInstance.purchasePackage(rcPackage as PackageWeb);
      return result.customerInfo;
    }
    return null;
  } catch (error) {
    console.error("Purchase failed or was cancelled:", error);
    throw error;
  }
}

/**
 * Friendly name of the store that handles purchases on this platform.
 * Apple rejects any iOS build that mentions Google Play, and vice versa.
 */
export function purchaseStoreName(): string {
  if (typeof window === "undefined") return "the store";
  if (!Capacitor.isNativePlatform()) return "Stripe";
  return Capacitor.getPlatform() === "ios" ? "the App Store" : "Google Play";
}

/**
 * Restore previously bought subscriptions / non-consumables.
 * Apple guideline 3.1.1 requires this control on every paywall.
 */
export async function restorePurchases(): Promise<CustomerInfoWeb | CustomerInfoCap | null> {
  if (Capacitor.isNativePlatform() && isNativeConfigured) {
    const result = await (await loadNative()).restorePurchases();
    return result.customerInfo;
  }
  // Web billing restores by re-reading the signed-in customer's entitlements.
  return await getCustomerInfo();
}

/**
 * Open Customer Center
 */
export async function showCustomerCenter() {
  try {
    if (Capacitor.isNativePlatform()) {
      // Send the user to the platform's own subscription management screen.
      window.location.href =
        Capacitor.getPlatform() === "ios"
          ? "itms-apps://apps.apple.com/account/subscriptions"
          : "https://play.google.com/store/account/subscriptions";
    } else {
      const customerInfo = (await getCustomerInfo()) as CustomerInfoWeb;
      if (customerInfo?.managementURL) {
        window.location.href = customerInfo.managementURL;
      } else {
        alert("No active subscription to manage.");
      }
    }
  } catch (error) {
    console.error("Error opening Customer Center:", error);
  }
}
