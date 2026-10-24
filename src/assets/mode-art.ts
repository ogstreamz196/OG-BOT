// Home and landing mode-card art with a 480px copy for phones, where each
// card is about 180px wide; the 960px original is only fetched for big
// screens (see ModeCard's srcSet/sizes).
import battleZone from "./og-bot-battle-zone.webp";
import battleZone480 from "./og-bot-battle-zone-480.webp";
import createTrack from "./og-bot-create-track.webp";
import createTrack480 from "./og-bot-create-track-480.webp";
import sportsGuide from "./og-bot-sports-guide-badge.webp";
import carrom from "./og-carrom.webp";
import carrom480 from "./og-carrom-480.webp";
import signals from "./og-signals.webp";
import signals480 from "./og-signals-480.webp";

export type ModeArt = { src: string; srcSet: string };

const art = (small: string, full: string): ModeArt => ({
  src: full,
  srcSet: `${small} 480w, ${full} 960w`,
});

export const modeArt = {
  battleZone: art(battleZone480, battleZone),
  createTrack: art(createTrack480, createTrack),
  // Already 480px.
  sportsGuide: { src: sportsGuide, srcSet: `${sportsGuide} 480w` },
  carrom: art(carrom480, carrom),
  signals: art(signals480, signals),
};
