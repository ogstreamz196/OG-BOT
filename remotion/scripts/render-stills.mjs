import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import path from "path";
import { fileURLToPath } from "url";
const root = path.dirname(fileURLToPath(import.meta.url));
const serveUrl = await bundle({
  entryPoint: path.resolve(root, "../src/index.ts"),
  webpackOverride: (c) => c,
});
const browser = await openBrowser("chrome", {
  browserExecutable: "/bin/chromium",
  chromiumOptions: { args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] },
  chromeMode: "chrome-for-testing",
});
const composition = await selectComposition({ serveUrl, id: "main", puppeteerInstance: browser });
for (const [frame, name] of [
  [430, "creation"],
  [740, "language"],
  [1050, "battle"],
  [1360, "finished"],
  [1660, "end"],
])
  await renderStill({
    composition,
    serveUrl,
    output: `/tmp/promo-checks/${name}.png`,
    frame,
    puppeteerInstance: browser,
  });
await browser.close({ silent: false });
