import { useEffect, useRef, useState } from "react";

export type KeyboardPin = { top: number; height: number };

/**
 * Measures the element's distance from the top of the viewport and returns the
 * exact remaining height, so a panel always fits the device browser page —
 * no page scroll, no floating window, whatever chrome sits above it.
 *
 * While a phone keyboard is open, browsers disagree on what happens (some
 * resize, some pan the page, in-app WebViews often ignore the viewport hint).
 * So on touch devices we also return `pin`: the exact visible rectangle. The
 * caller pins the panel there with position:fixed, which keeps the header and
 * composer on screen regardless of how the browser handles the keyboard.
 */
export function useFillViewport<T extends HTMLElement>(bottomGutter = 0) {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [pin, setPin] = useState<KeyboardPin | null>(null);

  useEffect(() => {
    let frame = 0;
    let last = -1;
    let lastPin: KeyboardPin | null = null;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;

    function compute() {
      const el = ref.current;
      if (!el) return;
      const vv = window.visualViewport;
      const vh = vv?.height ?? window.innerHeight;
      const keyboardOpen =
        document.documentElement.dataset["kb"] === "1" ||
        (vv ? window.innerHeight - vv.height > 120 : false);

      // Touch keyboard open → pin to the visible rectangle.
      if (coarse && keyboardOpen) {
        const next = { top: Math.round(vv?.offsetTop ?? 0), height: Math.round(vh) };
        if (
          !lastPin ||
          Math.abs(lastPin.top - next.top) > 2 ||
          Math.abs(lastPin.height - next.height) > 2
        ) {
          lastPin = next;
          setPin(next);
        }
        return;
      }
      if (lastPin) {
        lastPin = null;
        setPin(null);
        last = -1;
      }

      // getBoundingClientRect() is in layout-viewport coordinates; shift by
      // the visual viewport offset so the panel never overshoots the screen.
      const top = el.getBoundingClientRect().top - (vv?.offsetTop ?? 0);
      const nav = document.querySelector("nav.safe-bottom.fixed") as HTMLElement | null;
      const limit =
        nav && nav.offsetHeight > 0 ? nav.getBoundingClientRect().top - (vv?.offsetTop ?? 0) : vh;
      const availableHeight = Math.round(Math.min(limit, vh) - top - bottomGutter);
      const next = Math.max(keyboardOpen ? 140 : 280, availableHeight);
      if (last >= 0 && Math.abs(next - last) < 8) return;
      last = next;
      setHeight(next);
    }

    function measure() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        compute();
      });
    }

    // Keyboard slide-in: measure now and again as the animation settles.
    let settles: number[] = [];
    function measureSettled() {
      measure();
      settles.forEach(clearTimeout);
      settles = [150, 350, 700].map((ms) => window.setTimeout(measure, ms));
    }

    compute();
    const timers = [60, 250, 800].map((ms) => window.setTimeout(measure, ms));
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("resize", measureSettled);
    window.addEventListener("orientationchange", measure);
    window.addEventListener("pageshow", measure);
    window.addEventListener("og:kb", measureSettled);
    window.visualViewport?.addEventListener("resize", measureSettled);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      settles.forEach(clearTimeout);
      timers.forEach(clearTimeout);
      ro.disconnect();
      window.removeEventListener("resize", measureSettled);
      window.removeEventListener("orientationchange", measure);
      window.removeEventListener("pageshow", measure);
      window.removeEventListener("og:kb", measureSettled);
      window.visualViewport?.removeEventListener("resize", measureSettled);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [bottomGutter]);

  return { ref, height, pin };
}
