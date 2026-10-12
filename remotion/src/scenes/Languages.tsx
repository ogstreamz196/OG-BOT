import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C } from "../theme";
import { BigWords, Counter, Eyebrow, Spectrum } from "../components/PromoKit";
import { body } from "../components/Type";
const langs = [
  "ENGLISH",
  "URDU",
  "PUNJABI",
  "GUJARATI",
  "TURKISH",
  "SPANISH",
  "ARABIC",
  "ROMANIAN",
  "HINDI",
  "FILIPINO",
];
export const Languages: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ padding: "104px 58px" }}>
      <Counter text="02 / LANGUAGES" />
      <Eyebrow>One track. Your voice.</Eyebrow>
      <BigWords lines={["SPEAK", "EVERY", "LANGUAGE"]} accent={[2]} delay={8} size={135} />
      <div style={{ marginTop: 66, display: "flex", flexWrap: "wrap", gap: 18 }}>
        {langs.map((x, i) => {
          const s = spring({ frame: f - 38 - i * 5, fps, config: { damping: 14, stiffness: 190 } });
          return (
            <div
              key={x}
              style={{
                fontFamily: body,
                fontWeight: 700,
                fontSize: i < 3 ? 37 : 29,
                padding: i < 3 ? "20px 28px" : "16px 23px",
                borderRadius: 8,
                color: i < 3 ? C.ink : C.white,
                background: i < 3 ? C.silver : `${i % 3 === 0 ? C.red : C.blue}b8`,
                border: `2px solid ${i < 3 ? C.white : C.blueSoft}`,
                boxShadow: i < 3 ? `0 0 38px ${C.blue}88` : "none",
                opacity: interpolate(s, [0, 0.3], [0, 1], { extrapolateRight: "clamp" }),
                transform: `scale(${interpolate(s, [0, 1], [0.65, 1])}) rotate(${i % 2 ? -2 : 2}deg)`,
              }}
            >
              {x}
            </div>
          );
        })}
      </div>
      <div
        style={{
          fontFamily: body,
          fontSize: 34,
          lineHeight: 1.45,
          color: C.silver,
          marginTop: 54,
          maxWidth: 850,
        }}
      >
        Choose one. Mix several. OG BOT writes each language into the track.
      </div>
      <Spectrum />
    </AbsoluteFill>
  );
};
