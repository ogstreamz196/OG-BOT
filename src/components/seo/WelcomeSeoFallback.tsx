/**
 * Server-rendered stand-in for /welcome. The real landing page runs only in
 * the browser, so without this, search engines and AI tools that don't run
 * JavaScript saw an empty page. The wording is copied from the landing page
 * itself, and the browser swaps this out for the real page as soon as it loads.
 */
export function WelcomeSeoFallback() {
  return (
    <main className="mx-auto min-h-dvh max-w-3xl bg-background px-4 py-10 text-foreground">
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
        <p className="text-muted-foreground">
          Beast OG Bot is live. Come with your best bars, challenge the bot and turn the heat into a
          battle.
        </p>
        <h3 className="mt-3 font-semibold">Music Hub</h3>
        <p className="text-muted-foreground">
          Create, remix and release your sound. Turn your ideas into tracks with AI-powered music
          creation.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-bold">More from OG Bot</h2>
        <h3 className="mt-3 font-semibold">Sports Guide</h3>
        <p className="text-muted-foreground">
          Live daily fixtures, fight cards and TV listings — search any team instantly.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-bold">Your superpowers</h2>
        <h3 className="mt-3 font-semibold">The Roast &amp; Diss Engine</h3>
        <p className="text-muted-foreground">
          Battle Zone, Foul Mouth from Mild to Demon, and personal diss tracks cooked from your own
          chat — if you can handle it.
        </p>
        <h3 className="mt-3 font-semibold">The Hit-Making Studio</h3>
        <p className="text-muted-foreground">
          Real vocals and cover art on every track. 2 tracks for the price of 1, and 15 days of free
          VIP unlocks every style.
        </p>
        <h3 className="mt-3 font-semibold">The Creator Economy</h3>
        <p className="text-muted-foreground">
          Earn OG Coins for roasting the bot, claim a daily drop, and get lifetime commission when
          friends spend. Telegram keeps you posted.
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
    </main>
  );
}
