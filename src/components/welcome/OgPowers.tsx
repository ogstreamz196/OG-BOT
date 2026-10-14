import type { ReactNode } from "react";
import { EditableContent } from "@/components/admin/EditableContent";
import battleZoneArt from "@/assets/og-bot-battle-zone.webp";
import createTrackArt from "@/assets/og-bot-create-track.webp";

type Theme = "roast" | "studio" | "vault";

type Power = {
  key: string;
  theme: Theme;
  emoji: string;
  title: string;
  body: string;
  cta: string;
  ctaEmoji: string;
  onClick: () => void;
};

/**
 * "Unleash your OG powers" on the landing page. Every colour and effect lives
 * under `.og-powers` in styles.css, so nothing here can leak into the rest of
 * the site. Copy stays admin-editable through EditableContent.
 */
export function OgPowers({
  onBattle,
  onCreate,
  onEarn,
  editBadge,
}: {
  onBattle: () => void;
  onCreate: () => void;
  onEarn: () => void;
  editBadge?: ReactNode;
}) {
  const powers: Power[] = [
    {
      key: "roast",
      theme: "roast",
      emoji: "🔥",
      title: "Roast & Destroy",
      body: "Enter the Battle Zone. Unleash savage roasts, brutal comebacks and personalised diss tracks.",
      cta: "Enter Battle Zone",
      ctaEmoji: "⚔️",
      onClick: onBattle,
    },
    {
      key: "studio",
      theme: "studio",
      emoji: "🎵",
      title: "OG Hit Factory",
      body: "Turn your ideas into personalised tracks with real vocals, custom cover art and unlimited creativity.",
      cta: "Create a Track",
      ctaEmoji: "🎧",
      onClick: onCreate,
    },
    {
      key: "economy",
      theme: "vault",
      emoji: "💰",
      title: "Earn OG Rewards",
      body: "Collect OG Coins, claim daily rewards and earn lifetime referral commissions.",
      cta: "Start Earning",
      ctaEmoji: "🪙",
      onClick: onEarn,
    },
  ];

  return (
    <section
      id="how-it-works"
      aria-labelledby="og-powers-title"
      className="og-powers relative scroll-mt-24 border-t border-border/40"
    >
      <div className="relative mx-auto max-w-6xl px-4 py-12 sm:px-8 sm:py-16">
        <div className="text-center">
          <h2 id="og-powers-title" className="og-powers__plate">
            <span aria-hidden className="og-powers__bolt">
              ⚡
            </span>
            <span className="og-powers__title">Unleash your OG powers</span>
            <span aria-hidden className="og-powers__bolt og-powers__bolt--late">
              ⚡
            </span>
          </h2>
        </div>

        <div className="mx-auto mt-8 grid max-w-xl gap-4 sm:gap-5 lg:max-w-none lg:grid-cols-3">
          {powers.map((p, i) => (
            <article
              key={p.key}
              className={`og-power-card og-power-card--${p.theme} og-rise`}
              style={{ animationDelay: `${0.08 * i}s` }}
            >
              {editBadge}
              <span aria-hidden className="og-power-card__corner og-power-card__corner--tl" />
              <span aria-hidden className="og-power-card__corner og-power-card__corner--br" />

              <div aria-hidden className="og-power-card__art">
                {p.theme === "roast" && (
                  <>
                    <img
                      src={battleZoneArt}
                      alt=""
                      width={960}
                      height={960}
                      loading="lazy"
                      decoding="async"
                      className="og-power-card__img"
                    />
                    <span className="og-power-card__ember" style={{ left: "18%" }} />
                    <span
                      className="og-power-card__ember"
                      style={{ left: "52%", animationDelay: "1.4s" }}
                    />
                    <span
                      className="og-power-card__ember"
                      style={{ left: "80%", animationDelay: "2.6s" }}
                    />
                  </>
                )}
                {p.theme === "studio" && (
                  <>
                    <span className="og-power-card__wave">
                      {Array.from({ length: 14 }, (_, b) => (
                        <span key={b} style={{ animationDelay: `${(b % 7) * 0.12}s` }} />
                      ))}
                    </span>
                    <img
                      src={createTrackArt}
                      alt=""
                      width={960}
                      height={960}
                      loading="lazy"
                      decoding="async"
                      className="og-power-card__img"
                    />
                  </>
                )}
                {p.theme === "vault" && (
                  <>
                    <span className="og-power-card__mini" style={{ left: "16%" }} />
                    <span
                      className="og-power-card__mini"
                      style={{ left: "76%", animationDelay: "1.8s" }}
                    />
                    <span className="og-coin">
                      <span className="og-coin__face">OG</span>
                      <span className="og-coin__spark" />
                    </span>
                  </>
                )}
              </div>

              <div className="og-power-card__body">
                <h3 className="og-power-card__title">
                  <span aria-hidden className="mr-2">
                    {p.emoji}
                  </span>
                  <EditableContent
                    as="span"
                    contentKey={`welcome.powers.${p.key}.title`}
                    defaultValue={p.title}
                  />
                </h3>
                <EditableContent
                  as="p"
                  multiline
                  contentKey={`welcome.powers.${p.key}.body`}
                  defaultValue={p.body}
                  className="og-power-card__text"
                />
                <button type="button" onClick={p.onClick} className="og-power-btn">
                  <span aria-hidden>{p.ctaEmoji}</span>
                  <span>{p.cta}</span>
                  <span aria-hidden>→</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
