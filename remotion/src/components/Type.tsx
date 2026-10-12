import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { loadFont as loadDisplay } from "@remotion/google-fonts/LilitaOne";
import { loadFont as loadBody } from "@remotion/google-fonts/Unbounded";
import { C } from "../theme";

export const display = loadDisplay("normal", { weights: ["400"], subsets: ["latin"] }).fontFamily;
export const body = loadBody("normal", { weights: ["400", "700"], subsets: ["latin"] }).fontFamily;

export const Kicker: React.FC<{ children: React.ReactNode; delay?: number; color?: string }> = ({
  children,
  delay = 0,
  color = C.blueSoft,
}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame - delay, [0, 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        fontFamily: body,
        fontWeight: 700,
        fontSize: 30,
        letterSpacing: 10,
        textTransform: "uppercase",
        color,
        opacity: o,
        transform: `translateX(${interpolate(o, [0, 1], [-30, 0])}px)`,
      }}
    >
      {children}
    </div>
  );
};

/** Big display headline that snaps in word by word. */
export const Headline: React.FC<{
  words: string[];
  delay?: number;
  size?: number;
  accentIndex?: number[];
  align?: "left" | "center";
}> = ({ words, delay = 0, size = 108, accentIndex = [], align = "left" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0 22px",
        justifyContent: align === "center" ? "center" : "flex-start",
        maxWidth: 940,
      }}
    >
      {words.map((w, i) => {
        const s = spring({
          frame: frame - delay - i * 5,
          fps,
          config: { damping: 14, stiffness: 180 },
        });
        const accent = accentIndex.includes(i);
        return (
          <span
            key={i}
            style={{
              fontFamily: display,
              fontSize: size,
              lineHeight: 1.02,
              color: accent ? C.blueSoft : C.white,
              textShadow: accent
                ? `0 0 40px ${C.blue}cc, 0 6px 0 #00000055`
                : `0 6px 30px #00000099`,
              transform: `translateY(${interpolate(s, [0, 1], [70, 0])}px) scale(${interpolate(
                s,
                [0, 1],
                [0.8, 1],
              )})`,
              opacity: interpolate(s, [0, 0.35], [0, 1], { extrapolateRight: "clamp" }),
              display: "inline-block",
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};

export const Chip: React.FC<{
  label: string;
  delay?: number;
  tone?: "blue" | "silver" | "red";
}> = ({ label, delay = 0, tone = "blue" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 13, stiffness: 200 } });
  const border = tone === "red" ? C.red : tone === "silver" ? C.silver : C.blueSoft;
  return (
    <span
      style={{
        fontFamily: body,
        fontWeight: 700,
        fontSize: 34,
        padding: "14px 28px",
        borderRadius: 999,
        border: `2px solid ${border}aa`,
        color: C.white,
        background: `${border}1f`,
        boxShadow: `0 0 30px ${border}44`,
        transform: `scale(${interpolate(s, [0, 1], [0.6, 1])})`,
        opacity: interpolate(s, [0, 0.4], [0, 1], { extrapolateRight: "clamp" }),
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
};
