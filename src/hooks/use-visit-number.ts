import { useEffect, useState } from "react";
import { browserStores, countVisit } from "@/lib/visits";

/**
 * Which visit this is for `who` (a member id, or "device"): 1 on the first,
 * then 2, 3… Null until it's known (server render, or no `who` yet).
 */
export function useVisitNumber(who: string | null | undefined): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!who) return;
    const { local, session } = browserStores();
    setN(countVisit(who, local, session));
  }, [who]);
  return n;
}
