import React from "react";
import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import { C, DOMAIN } from "../theme";
import { display, body } from "../components/Type";
import { Bars } from "../components/Backdrop";

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = spring({ frame, fps, config: { damping: 12, stiffness: 140 } });
  const title = spring({ frame: frame - 14, fps, config: { damping: 11, stiffness: 160 } });
  const flare = interpolate(frame, [0, 18, 40], [0, 1, 0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(45% 25% at 50% 45%, ${C.blue}${Math.round(flare * 140)
            .toString(16)
            .padStart(2, "0")}, transparent 70%)`,
        }}
      />
      <Img
        src={staticFile("images/ogbot.png")}
        style={{
          width: 460,
          height: 460,
          borderRadius: 999,
          objectFit: "cover",
          border: `6px solid ${C.silver}`,
          boxShadow: `0 0 120px ${C.blue}aa`,
          transform: `scale(${interpolate(logo, [0, 1], [0.5, 1])}) rotate(${interpolate(
            logo,
            [0, 1],
            [-14, 0],
          )}deg)`,
          opacity: logo,
        }}
      />
      <div
        style={{
          marginTop: 60,
          fontFamily: display,
          fontSize: 190,
          letterSpacing: 4,
          color: C.white,
          textShadow: `0 0 60px ${C.blue}, 0 10px 0 #00000055`,
          transform: `scale(${interpolate(title, [0, 1], [0.7, 1])})`,
          opacity: title,
        }}
      >
        OG BOT
      </div>
      <div
        style={{
          marginTop: 12,
          fontFamily: body,
          fontWeight: 700,
          fontSize: 44,
          letterSpacing: 8,
          color: C.silver,
          opacity: interpolate(frame, [30, 48], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        {DOMAIN}
      </div>
      <Bars count={30} height={200} opacity={0.5} />
    </AbsoluteFill>
  );
};
