import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({
    meta: [
      { title: "Terms of Use — OG BOT" },
      {
        name: "description",
        content:
          "Terms of Use for the OG BOT app and ogbot.co.uk — subscriptions, OG Coins, generated content, acceptable use and cancellation.",
      },
      { property: "og:title", content: "Terms of Use — OG BOT" },
      {
        property: "og:description",
        content:
          "The rules for using OG BOT: subscriptions, coins, generated tracks, acceptable use and cancellation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function TermsPage() {
  return (
    <main className="safe-top safe-bottom safe-x mx-auto max-w-3xl px-5 py-12 text-foreground">
      <Link
        to="/welcome"
        className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground hover:text-foreground"
      >
        ← Back
      </Link>
      <h1 className="font-display mt-3 text-3xl font-black sm:text-4xl">Terms of Use</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        OG BOT is operated by OG Studio. Last updated: 30 September 2026. By using the OG BOT app or{" "}
        <a href="https://ogbot.co.uk" className="text-primary underline">
          ogbot.co.uk
        </a>{" "}
        you agree to these terms.
      </p>

      <div className="mt-10 space-y-8">
        <Section title="1. Your account">
          <p>
            You must be 13 or older to hold an account. Keep your sign-in details secure; you are
            responsible for activity on your account. We may suspend accounts used for abuse, fraud,
            or to farm free credits.
          </p>
        </Section>

        <Section title="2. OG Coins">
          <p>
            OG Coins are a limited, non-transferable licence to use features inside OG BOT. They
            have no cash value and cannot be exchanged for money. Unused coins are forfeited if you
            delete your account.
          </p>
          <p>
            <strong className="text-foreground">Refunds:</strong> once any coins from a purchase
            have been used, that purchase cannot be refunded. Website purchases can only be refunded
            within 14 days and only while all of the purchased coins are unused. Purchases made in
            the Apple App Store or Google Play are refunded by Apple or Google under their own rules
            and time limits. Contact{" "}
            <a href="mailto:ogbot196@gmail.com" className="text-primary underline">
              ogbot196@gmail.com
            </a>{" "}
            with any question.
          </p>
        </Section>

        <Section title="3. Subscriptions and billing">
          <p>
            OG VIP is an auto-renewing subscription. Payment is charged to your Apple ID or Google
            Play account at confirmation of purchase. It renews automatically at the same price
            unless cancelled at least 24 hours before the end of the current period, and your
            account is charged for renewal within 24 hours of the period ending.
          </p>
          <p>
            Manage or cancel your subscription in your Apple ID settings or your Google Play account
            settings after purchase. Purchases made on the website are handled by Stripe and can be
            managed from the Store page.
          </p>
        </Section>

        <Section title="4. Content you create">
          <p>
            You keep ownership of the prompts you write. Subject to these terms and your plan, you
            may use the tracks, lyrics and cover art you generate for personal and commercial
            purposes. You are responsible for making sure your prompts and generated content do not
            infringe anyone's rights.
          </p>
        </Section>

        <Section title="5. Acceptable use">
          <p>
            Do not use OG BOT to create or share content that is unlawful, harassing, hateful,
            sexually explicit involving minors, or that impersonates a real person in a harmful or
            deceptive way. Explicit-language modes are for adult users and are still subject to
            these rules.
          </p>
          <p>
            Community and Battle Zone posts are moderated. Report anything that breaks these rules
            and we will review and remove it, and may suspend the account responsible.
          </p>
        </Section>

        <Section title="6. Generated content disclaimer">
          <p>
            Songs, lyrics and replies are produced by automated systems and may be inaccurate or
            unexpected. They are provided "as is" without warranty, and OG BOT is not liable for how
            generated content is used.
          </p>
        </Section>

        <Section title="7. Ending your account">
          <p>
            You can delete your account at any time in Settings, or see{" "}
            <Link to="/delete-account" className="text-primary underline">
              how to delete your account
            </Link>
            . We may end or suspend access if these terms are broken.
          </p>
        </Section>

        <Section title="8. Privacy, changes and contact">
          <p>
            Our{" "}
            <Link to="/policy" className="text-primary underline">
              Privacy Policy
            </Link>{" "}
            explains how we handle your data. We may update these terms; material changes will be
            shown in the app or on this page with a new date. Questions?{" "}
            <a href="mailto:ogbot196@gmail.com" className="text-primary underline">
              ogbot196@gmail.com
            </a>
            .
          </p>
        </Section>
      </div>
    </main>
  );
}
