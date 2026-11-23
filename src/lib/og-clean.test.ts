import { describe, expect, it } from "vitest";
import { maskSwears } from "./og-clean";

describe("maskSwears (clean-mode safety net)", () => {
  it("masks strong words, keeping the first letter and any ending", () => {
    expect(maskSwears("What the fuck, you absolute twat")).toBe("What the f••k, you absolute t••t");
    expect(maskSwears("Fucking hell, that's SHIT")).toBe("F••king hell, that's S••T");
    expect(maskSwears("bollocks to that, bastards")).toBe("b•••••ks to that, b•••••ds");
  });
  it("leaves clean words and place names alone", () => {
    const clean = "Scunthorpe, Essex, a cocktail, shiitake, assessment, classic, pissed off";
    expect(maskSwears(clean)).toBe(clean);
  });
  it("never adds Markdown asterisks (the website renders replies as Markdown)", () => {
    expect(maskSwears("fuck this shit")).not.toContain("*");
  });
  it("leaves a clean reply exactly as it was", () => {
    const t = "Oi oi! Your coins landed, mate. Go cook a banger.";
    expect(maskSwears(t)).toBe(t);
  });
});
