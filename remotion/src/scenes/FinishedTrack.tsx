import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C } from "../theme";
import { BigWords, Counter, Eyebrow, Spectrum } from "../components/PromoKit";
import { body, display } from "../components/Type";

export const FinishedTrack: React.FC = () => {
  const f = useCurrentFrame();
  const pct = Math.min(
    100,
    Math.round(interpolate(f, [0, 95], [0, 100], { extrapolateRight: "clamp" })),
  );
  return (
    <AbsoluteFill style={{ padding: "100px 62px" }}>
      <Counter text="04 / YOUR TRACK" />
      <Eyebrow>Free from idea to first listen</Eyebrow>
      <BigWords lines={["HEAR IT.", "LOVE IT.", "UNLOCK IT."]} accent={[2]} delay={8} size={112} />
      <div
        style={{
          marginTop: 64,
          border: `3px solid ${C.blueSoft}`,
          borderRadius: 22,
          padding: "36px",
          background: `linear-gradient(140deg,${C.ink2},#111943)`,
          boxShadow: `0 30px 90px ${C.blue}55`,
        }}
      >
        <div style={{ fontFamily: body, fontSize: 25, letterSpacing: 4, color: C.muted }}>
          OG BOT IS RENDERING
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 18,
          }}
        >
          <div style={{ fontFamily: display, fontSize: 64, color: C.white }}>START LISTENING</div>
          <div
            style={{ fontFamily: display, fontSize: 82, color: pct === 100 ? C.teal : C.blueSoft }}
          >
            {pct}%
          </div>
        </div>
        <div
          style={{
            height: 18,
            borderRadius: 12,
            background: "#22294a",
            overflow: "hidden",
            marginTop: 24,
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: `linear-gradient(90deg,${C.blue},${C.teal})`,
            }}
          />
        </div>
        {pct === 100 && (
          <div style={{ display: "flex", gap: 16, marginTop: 36 }}>
            {["▶ PLAY NOW", "5 CREDITS", "OR 99p"].map((x, i) => (
              <div
                key={x}
                style={{
                  fontFamily: body,
                  fontWeight: 700,
                  fontSize: 24,
                  padding: "17px 20px",
                  borderRadius: 8,
                  color: i === 0 ? C.ink : C.white,
                  background: i === 0 ? C.silver : `${C.blue}77`,
                  border: `2px solid ${i === 0 ? C.white : C.blueSoft}`,
                  opacity: interpolate(f, [100 + i * 8, 114 + i * 8], [0, 1], {
                    extrapolateRight: "clamp",
                  }),
                }}
              >
                {x}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ fontFamily: display, fontSize: 68, color: C.red, marginTop: 58 }}>
        ONE TRACK. ONE DOWNLOAD.
      </div>
      <div style={{ fontFamily: body, fontSize: 32, color: C.silver, marginTop: 14 }}>
        No subscription needed. Share it when it’s yours.
      </div>
      <Spectrum height={145} />
    </AbsoluteFill>
  );
};
