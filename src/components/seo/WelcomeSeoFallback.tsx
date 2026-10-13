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
        Turn any idea into a hit in seconds.
      </h1>
      <p className="mt-3 text-muted-foreground">
        Drill, afrobeats, pop or savage roasts — your words, real vocals, cover art included.
      </p>
      <ul className="mt-3 flex flex-wrap gap-3 text-sm">
        <li>Real vocals</li>
        <li>Album cover</li>
        <li>Foul Mouth mode</li>
      </ul>

      <section className="mt-8">
        <h2 className="text-xl font-bold">Your superpowers</h2>
        <h3 className="mt-3 font-semibold">Foul Mouth Mode</h3>
        <p className="text-muted-foreground">
          Beast bot roasts, raw bars, full foul-mouth diss tracks cooked from your words. Turn the
          heat from Mild to Demon.
        </p>
        <h3 className="mt-3 font-semibold">2 tracks for the price of 1</h3>
        <p className="text-muted-foreground">
          Unlock your first take and the second one is yours free.
        </p>
        <h3 className="mt-3 font-semibold">15 days of free VIP</h3>
        <p className="text-muted-foreground">
          Every style unlocked from signup — drill, bhangra, afrobeats and more.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-bold">3 taps to your first track</h2>
        <ol className="mt-2 space-y-2">
          <li>
            <h3 className="font-semibold">Type your idea</h3>
            <p className="text-muted-foreground">A name, a roast, a memory.</p>
          </li>
          <li>
            <h3 className="font-semibold">Pick the vibe</h3>
            <p className="text-muted-foreground">Choose a style and mood.</p>
          </li>
          <li>
            <h3 className="font-semibold">OG Bot cooks it</h3>
            <p className="text-muted-foreground">Your song + cover, ready to play.</p>
          </li>
        </ol>
      </section>

      <section className="mt-8">
        <h2 className="text-xl font-bold">Make tracks without spending a penny</h2>
        <h3 className="mt-3 font-semibold">Battle the bot</h3>
        <p className="text-muted-foreground">
          Land your best roasts in Battle Zone and earn OG Coins every round.
        </p>
        <h3 className="mt-3 font-semibold">Lifetime referral commission</h3>
        <p className="text-muted-foreground">
          Share your link — earn coins every time your friends spend, for life.
        </p>
        <h3 className="mt-3 font-semibold">Daily drop</h3>
        <p className="text-muted-foreground">Pop in each day and claim your free coin drop.</p>
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
      </nav>
    </main>
  );
}
