import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, DOMAIN } from "../theme";
import { body, display } from "../components/Type";
import { Spectrum } from "../components/PromoKit";
export const PromoIntro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f, fps, config: { damping: 13, stiffness: 120 } });
  const punch = 1 + Math.sin(f / 10) * 0.018;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at 50% 38%,${C.blue}77,transparent 37%),linear-gradient(160deg,${C.ink2},${C.ink})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 76,
          fontFamily: body,
          fontWeight: 700,
          fontSize: 27,
          letterSpacing: 7,
          color: C.silver,
          opacity: interpolate(f, [12, 28], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        START WITH 25 FREE CREDITS
      </div>
      <Img
        src={staticFile("images/ogbot.png")}
        style={{
          width: 520,
          height: 520,
          objectFit: "cover",
          borderRadius: 80,
          border: `5px solid ${C.silver}`,
          boxShadow: `0 0 130px ${C.blue}`,
          transform: `scale(${interpolate(p, [0, 1], [0.55, 1]) * punch}) rotate(${interpolate(p, [0, 1], [-8, 0])}deg)`,
          opacity: p,
        }}
      />
      <div
        style={{
          fontFamily: display,
          fontSize: 184,
          lineHeight: 1,
          color: C.white,
          textShadow: `0 0 65px ${C.blue}`,
          transform: `translateY(${interpolate(p, [0, 1], [90, 0])}px)`,
        }}
      >
        OG BOT
      </div>
      <div style={{ fontFamily: body, fontSize: 42, color: C.silver, marginTop: 18 }}>
        Say it loud: <b style={{ color: C.blueSoft }}>O · G · BOT</b>
      </div>
      <div
        style={{
          fontFamily: display,
          fontSize: 76,
          color: C.red,
          marginTop: 36,
          opacity: interpolate(f, [58, 76], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        CREATE FOR FREE.
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 230,
          fontFamily: body,
          fontWeight: 700,
          fontSize: 42,
          letterSpacing: 4,
          color: C.white,
        }}
      >
        {DOMAIN}
      </div>
      <Spectrum />
    </AbsoluteFill>
  );
};
