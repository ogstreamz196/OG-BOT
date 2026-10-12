import React from "react";
import { AbsoluteFill } from "remotion";
import { Phone } from "../components/Phone";
import { Headline, Kicker, Chip } from "../components/Type";
import { Bars } from "../components/Backdrop";

type Props = {
  kicker: string;
  words: string[];
  accentIndex?: number[];
  screenshot: string;
  chips?: { label: string; tone?: "blue" | "silver" | "red" }[];
  side?: "left" | "right";
  pan?: number;
  size?: number;
};

/** Headline + real app screenshot in a phone, side by side. */
export const PhoneScene: React.FC<Props> = ({
  kicker,
  words,
  accentIndex = [],
  screenshot,
  chips = [],
  side = "right",
  pan = -140,
  size = 96,
}) => {
  const phoneRight = side === "right";
  return (
    <AbsoluteFill style={{ padding: "120px 70px", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          top: 110,
          [phoneRight ? "right" : "left"]: -30,
          display: "flex",
        }}
      >
        <Phone src={screenshot} delay={6} width={520} rotate={phoneRight ? -6 : 6} pan={pan} />
      </div>

      <div
        style={{
          position: "absolute",
          left: phoneRight ? 70 : undefined,
          right: phoneRight ? undefined : 70,
          bottom: 270,
          width: 700,
          display: "flex",
          flexDirection: "column",
          gap: 26,
        }}
      >
        <Kicker delay={4}>{kicker}</Kicker>
        <Headline words={words} delay={10} size={size} accentIndex={accentIndex} />
        {chips.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, maxWidth: 700 }}>
            {chips.map((c, i) => (
              <Chip key={c.label} label={c.label} tone={c.tone} delay={34 + i * 4} />
            ))}
          </div>
        )}
      </div>
      <Bars count={34} height={170} opacity={0.4} />
    </AbsoluteFill>
  );
};
