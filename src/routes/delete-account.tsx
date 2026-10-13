import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/delete-account")({
  component: DeleteAccountPage,
  head: () => ({
    meta: [
      { title: "Delete your OG BOT account | AI Songs & Diss Tracks" },
      {
        name: "description",
        content:
          "How to delete your OG BOT account and associated data, what is removed and what is kept.",
      },
      { property: "og:title", content: "Delete your OG BOT account | AI Songs & Diss Tracks" },
      {
        property: "og:description",
        content: "Steps to permanently delete your OG BOT account and data.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function DeleteAccountPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-12 text-foreground">
      <h1 className="font-display text-3xl font-bold">Delete your OG BOT account</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        App: OG BOT (og.bot) — developer: OG Studio
      </p>
      <h2 className="mt-8 text-xl font-semibold">In the app or on the website</h2>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
        <li>
          <Link to="/welcome" className="text-primary underline">
            Sign in
          </Link>{" "}
          to your account.
        </li>
        <li>
          Open <strong>Settings</strong>.
        </li>
        <li>
          Scroll to <strong>Delete account</strong>, tap <strong>Delete my account</strong>, type
          DELETE and confirm.
        </li>
      </ol>
      <p className="mt-3 text-sm">
        Can't sign in? Email{" "}
        <a className="text-primary underline" href="mailto:ogbot196@gmail.com">
          ogbot196@gmail.com
        </a>{" "}
        from your account email and we'll delete it within 30 days.
      </p>
      <h2 className="mt-8 text-xl font-semibold">What is deleted</h2>
      <p className="mt-2 text-sm">
        Your profile, sign-in details, songs, lyrics, messages, coin balance, referrals and settings
        are deleted immediately.
      </p>
      <h2 className="mt-8 text-xl font-semibold">What is kept</h2>
      <p className="mt-2 text-sm">
        Payment and refund records are kept for up to 6 years where required by UK tax and
        accounting law, then deleted. Unused coins and active subscriptions are forfeited — cancel
        Google Play subscriptions in the Play Store first.
      </p>
    </main>
  );
}
