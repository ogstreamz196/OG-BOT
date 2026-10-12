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
export const PromoEnd: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 14, stiffness: 125 } });
  return (
    <AbsoluteFill style={{ textAlign: "center" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at 50% 42%,${C.blue}88,transparent 42%),linear-gradient(145deg,${C.ink2},${C.ink})`,
        }}
      />
      <Img
        src={staticFile("images/ogbot.png")}
        style={{
          position: "absolute",
          top: 260,
          left: 325,
          width: 430,
          height: 430,
          borderRadius: 76,
          objectFit: "cover",
          border: `5px solid ${C.silver}`,
          boxShadow: `0 0 130px ${C.blue}`,
          opacity: s,
          transform: `scale(${interpolate(s, [0, 1], [0.65, 1])})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 735,
          left: 0,
          right: 0,
          fontFamily: display,
          fontSize: 178,
          color: C.white,
          textShadow: `0 0 60px ${C.blue}`,
          lineHeight: 1,
        }}
      >
        OG BOT
      </div>
      <div
        style={{
          position: "absolute",
          top: 930,
          left: 0,
          right: 0,
          fontFamily: body,
          fontWeight: 700,
          fontSize: 37,
          letterSpacing: 5,
          color: C.silver,
        }}
      >
        CREATE · BATTLE · SHARE
      </div>
      <div
        style={{
          position: "absolute",
          top: 1065,
          left: 175,
          right: 175,
          fontFamily: display,
          fontSize: 98,
          color: C.ink,
          background: `linear-gradient(100deg,${C.silver},${C.blueSoft})`,
          padding: "26px 20px",
          borderRadius: 14,
          boxShadow: `0 24px 80px ${C.blue}88`,
          transform: `scale(${interpolate(s, [0, 1], [0.8, 1])})`,
        }}
      >
        {DOMAIN}
      </div>
      <div
        style={{
          position: "absolute",
          top: 1255,
          left: 0,
          right: 0,
          fontFamily: body,
          fontSize: 30,
          color: C.white,
          opacity: interpolate(f, [40, 60], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        25 free credits · create free · download for 5 credits or 99p
      </div>
      <Spectrum />
    </AbsoluteFill>
  );
};
