import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C } from "../theme";
import { BigWords, Counter, Eyebrow, Spectrum } from "../components/PromoKit";
import { body } from "../components/Type";
const chips = [
  "LYRICS · FREE",
  "RENDERING · FREE",
  "LISTEN WHILE IT FINISHES",
  "PAY ONLY TO DOWNLOAD",
];
export const CreationTool: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ padding: "100px 62px" }}>
      <Counter text="01 / CREATE" />
      <div
        style={{
          position: "absolute",
          top: 155,
          right: -170,
          width: 680,
          transform: `rotate(-4deg) translateY(${interpolate(f, [0, 300], [110, -80], { extrapolateRight: "clamp" })}px)`,
          filter: "drop-shadow(0 40px 70px #000b)",
        }}
      >
        <Img
          src={staticFile("images/wizard-fresh.png")}
          style={{ width: "100%", borderRadius: 56, border: `3px solid ${C.blueSoft}` }}
        />
      </div>
      <div style={{ position: "absolute", left: 62, top: 180, width: 610 }}>
        <Eyebrow>Music creation studio</Eyebrow>
        <BigWords lines={["NAME IT.", "SHAPE IT.", "MAKE IT."]} accent={[2]} delay={8} size={103} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 42 }}>
          {chips.map((x, i) => (
            <div
              key={x}
              style={{
                fontFamily: body,
                fontWeight: 700,
                fontSize: 27,
                letterSpacing: 2,
                color: C.white,
                padding: "16px 22px",
                width: "fit-content",
                background: `${i === 3 ? C.red : C.blue}cc`,
                borderRadius: 8,
                opacity: interpolate(f, [42 + i * 8, 58 + i * 8], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              {x}
            </div>
          ))}
        </div>
      </div>
      <Spectrum height={150} />
    </AbsoluteFill>
  );
};
