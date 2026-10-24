/**
 * Search and AI-search helpers. Wording here reuses the site's existing
 * titles and descriptions; this file only decides addresses and structure.
 */
export const SITE_URL = "https://ogbot.co.uk";
export const SITE_LOGO = `${SITE_URL}/icons/apple-touch-icon.png`;
export const SHARE_IMAGE = `${SITE_URL}/share/og-bot-track.png`;

/**
 * Public pages that search engines should index, by path, with the address
 * they should be listed under. "/" is the signed-in app; signed-out visitors
 * (and crawlers) land on /welcome, so that is the address to rank.
 */
const CANONICAL: Record<string, string> = {
  "/": `${SITE_URL}/welcome`,
  "/welcome": `${SITE_URL}/welcome`,
  "/terms": `${SITE_URL}/terms`,
  "/policy": `${SITE_URL}/policy`,
  "/trust": `${SITE_URL}/trust`,
  "/delete-account": `${SITE_URL}/delete-account`,
};

export function canonicalFor(pathname: string): string | null {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return CANONICAL[clean] ?? null;
}

// 0G B0T (with zeros) is the official name; the old spellings stay so
// searches for "og bot" still find the site.
export const SITE_NAMES = ["0G B0T", "OG BOT", "OG Bot", "OGBot", "OG Studio", "OG Streamz"];

/** Structured data for the whole site: the site, the business and the app. */
export function siteJsonLd(description: string) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "OG Streamz",
      alternateName: SITE_NAMES.filter((n) => n !== "OG Streamz"),
      url: SITE_URL,
      inLanguage: "en-GB",
      description,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "OG Streamz",
      alternateName: SITE_NAMES.filter((n) => n !== "OG Streamz"),
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: SITE_LOGO },
      areaServed: "GB",
    },
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: "0G B0T",
      alternateName: SITE_NAMES.filter((n) => n !== "0G B0T"),
      url: `${SITE_URL}/welcome`,
      image: SHARE_IMAGE,
      description,
      applicationCategory: "MultimediaApplication",
      applicationSubCategory: "AI music generator",
      operatingSystem: "Web, Android, iOS",
      browserRequirements: "Requires JavaScript",
      inLanguage: "en-GB",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ];
}
