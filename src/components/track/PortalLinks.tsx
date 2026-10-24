import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { modeArt } from "@/assets/mode-art";
import { useCarromLink } from "@/hooks/use-carrom-link";
import { useSignalsPortal } from "@/hooks/use-signals-portal";

/** True once we know the visitor is a signed-in member (not a guest). */
export function useSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setSignedIn(!!data.session && !data.session.user.is_anonymous);
    });
    return () => {
      alive = false;
    };
  }, []);
  return signedIn;
}

const tile =
  "group flex flex-col items-center gap-1.5 rounded-2xl border border-border bg-card p-2 text-center shadow-card transition hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const img = "aspect-square w-full rounded-xl object-cover";
const label = "text-xs font-bold leading-tight text-foreground sm:text-sm";

/** The OG B0T portals, for members who open a shared track. */
export function PortalLinks() {
  const signals = useSignalsPortal();
  const carrom = useCarromLink();
  return (
    <nav aria-label="OG B0T portals" className="w-full">
      <h2 className="mb-3 text-center text-xs font-black uppercase tracking-[0.25em] text-foreground/80">
        More on OG B0T
      </h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 sm:gap-3">
        <Link to="/messenger" search={{ live: true }} className={tile}>
          <img
            src={modeArt.battleZone.src}
            srcSet={modeArt.battleZone.srcSet}
            sizes="20vw"
            alt=""
            className={img}
            loading="lazy"
          />
          <span className={label}>Battle Zone</span>
        </Link>
        <Link to="/library" className={tile}>
          <img
            src={modeArt.createTrack.src}
            srcSet={modeArt.createTrack.srcSet}
            sizes="20vw"
            alt=""
            className={img}
            loading="lazy"
          />
          <span className={label}>Make a Track</span>
        </Link>
        <Link to="/sports" className={tile}>
          <img
            src={modeArt.sportsGuide.src}
            srcSet={modeArt.sportsGuide.srcSet}
            sizes="20vw"
            alt=""
            className={img}
            loading="lazy"
          />
          <span className={label}>Sports Guide</span>
        </Link>
        {signals.enabled && (
          <Link to="/signals" className={tile}>
            <img
              src={modeArt.signals.src}
              srcSet={modeArt.signals.srcSet}
              sizes="20vw"
              alt=""
              className={img}
              loading="lazy"
            />
            <span className={label}>OG Signals</span>
          </Link>
        )}
        <button type="button" onClick={() => void carrom.open()} className={tile}>
          <img
            src={modeArt.carrom.src}
            srcSet={modeArt.carrom.srcSet}
            sizes="20vw"
            alt=""
            className={img}
            loading="lazy"
          />
          <span className={label}>OG Carrom</span>
        </button>
      </div>
    </nav>
  );
}
