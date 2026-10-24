import { useEffect } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { getPublicSharedTrack } from "@/lib/public-track.functions";
import { useSignedIn } from "@/components/track/PortalLinks";
import { SharedTrackView } from "@/components/track/SharedTrackView";

const SITE_URL = "https://ogbot.co.uk";
const SHARE_IMAGE = `${SITE_URL}/share/og-bot-track.png`;

export const Route = createFileRoute("/track/$songId")({
  loader: ({ params }) => getPublicSharedTrack({ data: { songId: params.songId } }),
  head: ({ params, loaderData }) => {
    const title = loaderData?.title || "Shared OG B0T track";
    const description = loaderData
      ? `Listen to “${title}”, created with OG B0T.`
      : "Listen to music created with OG B0T.";
    const url = `${SITE_URL}/track/${params.songId}`;
    return {
      meta: [
        { title: `${title} | OG B0T — AI Songs & Diss Tracks` },
        { name: "description", content: description },
        { property: "og:title", content: `${title} | OG B0T — AI Songs & Diss Tracks` },
        { property: "og:description", content: description },
        { property: "og:type", content: "music.song" },
        { property: "og:url", content: url },
        { property: "og:image", content: SHARE_IMAGE },
        { property: "og:image:alt", content: "OG B0T" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: `${title} | OG B0T — AI Songs & Diss Tracks` },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: SHARE_IMAGE },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: loaderData
        ? [
            {
              type: "application/ld+json",
              children: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "MusicRecording",
                name: title,
                url,
                image: SHARE_IMAGE,
                description,
                isPartOf: { "@id": `${SITE_URL}/#website` },
                publisher: { "@id": `${SITE_URL}/#organization` },
              }),
            },
          ]
        : [],
    };
  },
  component: SharedTrackPage,
});

function SharedTrackPage() {
  const track = Route.useLoaderData();
  const router = useRouter();
  const signedIn = useSignedIn();
  // Being remixed: look again every 20 seconds until it's ready.
  useEffect(() => {
    if (!track?.pending) return;
    const t = setTimeout(() => void router.invalidate(), 20_000);
    return () => clearTimeout(t);
  }, [track, router]);
  return <SharedTrackView track={track} signedIn={signedIn} />;
}
