/**
 * Shared dramatic backdrop used app-wide so every page inherits the
 * welcome-screen mood: layered brand blobs floating over the base background.
 * Pure decoration — fixed, behind everything, no interaction.
 */
export function WelcomeBackdrop() {
  return (
    <div aria-hidden className="og-backdrop pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="wc-blob absolute -left-32 top-10 h-[420px] w-[420px] rounded-full bg-gradient-brand opacity-30 blur-3xl" />
      <div
        className="wc-blob absolute -right-24 top-40 h-[360px] w-[360px] rounded-full bg-gradient-brand-soft opacity-40 blur-3xl"
        style={{ animationDelay: "-5s" }}
      />
      <div
        className="wc-blob absolute left-1/3 bottom-0 h-[480px] w-[480px] rounded-full bg-gradient-brand opacity-25 blur-3xl"
        style={{ animationDelay: "-9s" }}
      />
    </div>
  );
}
