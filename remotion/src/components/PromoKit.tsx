import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C } from "../theme";
import { body, display } from "./Type";

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
        opacity: 0.58,
      }}
    >
      {Array.from({ length: 38 }, (_, i) => {
        const h = 0.18 + 0.82 * Math.abs(Math.sin(f / 5 + i * 0.71) * Math.cos(f / 13 + i * 0.29));
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${h * 100}%`,
              borderRadius: 8,
              background: `linear-gradient(180deg,${red ? C.red : C.silver},${red ? "#871622" : C.blue})`,
              boxShadow: `0 0 18px ${red ? C.red : C.blue}77`,
            }}
          />
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
