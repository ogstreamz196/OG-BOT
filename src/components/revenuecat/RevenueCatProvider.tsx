import React, { createContext, useContext, useEffect, useState } from "react";
import type { CustomerInfo, Offerings, Package } from "@revenuecat/purchases-js";
import {
  configureRevenueCat,
  getCustomerInfo,
  getOfferings,
  purchasePackage as rcPurchasePackage,
  checkVipEntitlement,
} from "@/lib/revenuecat";

interface RevenueCatContextType {
  isConfigured: boolean;
  isVip: boolean;
  customerInfo: CustomerInfo | null;
  offerings: Offerings | null;
  loading: boolean;
  purchasePackage: (pkg: Package) => Promise<boolean>;
  refreshInfo: () => Promise<void>;
}

const RevenueCatContext = createContext<RevenueCatContextType | undefined>(undefined);

export function RevenueCatProvider({
  children,
  userId, // Pass the authenticated user ID here when available
}: {
  children: React.ReactNode;
  userId?: string;
}) {
  const [isConfigured, setIsConfigured] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null);
  const [offerings, setOfferings] = useState<Offerings | null>(null);
  const [isVip, setIsVip] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Configure RC when the component mounts or userId changes
    let cancelled = false;
    (async () => {
      await configureRevenueCat(userId);
      if (cancelled) return;
      setIsConfigured(true);
      await refreshInfo();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const refreshInfo = async () => {
    setLoading(true);
    try {
      const [info, offers, vipStatus] = await Promise.all([
        getCustomerInfo(),
        getOfferings(),
        checkVipEntitlement(),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped table/SDK shape
      setCustomerInfo(info as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped table/SDK shape
      setOfferings(offers as any);
      setIsVip(vipStatus);
    } catch (error) {
      console.error("Error fetching RevenueCat data", error);
    } finally {
      setLoading(false);
    }
  };

  const purchasePackage = async (pkg: Package): Promise<boolean> => {
    try {
      const updatedInfo = await rcPurchasePackage(pkg);
      if (updatedInfo) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped table/SDK shape
        setCustomerInfo(updatedInfo as any);
        const vipStatus = updatedInfo.entitlements.active["og_vip_pass"] !== undefined;
        setIsVip(vipStatus);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Purchase error", error);
      return false; // Error handled inside purchasePackage, could be cancellation
    }
  };

  return (
    <RevenueCatContext.Provider
      value={{
        isConfigured,
        isVip,
        customerInfo,
        offerings,
        loading,
        purchasePackage,
        refreshInfo,
      }}
    >
      {children}
    </RevenueCatContext.Provider>
  );
}

// Safe default while the provider is still loading (server render / before hydration).
const LOADING_CONTEXT: RevenueCatContextType = {
  isConfigured: false,
  isVip: false,
  customerInfo: null,
  offerings: null,
  loading: true,
  purchasePackage: async () => false,
  refreshInfo: async () => {},
};

export function useRevenueCat() {
  return useContext(RevenueCatContext) ?? LOADING_CONTEXT;
}
