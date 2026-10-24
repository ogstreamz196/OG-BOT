import { toast } from "sonner";

/**
 * Build a 9:16 "lyric card" image for a finished track and open the device
 * share sheet with it. Everything is drawn on a canvas in the browser, so no
 * server work, no storage and no extra cost per share.
 *
 * Falls back to a plain download when the device cannot share files.
 */

const W = 1080;
const H = 1920;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines;
}

export function drawLyricCard(
  canvas: HTMLCanvasElement,
  opts: { title: string; lyrics?: string | null; style?: string | null; referralUrl: string },
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = W;
  canvas.height = H;

  // Dark red-drip backdrop
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#150407");
  bg.addColorStop(0.55, "#2a0710");
  bg.addColorStop(1, "#0a0305");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W / 2, H * 0.32, 40, W / 2, H * 0.32, W * 0.9);
  glow.addColorStop(0, "rgba(220,38,38,0.35)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = "center";

  // Brand
  ctx.fillStyle = "#ff3b45";
  ctx.font = "900 46px system-ui, sans-serif";
  ctx.fillText("0G B0T", W / 2, 170);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "600 28px system-ui, sans-serif";
  ctx.fillText("AI MUSIC · OGSTREAMZ", W / 2, 215);

  // Title
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 78px system-ui, sans-serif";
  const titleLines = wrap(ctx, opts.title || "Untitled", W - 160, 3);
  let y = 520;
  for (const line of titleLines) {
    ctx.fillText(line, W / 2, y);
    y += 92;
  }

  if (opts.style) {
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "700 34px system-ui, sans-serif";
    ctx.fillText(opts.style.toUpperCase(), W / 2, y + 20);
  }

  // Lyric snippet
  const snippet = (opts.lyrics || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (snippet) {
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "italic 600 46px system-ui, sans-serif";
    const lines = wrap(ctx, snippet, W - 200, 6);
    let ly = 900;
    for (const line of lines) {
      ctx.fillText(line, W / 2, ly);
      ly += 66;
    }
  }

  // Footer / referral
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "700 34px system-ui, sans-serif";
  ctx.fillText("Make your own track free", W / 2, H - 230);
  ctx.fillStyle = "#ff3b45";
  ctx.font = "900 40px system-ui, sans-serif";
  ctx.fillText(opts.referralUrl.replace(/^https?:\/\//, ""), W / 2, H - 170);
}

export async function shareLyricClip(opts: {
  title: string;
  lyrics?: string | null;
  style?: string | null;
  referralUrl: string;
}): Promise<void> {
  if (typeof document === "undefined") return;
  const canvas = document.createElement("canvas");
  drawLyricCard(canvas, opts);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );
  if (!blob) {
    toast.error("Couldn't create the share card");
    return;
  }

  const filename = `${(opts.title || "og-track").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-ogbot.png`;
  const file = new File([blob], filename, { type: "image/png" });
  const text = `🎧 "${opts.title}" — made with 0G B0T`;
  const nav = typeof navigator !== "undefined" ? navigator : undefined;

  try {
    if (nav?.share && typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], title: opts.title, text });
      return;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast.success("Share card saved — post it anywhere");
}
