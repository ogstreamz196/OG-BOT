import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Lock, Database, Cookie, Mail, UserCheck } from "lucide-react";

export const Route = createFileRoute("/trust")({
  component: TrustPage,
  head: () => ({
    meta: [
      { title: "Trust & Privacy — OG Studio" },
      {
        name: "description",
        content:
          "How OG Studio handles your account, songs, and personal data. Maintained by the OG Studio team.",
      },
      { property: "og:title", content: "Trust & Privacy — OG Studio" },
      {
        property: "og:description",
        content:
          "Security, privacy, data handling, subprocessors, cookies, and how to contact the OG Studio team.",
      },
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

function TrustPage() {
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
            Trust &amp; Privacy
          </h1>
          <p className="max-w-3xl text-lg leading-relaxed text-muted-foreground">
            This page is maintained by the OG Studio team to answer common security and privacy
            questions about OG Studio. It describes the app-visible controls we enable today and is
            not an independent certification or audit.
          </p>
        </header>

        <div className="landing-grid">
          <Section icon={UserCheck} title="Accounts &amp; authentication">
            <p>
              You sign in with Google or Apple via secure OAuth — OG Studio never sees or stores
              your provider password. Your session is held in your browser and can be ended at any
              time by signing out.
            </p>
            <p>
              Privileged actions (admin tools, role grants, coin balance changes) are gated server
              side by role checks, not by anything stored in your browser.
            </p>
          </Section>

          <Section icon={Lock} title="Data protection">
            <p>
              Songs, lyrics, preferences and coin balances are stored per-user behind row-level
              security so one account cannot read another account's records. Internal bot
              configuration and admin tooling are restricted to signed-in users and admin roles.
            </p>
            <p>
              Transport is encrypted with HTTPS/TLS end-to-end between your device, our app, and our
              backend.
            </p>
          </Section>

          <Section icon={Database} title="What we collect &amp; how it's used">
            <p>
              We collect the minimum needed to run the app: your email and display name from the
              identity provider you choose, the prompts and songs you create, your in-app
              preferences, and a coin/transaction ledger to power generations and referrals. We do
              not collect location, IP-based location, contacts, advertising IDs, full device
              fingerprints, or page-by-page activity, and we do not sell personal data.
            </p>
            <p>
              You can request deletion of your account and associated content by emailing the
              address below.
            </p>
          </Section>

          <Section icon={ShieldCheck} title="Subprocessors &amp; integrations">
            <p>
              OG Studio uses a small set of trusted providers to operate: a managed Postgres backend
              with auth and storage, an AI gateway for lyrics and persona responses, a
              music-generation API for audio, and optional payment and analytics partners. Each
              provider only receives the data needed to perform its specific task.
            </p>
          </Section>

          <Section icon={Cookie} title="Cookies, storage &amp; analytics">
            <p>
              We use first-party browser storage to keep you signed in and remember preferences such
              as your OG bot mode. We do not use cross-site advertising trackers.
            </p>
          </Section>

          <Section icon={Mail} title="Contact, requests &amp; vulnerability reports">
            <p>
              For privacy requests (access, export, deletion) or to report a suspected security
              issue, email{" "}
              <a
                href="mailto:ogbot196@gmail.com"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                ogbot196@gmail.com
              </a>
              . Please include enough detail to reproduce the issue and avoid testing against other
              users' data.
            </p>
          </Section>
        </div>

        <p className="text-sm text-muted-foreground sm:text-base">
          Shared responsibility: OG Studio provides app-level controls described above; the
          underlying hosting platform provides the infrastructure they run on. You're responsible
          for keeping your sign-in provider account and device secure. See also our full{" "}
          <Link
            to="/policy"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
