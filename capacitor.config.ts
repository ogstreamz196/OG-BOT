import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shell config for the OG BOT phone apps.
 *
 * The apps are a thin native wrapper: they load the published site directly,
 * so publishing here updates the phone apps instantly with no store review.
 * `webDir` points at a tiny offline fallback page that is only shown if the
 * device cannot reach the site at all.
 */
const config: CapacitorConfig = {
  appId: "og.bot",
  appName: "OG BOT",
  webDir: "mobile/www",
  server: {
    url: "https://ogbot.co.uk",
    // OG Carrom opens inside the app instead of the phone's browser.
    allowNavigation: ["carrom.ogbot.co.uk"],
    cleartext: false,
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    contentInset: "always",
  },
};

export default config;
