import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, interpolate } from "remotion";
import { C } from "../theme";

/** Persistent brand backdrop: app wallpaper, navy wash, drifting blue glows. */
export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 40;
  const drift2 = Math.cos(frame / 120) * 60;
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink, overflow: "hidden" }}>
      <Img
        src={staticFile("images/bg.png")}
        style={{
          position: "absolute",
          width: "130%",
          height: "130%",
          left: `${-15 + drift / 60}%`,
          top: `${-15 + drift2 / 90}%`,
          objectFit: "cover",
          opacity: 0.28,
          filter: "saturate(0.7)",
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(80% 55% at 50% 0%, ${C.blue}55, transparent 65%),
            radial-gradient(60% 45% at 90% 100%, ${C.blueSoft}33, transparent 65%),
            linear-gradient(180deg, ${C.ink}dd 0%, ${C.ink2}ee 55%, ${C.ink}f5 100%)`,
        }}
      />
      <AbsoluteFill
        style={{
          transform: `translateY(${drift}px)`,
          background: `radial-gradient(38% 22% at 20% 30%, ${C.blue}22, transparent 70%)`,
        }}
      />
      <EnergyPulse frame={frame} />
    </AbsoluteFill>
  );
};

/**
 * Ambient, audio-style energy behind the phones: concentric rings that swell
 * and glowing grid scanlines that brighten on the beat. The music ducks under
 * the narration early and swells for the showcase (see MainVideo), so a slow
 * envelope ramps the whole thing up over the first ~20s, and a fast beat term
 * makes it breathe. All transform/opacity, so it stays GPU-cheap.
 */
const EnergyPulse: React.FC<{ frame: number }> = ({ frame }) => {
  // 0 → 1 as the track opens up for the showcase.
  const swell = interpolate(frame, [0, 60, 540, 620], [0.18, 0.3, 0.42, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const beat = 0.5 + 0.5 * Math.sin(frame / 7); // the "peak" term
  const rings = [0, 1, 2];
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {/* Grid scanlines that brighten on the beat. */}
      <AbsoluteFill
        style={{
          opacity: 0.05 + 0.09 * swell * beat,
          backgroundImage: `repeating-linear-gradient(0deg, ${C.blueSoft}55 0 1px, transparent 1px 4px)`,
          maskImage: "radial-gradient(70% 60% at 50% 48%, #000 25%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(70% 60% at 50% 48%, #000 25%, transparent 75%)",
          transform: `translateY(${(frame % 8).toFixed(1)}px)`,
        }}
      />
      {/* Concentric energy rings that swell out from behind the phone. */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        {rings.map((r) => {
          const phase = (((frame / 42 + r / rings.length) % 1) + 1) % 1; // 0 → 1
          const size = 420 + phase * 760;
          return (
            <div
              key={r}
              style={{
                position: "absolute",
                width: size,
                height: size,
                borderRadius: "50%",
                border: `2px solid ${C.blue}`,
                opacity: (1 - phase) * 0.5 * swell,
                transform: `scale(${(0.9 + beat * 0.08).toFixed(3)})`,
                boxShadow: `0 0 60px ${C.blue}55, inset 0 0 50px ${C.blueSoft}33`,
              }}
            />
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Audio-style bars pinned to the bottom of the frame. */
export const Bars: React.FC<{ count?: number; height?: number; opacity?: number }> = ({
  count = 42,
  height = 260,
  opacity = 0.75,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height,
        display: "flex",
        alignItems: "flex-end",
        gap: 8,
        padding: "0 40px",
        opacity,
      }}
    >
      {new Array(count).fill(0).map((_, i) => {
        const h =
          0.25 +
          0.42 * Math.abs(Math.sin(frame / 6 + i * 0.55)) +
          0.33 * Math.abs(Math.sin(frame / 3.1 + i * 1.3));
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${Math.min(1, h) * 100}%`,
              borderRadius: 8,
              background: `linear-gradient(180deg, ${C.silver}, ${C.blue})`,
              boxShadow: `0 0 18px ${C.blue}66`,
            }}
          />
        );
      })}
    </div>
  );
};

export const useFade = (durationInFrames: number, inLen = 12, outLen = 12) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [0, inLen, durationInFrames - outLen, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
};
