import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
describe("web install and explicit lyric preservation", () => {
  it("places Install now before page content and excludes native/standalone apps", () => {
    const root = read("src/routes/__root.tsx");
    const prompt = read("src/components/InstallAppPrompt.tsx");
    expect(root.indexOf("<InstallAppPrompt />")).toBeLessThan(root.indexOf("<Outlet />"));
    expect(prompt).toContain("Capacitor.isNativePlatform() || isStandalone()");
    expect(prompt).toContain("Install now");
    expect(prompt).not.toContain("fixed inset-x");
  });
  it("does not silently soften music payloads after moderation rejection", () => {
    const suno = read("supabase/functions/suno-generate/index.ts");
    expect(suno).not.toContain("softenForModeration");
    expect(suno).toContain("submit(signedLyrics, signedPrompt, style)");
    expect(suno).toContain("isModerationRejection(reason) ? MODERATION_MESSAGE");
  });
});