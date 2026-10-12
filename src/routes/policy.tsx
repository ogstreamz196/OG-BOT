import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Database, Cookie, Mail, UserCheck, Share2, Clock } from "lucide-react";

export const Route = createFileRoute("/policy")({
  component: PolicyPage,
  head: () => ({
    meta: [
      { title: "Privacy Policy — OG BOT" },
      {
        name: "description",
        content:
          "Privacy policy for the OG BOT app and ogbot.co.uk — what data we collect, why, who we share it with, and how to request deletion. Operated by OG Studio.",
      },
      { property: "og:title", content: "Privacy Policy — OG BOT" },
      {
        property: "og:description",
        content:
          "How OG BOT collects, uses, stores, and protects your data. Operated by OG Studio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ShieldCheck;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="landing-card rhythm">
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/15 text-primary">
          <Icon className="h-6 w-6" />
        </div>
        <h2 className="font-display landing-h2 min-w-0 text-foreground">{title}</h2>
      </div>
      <div className="landing-body rhythm text-muted-foreground">{children}</div>
    </section>
  );
}

function PolicyPage() {
  return (
    <div className="safe-top safe-bottom safe-x min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-14 px-2 py-10 sm:px-4 sm:py-14">
        <header className="space-y-3">
          <Link
            to="/welcome"
            className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground hover:text-foreground sm:text-sm"
          >
            ← Back
          </Link>
          <h1 className="font-display text-[clamp(2.25rem,8vw,5rem)] font-black leading-[0.95] tracking-[-0.03em]">
            Privacy Policy
          </h1>
          <p className="max-w-3xl text-lg leading-relaxed text-muted-foreground">
            This policy explains how OG Studio (&quot;we&quot;, &quot;us&quot;) handles information
            in the OG BOT app and on{" "}
            <a
              href="https://ogbot.co.uk"
              className="font-semibold text-primary underline-offset-4 hover:underline"
            >
              ogbot.co.uk
            </a>
            . It applies whether you use the website or the installed Android or iOS app. Last
            updated: 28 September 2026.
          </p>
        </header>

        <div className="landing-grid">
          <Section icon={UserCheck} title="1. Who we are &amp; how to contact us">
            <p>
              OG BOT is operated by the OG Studio team. For any privacy question, request, or
              complaint, contact us at{" "}
              <a
                href="mailto:ogbot196@gmail.com"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                ogbot196@gmail.com
              </a>
              . We aim to respond to privacy requests within 30 days.
            </p>
          </Section>

          <Section icon={Database} title="2. Information we collect">
            <p>
              <strong className="text-foreground">Account data:</strong> when you sign in, we
              receive your email address and a unique account identifier needed to keep your account
              linked and synchronised. We never see or store your provider password.
            </p>
            <p>
              <strong className="text-foreground">Content you create:</strong> prompts, song titles,
              descriptions, lyrics, generated audio tracks, and your style, language, and
              language-content preferences (including parental-guidance and explicit-content
              settings).
            </p>
            <p>
              <strong className="text-foreground">Coins &amp; payments:</strong> an in-app coin
              balance and transaction ledger records generations, unlocks, referral rewards, and
              purchases. Card payments are processed by Stripe; we receive your email, purchase
              amount, and payment status — never your full card number.
            </p>
            <p>
              <strong className="text-foreground">Minimal account security data:</strong> sign-in
              timestamps and a random first-party device token used only to limit free-account
              abuse. We do not collect precise location, IP-based location, contacts, advertising
              IDs, full device fingerprints, browsing history, or page-by-page activity.
            </p>
            <p>
              <strong className="text-foreground">Messages:</strong> chats you send to the OG Bot
              assistant and Battle Zone, and messages you send through the Telegram bot if you
              connect it.
            </p>
          </Section>

          <Section icon={Share2} title="3. How we use information &amp; who we share it with">
            <p>
              We use your data to operate the app: generating lyrics and audio, storing your
              library, maintaining balances and purchases, providing support, and preventing abuse
              (such as free-credit farming).
            </p>
            <p>
              We share data only with providers needed to run the service, each receiving only what
              its task requires:
            </p>
            <ul className="ml-5 list-disc space-y-1">
              <li>
                <strong className="text-foreground">Google &amp; Apple</strong> — sign-in (OAuth)
                and account identity.
              </li>
              <li>
                <strong className="text-foreground">Managed Postgres backend</strong> — accounts,
                songs, coins, and settings storage.
              </li>
              <li>
                <strong className="text-foreground">AI gateway (Gemini)</strong> — lyric writing,
                bot replies, and moderation.
              </li>
              <li>
                <strong className="text-foreground">Music-generation API (Suno)</strong> — turning
                lyrics into audio tracks.
              </li>
              <li>
                <strong className="text-foreground">Stripe</strong> — payment processing for coin
                packs, subscriptions, and track unlocks.
              </li>
              <li>
                <strong className="text-foreground">Telegram</strong> — delivering bot notifications
                and the Sports Guide invite if you purchase it.
              </li>
              <li>
                <strong className="text-foreground">Google Drive</strong> — backing up created
                tracks.
              </li>
            </ul>
            <p>
              We do not sell your personal data and we do not use cross-site advertising trackers.
            </p>
          </Section>

          <Section icon={Clock} title="4. Data retention &amp; deletion">
            <p>
              We keep your songs, ledger, and account data while your account is active. You can
              request export or deletion of your account and associated content any time by emailing{" "}
              <a
                href="mailto:ogbot196@gmail.com"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                ogbot196@gmail.com
              </a>
              . Deletion requests are actioned within 30 days, except records we must retain for
              tax, fraud prevention, or legal reasons (for example payment history).
            </p>
          </Section>

          <Section icon={ShieldCheck} title="5. Security &amp; your controls">
            <p>
              Data is protected in transit with HTTPS/TLS and at rest behind row-level security so
              one account cannot read another&apos;s records. Privileged actions are gated by
              server-side role checks, never by anything stored in your browser.
            </p>
            <p>
              Your controls: sign out at any time, keep tracks private or publish them to the community
              player (your choice per track), connect or disconnect Telegram, and adjust
              explicit-content and foul-language settings in the creation wizard. You are
              responsible for keeping your sign-in provider account secure.
            </p>
          </Section>

          <Section icon={Database} title="6. Children &amp; content ratings">
            <p>
              OG BOT is not directed at children under 13. The app supports a parental-guidance
              (&quot;PG&quot;) mode that produces clean lyrics, and an 18+ mode for explicit content
              that is restricted by in-app settings. Accounts used by children should remain in PG
              mode.
            </p>
          </Section>

          <Section icon={Cookie} title="7. Cookies &amp; local storage">
            <p>
              We use first-party browser storage to keep you signed in, remember preferences (such
              as bot mode and playback state), and keep a random app token for free-account limits.
              No third-party advertising cookies are used.
            </p>
          </Section>

          <Section icon={Mail} title="8. Changes to this policy">
            <p>
              We may update this policy as the app evolves. Material changes will be announced in
              the app or on this page with a new &quot;last updated&quot; date. Continued use after
              an update means you accept the revised policy.
            </p>
          </Section>
        </div>

        <p className="text-sm text-muted-foreground sm:text-base">
          Questions about anything above? Email{" "}
          <a
            href="mailto:ogbot196@gmail.com"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            ogbot196@gmail.com
          </a>
          .
        </p>
      </div>
    </div>
  );
}
