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

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = spring({ frame, fps, config: { damping: 14, stiffness: 150 } });
  const url = spring({ frame: frame - 26, fps, config: { damping: 12, stiffness: 160 } });
  const pulse = 1 + Math.sin(frame / 12) * 0.02;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34 }}>
      <Img
        src={staticFile("images/ogbot.png")}
        style={{
          width: 340,
          height: 340,
          borderRadius: 999,
          objectFit: "cover",
          border: `6px solid ${C.silver}`,
          boxShadow: `0 0 120px ${C.blue}cc`,
          transform: `scale(${interpolate(logo, [0, 1], [0.6, 1])})`,
          opacity: logo,
        }}
      />
      <div
        style={{
          fontFamily: display,
          fontSize: 150,
          color: C.white,
          textShadow: `0 0 60px ${C.blue}`,
          opacity: logo,
        }}
      >
        OG BOT
      </div>
      <div
        style={{
          fontFamily: body,
          fontSize: 40,
          color: C.silver,
          letterSpacing: 3,
          textAlign: "center",
          maxWidth: 860,
          opacity: interpolate(frame, [18, 34], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        Your track. Your language. Your name in the hook.
      </div>
      <div
        style={{
          marginTop: 20,
          padding: "28px 64px",
          borderRadius: 999,
          background: `linear-gradient(135deg, ${C.blue}, ${C.silver})`,
          color: "#080c1e",
          fontFamily: display,
          fontSize: 82,
          letterSpacing: 2,
          boxShadow: `0 30px 90px -20px ${C.blue}`,
          transform: `scale(${interpolate(url, [0, 1], [0.7, 1]) * pulse})`,
          opacity: url,
        }}
      >
        {DOMAIN}
      </div>
      <div
        style={{
          fontFamily: body,
          fontWeight: 700,
          fontSize: 30,
          letterSpacing: 8,
          color: C.blueSoft,
          textTransform: "uppercase",
          opacity: interpolate(frame, [60, 78], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        Make your first track today
      </div>
      <Bars count={46} height={240} opacity={0.6} />
    </AbsoluteFill>
  );
};
