import { createFileRoute, Link } from "@tanstack/react-router";
import { Mic2, Flame, Coins, Music2, Sparkles, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/styles/rap")({
  component: RapLandingPage,
  head: () => ({
    meta: [
      { title: "AI Rap Generator — Cook Drill, Grime & Diss Tracks | 0G B0T" },
      {
        name: "description",
        content:
          "0G B0T's AI rap generator turns your idea into a full rap track with real vocals and cover art. UK drill, grime, trap, boom-bap and foul-mouth diss tracks — battle the bot, then let it cook.",
      },
      { property: "og:title", content: "AI Rap Generator — Cook Drill, Grime & Diss Tracks | 0G B0T" },
      {
        property: "og:description",
        content:
          "Type an idea, get a full rap track with vocals and cover art. Drill, grime, trap, boom-bap and foul-mouth diss tracks.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://ogbot.co.uk/styles/rap" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: "https://ogbot.co.uk/styles/rap" }],
  }),
});

const styles = [
  { name: "UK Drill", desc: "Sliding 808s, dark melodies, street energy." },
  { name: "Grime", desc: "140 BPM, raw bars, proper London flavour." },
  { name: "Trap", desc: "Heavy hi-hats and hard-hitting hooks." },
  { name: "Boom-Bap", desc: "Old-school head-nod beats with sharp lyricism." },
  { name: "Diss Tracks", desc: "Foul-mouth smoke aimed at whoever you name." },
];

const steps = [
  {
    icon: Sparkles,
    title: "Drop your idea",
    desc: "A name, a story, a grudge — anything. The wizard turns it into bars.",
  },
  {
    icon: Mic2,
    title: "0G B0T writes the bars",
    desc: "Pick your style and heat level, from clean to full foul-mouth Savage mode.",
  },
  {
    icon: Music2,
    title: "Get the full track",
    desc: "Real vocals, a beat, and cover art — saved to your library, ready to share.",
  },
];

function RapLandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-4 py-5">
        <Link to="/welcome" className="text-lg font-bold tracking-tight">
          0G B0T
        </Link>
        <Button asChild size="sm">
          <Link to="/welcome">Start free</Link>
        </Button>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-20">
        <section className="py-12 text-center">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            <Flame className="h-3.5 w-3.5 text-destructive" /> Free to try
          </p>
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            AI Rap Generator that actually spits
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Type an idea and 0G B0T cooks a full rap track — real vocals, a hard beat and
            cover art. UK drill, grime, trap, boom-bap, or a foul-mouth diss track aimed at
            whoever's asking for it.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link to="/welcome">Generate a rap track</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <Link to="/welcome">
                <Swords className="mr-2 h-4 w-4" /> Battle 0G B0T first
              </Link>
            </Button>
          </div>
        </section>

        <section className="py-10">
          <h2 className="text-center text-2xl font-bold">Rap styles it cooks</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {styles.map((s) => (
              <div key={s.name} className="rounded-xl border border-border bg-card p-5">
                <h3 className="font-semibold">{s.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-10">
          <h2 className="text-center text-2xl font-bold">How the AI rap generator works</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {steps.map((step, i) => (
              <div key={step.title} className="rounded-xl border border-border bg-card p-5">
                <step.icon className="h-6 w-6 text-primary" />
                <h3 className="mt-3 font-semibold">
                  {i + 1}. {step.title}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-8 text-center">
          <Coins className="mx-auto h-8 w-8 text-primary" />
          <h2 className="mt-3 text-2xl font-bold">Earn OG Coins while you're at it</h2>
          <p className="mx-auto mt-2 max-w-xl text-muted-foreground">
            Battle 0G B0T in the Battle Zone, grab daily drops and earn lifetime referral
            commission — coins you can spend on more tracks. 2 tracks for the price of 1 on
            your first unlock.
          </p>
          <Button asChild size="lg" className="mt-6">
            <Link to="/welcome">Cook your first rap</Link>
          </Button>
        </section>
      </main>
    </div>
  );
}
