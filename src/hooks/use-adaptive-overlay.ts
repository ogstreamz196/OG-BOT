import { useEffect, useRef, useState } from "react";
import wallpaperUrl from "@/assets/og-bot-master-logo.webp";

/**
 * Samples the brand wallpaper behind a given element and returns an
 * overlay opacity (0..1) tuned to keep light foreground text legible.
 *
 * - Brighter / busier patches → higher opacity (darker scrim).
 * - Dark patches → lower opacity (let the wallpaper breathe).
 *
 * The wallpaper is rendered with `background-attachment: fixed` and
 * `background-size: cover`, so we mirror that math when mapping the
 * element's viewport rect into image pixel coordinates.
 */
export function useAdaptiveOverlay(
  ref: React.RefObject<HTMLElement | null>,
  { min = 0.35, max = 0.85 }: { min?: number; max?: number } = {},
) {
  const [opacity, setOpacity] = useState(min);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = wallpaperUrl;
    imgRef.current = img;

    const canvas = document.createElement("canvas");
    canvasRef.current = canvas;

    function compute() {
      const el = ref.current;
      const image = imgRef.current;
      if (!el || !image || !image.complete || image.naturalWidth === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // background-size: cover math
      const scale = Math.max(vw / image.naturalWidth, vh / image.naturalHeight);
      const drawW = image.naturalWidth * scale;
      const drawH = image.naturalHeight * scale;
      const offsetX = (vw - drawW) / 2;
      const offsetY = (vh - drawH) / 2;

      const sx = Math.max(0, (rect.left - offsetX) / scale);
      const sy = Math.max(0, (rect.top - offsetY) / scale);
      const sw = Math.min(image.naturalWidth - sx, rect.width / scale);
      const sh = Math.min(image.naturalHeight - sy, rect.height / scale);
      if (sw <= 0 || sh <= 0) return;

      const SAMPLE = 24;
      canvas.width = SAMPLE;
      canvas.height = SAMPLE;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      try {
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, SAMPLE, SAMPLE);
        const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE);
        let sum = 0;
        let sumSq = 0;
        const n = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          // relative luminance (Rec. 709)
          const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          sum += l;
          sumSq += l * l;
        }
        const mean = sum / n / 255; // 0..1
        const variance = sumSq / n / (255 * 255) - mean * mean;
        const busy = Math.min(1, Math.sqrt(Math.max(0, variance)) * 3);
        // Light text → contrast suffers when background is bright or busy.
        const need = Math.min(1, mean * 0.9 + busy * 0.5);
        const target = min + (max - min) * need;
        if (!cancelled) setOpacity(Number(target.toFixed(3)));
      } catch {
        // CORS or other read failure — fall back to the midpoint.
        if (!cancelled) setOpacity((min + max) / 2);
      }
    }

    img.onload = compute;
    if (img.complete) compute();

    const ro = new ResizeObserver(compute);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, { passive: true });
    return () => {
      cancelled = true;
      ro.disconnect();
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute);
    };
  }, [ref, min, max]);

  return opacity;
}
