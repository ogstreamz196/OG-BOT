import React from "react";
import { AbsoluteFill, Img, interpolate, random, staticFile, useCurrentFrame } from "remotion";
import { C } from "../theme";
import {
  BigWords,
  Counter,
  Eyebrow,
  Glitch,
  Spectrum,
  shakeTransform,
  useCameraShake,
} from "../components/PromoKit";
import { body } from "../components/Type";

/** Impact shockwave rings that expand from behind the phone on the "ZONE" drop. */
const Shockwaves: React.FC<{ at: number }> = ({ at }) => {
  const f = useCurrentFrame();
  if (f < at || f > at + 46) return null;
  const rings = [0, 8, 16];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      {rings.map((off) => {
        const t = interpolate(f, [at + off, at + off + 34], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        if (t <= 0 || t >= 1) return null;
        const size = 240 + t * 820;
        return (
          <div
            key={off}
            style={{
              position: "absolute",
              width: size,
              height: size,
              borderRadius: "50%",
              border: `4px solid ${C.red}`,
              opacity: (1 - t) * 0.65,
              boxShadow: `0 0 70px ${C.red}88, inset 0 0 40px ${C.red}55`,
              transform: "translate3d(0,0,0)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** Floating embers/sparks drifting upward behind the battle phone. */
const Embers: React.FC = () => {
  const f = useCurrentFrame();
  const count = 22;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {Array.from({ length: count }, (_, i) => {
        const seedX = random(`ex-${i}`);
        const seedS = random(`es-${i}`);
        const span = 150 + seedS * 180; // frames to rise and fade
        const phase = ((f + i * 23) % span) / span; // 0 → 1
        const x = 8 + seedX * 46; // left side, behind the phone
        const sway = Math.sin(f / 18 + i) * 14;
        const size = 3 + seedS * 5;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              bottom: `${phase * 78 + 4}%`,
              width: size,
              height: size,
              borderRadius: "50%",
              background: i % 4 === 0 ? C.white : C.red,
              opacity: Math.sin(phase * Math.PI) * 0.75,
              transform: `translate3d(${sway.toFixed(1)}px,0,0)`,
              boxShadow: `0 0 ${(size * 2.2).toFixed(0)}px ${C.red}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

export const BattleZone: React.FC = () => {
  const f = useCurrentFrame();
  // The four words land ~frames 10–40; kick the camera as the last one drops.
  const shake = useCameraShake([14, 24, 34], { amp: 14, decayFrames: 18 });
  const dropAt = 34; // "ZONE" lands
  return (
    <Glitch at={[0]} frames={5} amp={4}>
      <AbsoluteFill style={{ transform: shakeTransform(shake), willChange: "transform" }}>
        <AbsoluteFill style={{ padding: "96px 58px" }}>
          <Counter text="03 / BATTLE" />
          <Embers />
          <Shockwaves at={dropAt} />
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
              Give me ur best shot — say or ask anything. Get cussed. Earn OG credits.
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
      </AbsoluteFill>
    </Glitch>
  );
};
