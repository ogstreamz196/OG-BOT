import masterLogo from "@/assets/og-bot-master-logo.webp";

/**
 * Server-rendered stand-in for /welcome while the real page loads.
 *
 * People see a calm branded loading screen (the OG BOT logo, gently glowing).
 * Below it, out of the first screen but not hidden, is the landing-page copy
 * that search engines and AI tools read, since the real page only renders in
 * the browser. The browser swaps all of this for the real page once it loads.
 */
export function WelcomeSeoFallback() {
  return (
    <main className="min-h-dvh bg-card text-foreground">
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6"
      >
        <img
          src={masterLogo}
          alt="OG BOT"
          width={1607}
          height={1275}
          fetchPriority="high"
          className="h-auto w-[min(15rem,62vw)] drop-shadow-[0_0_28px_var(--color-primary)] [mask-image:radial-gradient(ellipse_at_center,black_45%,transparent_74%)] motion-safe:animate-pulse motion-safe:[animation-duration:2.6s]"
        />
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
          Loading…
        </p>
      </div>

      <div className="mx-auto max-w-3xl px-4 pb-10">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-primary">
          OG Streamz · Powered by OG Bot
        </p>
        <h1 className="mt-3 font-display text-3xl sm:text-5xl">
          Roast the bot. Drop the diss. Or cook a hit.
        </h1>
        <p className="mt-3 text-muted-foreground">
          Step into the world of OG Bot. Enter the battle, create your sound and unleash your
          creativity. Your ideas. Your rules. No limits.
        </p>
        <ul className="mt-3 flex flex-wrap gap-3 text-sm">
          <li>Real vocals</li>
          <li>Album cover</li>
          <li>Foul Mouth mode</li>
        </ul>

        <section className="mt-8">
          <h2 className="text-xl font-bold">Choose your mode</h2>
          <h3 className="mt-3 font-semibold">Battle Zone</h3>
          <p className="text-muted-foreground">Roast OG Bot. Bank coins for every hit.</p>
          <h3 className="mt-3 font-semibold">Music Hub</h3>
          <p className="text-muted-foreground">Your idea. Real vocals. Cover art. Done.</p>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-bold">More from OG Bot</h2>
          <h3 className="mt-3 font-semibold">Sports Guide</h3>
          <p className="text-muted-foreground">
            Live daily fixtures, fight cards and TV listings — search any team instantly.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-bold">Unleash your OG powers</h2>
          <h3 className="mt-3 font-semibold">Roast &amp; Destroy</h3>
          <p className="text-muted-foreground">
            Enter the Battle Zone. Unleash savage roasts, brutal comebacks and personalised diss
            tracks.
          </p>
          <h3 className="mt-3 font-semibold">OG Hit Factory</h3>
          <p className="text-muted-foreground">
            Turn your ideas into personalised tracks with real vocals, custom cover art and
            unlimited creativity.
          </p>
          <h3 className="mt-3 font-semibold">Earn OG Rewards</h3>
          <p className="text-muted-foreground">
            Collect OG Coins, claim daily rewards and earn lifetime referral commissions.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-bold">Your next prompt could be a hit.</h2>
          <p className="text-muted-foreground">
            Free account in seconds · 15 days of VIP on us · No card needed.
          </p>
        </section>

        <nav className="mt-8 flex flex-wrap gap-4 text-sm underline">
          <a href="/terms">Terms of Use</a>
          <a href="/policy">Privacy Policy</a>
          <a href="/trust">Trust &amp; Privacy</a>
          <a href="/styles/rap">AI rap generator</a>
        </nav>
      </div>
    </main>
  );
}
