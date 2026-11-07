import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C } from "../theme";
import { body, display } from "./Type";

/**
 * Spring-based impact camera shake. Each entry in `hits` is a frame where a
 * punch lands (a beat drop, a punchline). A stiff, well-damped spring gives a
 * sharp kick that settles fast, and the envelope (1 − spring) multiplies a
 * couple of fast sine waves so the frame jolts then rings down. GPU-only
 * (translate3d + rotate), so it stays at 60fps.
 */
export function useCameraShake(
  hits: number[],
  opts: { amp?: number; decayFrames?: number } = {},
): { x: number; y: number; rotate: number } {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const amp = opts.amp ?? 16;
  const decay = opts.decayFrames ?? 16;
  let env = 0;
  for (const h of hits) {
    if (f >= h && f < h + decay) {
      const s = spring({ frame: f - h, fps, config: { damping: 11, stiffness: 460, mass: 0.7 } });
      env = Math.max(env, 1 - s);
    }
  }
  return {
    x: Math.sin(f * 2.35) * amp * env,
    y: Math.cos(f * 3.1) * amp * 0.66 * env,
    rotate: Math.sin(f * 1.7) * 0.7 * env,
  };
}

/** translate3d + rotate string for a shake, applied to a scene's inner wrapper. */
export const shakeTransform = (s: { x: number; y: number; rotate: number }) =>
  `translate3d(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px, 0) rotate(${s.rotate.toFixed(2)}deg)`;

/**
 * Chromatic-aberration / RGB-split glitch pop. For `frames` frames from each
 * frame in `at`, the content gets a red + cyan edge split (2–4px) and a hair
 * of horizontal jitter, decaying to nothing. Kept cheap with a single
 * drop-shadow filter so it never drops frames on a scene transition.
 */
export const Glitch: React.FC<{
  at: number[];
  frames?: number;
  amp?: number;
  children: React.ReactNode;
}> = ({ at, frames = 5, amp = 4, children }) => {
  const f = useCurrentFrame();
  const start = at.find((a) => f >= a && f < a + frames);
  if (start === undefined) return <>{children}</>;
  const k = 1 - (f - start) / frames; // 1 → 0 across the pop
  const dx = amp * k;
  const jitter = (((f - start) % 2 === 0 ? 1 : -1) * amp * k) / 2;
  // Must fill the frame: `transform` makes this the containing block for the
  // absolutely-positioned scene inside, so a zero-size wrapper would collapse it.
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: `translate3d(${jitter.toFixed(2)}px, 0, 0)`,
        filter: `drop-shadow(${dx.toFixed(2)}px 0 0 ${C.red}cc) drop-shadow(${(-dx).toFixed(2)}px 0 0 ${C.teal}cc)`,
        willChange: "transform, filter",
      }}
    >
      {children}
    </div>
  );
};

export const Eyebrow: React.FC<{ children: React.ReactNode; delay?: number; red?: boolean }> = ({
  children,
  delay = 0,
  red = false,
}) => {
  const f = useCurrentFrame();
  const o = interpolate(f - delay, [0, 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        fontFamily: body,
        fontWeight: 700,
        fontSize: 27,
        letterSpacing: 7,
        textTransform: "uppercase",
        color: red ? C.red : C.blueSoft,
        opacity: o,
        transform: `translateY(${(1 - o) * 24}px)`,
      }}
    >
      {children}
    </div>
  );
};
export const BigWords: React.FC<{
  lines: string[];
  accent?: number[];
  delay?: number;
  size?: number;
  align?: "left" | "center";
}> = ({ lines, accent = [], delay = 0, size = 120, align = "left" }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        textAlign: align,
        gap: 0,
      }}
    >
      {lines.map((line, i) => {
        const s = spring({
          frame: f - delay - i * 7,
          fps,
          config: { damping: 16, stiffness: 170 },
        });
        return (
          <div
            key={line}
            style={{
              fontFamily: display,
              fontSize: size,
              lineHeight: 0.92,
              color: accent.includes(i) ? C.blueSoft : C.white,
              textShadow: accent.includes(i) ? `0 0 42px ${C.blue}` : "0 10px 28px #000a",
              opacity: interpolate(s, [0, 0.25], [0, 1], { extrapolateRight: "clamp" }),
              transform: `translateX(${interpolate(s, [0, 1], [i % 2 ? -90 : 90, 0])}px) scale(${interpolate(s, [0, 1], [0.82, 1])})`,
            }}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
};
export const Spectrum: React.FC<{ red?: boolean; height?: number }> = ({
  red = false,
  height = 190,
}) => {
  const f = useCurrentFrame();
  const bars = 38;
  const tint = red ? C.red : C.blue;
  const cap = red ? C.white : C.silver;
  return (
    <div
      style={{
        position: "absolute",
        left: 42,
        right: 42,
        bottom: 0,
        height,
        display: "flex",
        gap: 8,
        alignItems: "flex-end",
        opacity: 0.6,
      }}
    >
      {Array.from({ length: bars }, (_, i) => {
        // Live level, plus a slower-falling peak-hold that sits above it.
        const h = 0.16 + 0.84 * Math.abs(Math.sin(f / 5 + i * 0.71) * Math.cos(f / 13 + i * 0.29));
        const peak = 0.2 + 0.8 * Math.abs(Math.sin(f / 22 + i * 0.71));
        const held = Math.max(h, peak * 0.92);
        const crest = Math.max(0, h - 0.68) / 0.32; // glow harder near the top
        return (
          <div key={i} style={{ position: "relative", flex: 1, height: "100%" }}>
            {/* peak-hold tick */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: `${held * 100}%`,
                height: 3,
                borderRadius: 3,
                background: cap,
                opacity: 0.8,
                boxShadow: `0 0 8px ${tint}`,
              }}
            />
            {/* tiered EQ bar with rounded caps + crest glow */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                height: `${h * 100}%`,
                borderRadius: 999,
                background: `linear-gradient(180deg, ${cap}, ${tint} 45%, ${red ? "#871622" : C.ink2})`,
                boxShadow: `0 0 ${(10 + crest * 22).toFixed(1)}px ${tint}${crest > 0.5 ? "aa" : "66"}`,
              }}
            />
          </div>
        );
      })}
    </div>
  );
};
export const Counter: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      position: "absolute",
      top: 56,
      right: 54,
      fontFamily: body,
      fontSize: 23,
      letterSpacing: 4,
      color: C.muted,
    }}
  >
    {text}
  </div>
);
