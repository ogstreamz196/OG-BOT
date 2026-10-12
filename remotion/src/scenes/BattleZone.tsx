import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C } from "../theme";
import { BigWords, Counter, Eyebrow, Spectrum } from "../components/PromoKit";
import { body } from "../components/Type";
export const BattleZone: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ padding: "96px 58px" }}>
      <Counter text="03 / BATTLE" />
      <div
        style={{
          position: "absolute",
          left: -110,
          top: 160,
          width: 650,
          transform: `rotate(5deg) translateY(${interpolate(f, [0, 330], [80, -65], { extrapolateRight: "clamp" })}px)`,
          filter: "drop-shadow(0 38px 80px #000c)",
        }}
      >
        <Img
          src={staticFile("images/battle-fresh.png")}
          style={{ width: "100%", borderRadius: 55, border: `3px solid ${C.red}` }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          top: 200,
          right: 48,
          width: 610,
          textAlign: "right",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
        }}
      >
        <Eyebrow red>Everyone vs OG Bot</Eyebrow>
        <BigWords
          lines={["ENTER", "THE OG", "BATTLE", "ZONE"]}
          accent={[2, 3]}
          delay={10}
          size={105}
          align="center"
        />
        <div
          style={{
            fontFamily: body,
            fontWeight: 700,
            fontSize: 31,
            lineHeight: 1.45,
            color: C.silver,
            marginTop: 40,
            maxWidth: 530,
          }}
        >
          Give me ur best shot — say or ask anything. Get roasted. Earn OG credits.
        </div>
        <div
          style={{
            marginTop: 30,
            fontFamily: body,
            fontSize: 26,
            padding: "16px 22px",
            border: `2px solid ${C.red}`,
            borderRadius: 8,
            color: C.white,
            background: `${C.red}2b`,
          }}
        >
          FOUL MOUTH: ON
        </div>
      </div>
      <Spectrum red />
    </AbsoluteFill>
  );
};
