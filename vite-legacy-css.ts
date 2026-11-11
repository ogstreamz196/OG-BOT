// Older browsers (many smart TVs, car screens and phones from before 2022)
// don't understand CSS cascade layers or oklch colours, so they skip the whole
// stylesheet and show bare text and images with no wallpaper. This build step
// writes a second copy of the stylesheet with the layers unwrapped (in layer
// order, unlayered rules last) and newer syntax lowered for old engines. Only
// browsers without layer support load it (src/lib/legacy-css-loader.ts), so modern
// browsers are unaffected.
import type { Plugin } from "vite";
import { transform } from "lightningcss";

/** Index just past the `}` that closes the block opening at `open` (a `{`). */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "/" && css[i + 1] === "*") i = css.indexOf("*/", i + 2) + 1 || css.length;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i + 1;
  }
  return css.length;
}

/** Unwraps top-level `@layer` blocks: layers in declared order, then unlayered rules. */
export function flattenLayers(css: string): string {
  const order: string[] = [];
  const layers = new Map<string, string[]>();
  const unlayered: string[] = [];
  const note = (name: string) => {
    if (!layers.has(name)) {
      layers.set(name, []);
      order.push(name);
    }
  };
  const re = /@layer\s*([^{;]*)([{;])/g;
  let pos = 0;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    // Only top-level layer rules: skip matches inside a block already taken.
    if (m.index < pos) continue;
    unlayered.push(css.slice(pos, m.index));
    const names = m[1]
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    if (m[2] === ";") {
      names.forEach(note);
      pos = m.index + m[0].length;
    } else {
      const open = m.index + m[0].length - 1;
      const end = blockEnd(css, open);
      const name = names[0] ?? `anon${order.length}`;
      note(name);
      // A nested layer inside keeps its rules in place, unwrapped.
      layers.get(name)!.push(flattenLayers(css.slice(open + 1, end - 1)));
      pos = end;
    }
    re.lastIndex = pos;
  }
  unlayered.push(css.slice(pos));
  return [...order.flatMap((n) => layers.get(n)!), ...unlayered].join("");
}

/** Oldest engines we still style: Chrome/WebView 69, Safari 12, Firefox 68. */
const OLD_TARGETS = { chrome: 69 << 16, safari: 12 << 16, firefox: 68 << 16 };

export function legacyCss(css: string): string {
  const { code } = transform({
    filename: "legacy.css",
    code: Buffer.from(flattenLayers(css)),
    minify: true,
    errorRecovery: true,
    targets: OLD_TARGETS,
  });
  return code.toString();
}

/** Emits assets/styles-<hash>.legacy.css next to each built stylesheet. */
export function legacyCssPlugin(): Plugin {
  return {
    name: "og-legacy-css",
    apply: "build",
    generateBundle(_, bundle) {
      for (const [fileName, out] of Object.entries(bundle)) {
        if (out.type !== "asset" || !/(^|\/)styles-[^/]+\.css$/.test(fileName)) continue;
        this.emitFile({
          type: "asset",
          fileName: fileName.replace(/\.css$/, ".legacy.css"),
          source: legacyCss(String(out.source)),
        });
      }
    },
  };
}
