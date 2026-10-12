import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { C } from "../theme";
import { Phone } from "../components/Phone";
import { Headline, Kicker, body } from "../components/Type";

const LINES = [
  { who: "YOU", text: "Go on then, roast me.", mine: true },
  {
    who: "OG BOT",
    text: "A mum joke? F***ing hell, you've got the wit of a smashed brick.",
    mine: false,
  },
  {
    who: "OG BOT",
    text: "Come back when you've grown some proper bollocks, you absolute gobshite.",
    mine: false,
  },
];

/** OG Bot's unfiltered mode — real Battle Zone screen plus animated chat bubbles. */
export const FoulMouth: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ padding: "110px 70px" }}>
      <div style={{ position: "absolute", top: 170, left: -80 }}>
        <Phone src="images/messenger2.png" delay={4} width={520} rotate={6} pan={-200} />
      </div>

      <div
        style={{
          position: "absolute",
          top: 150,
          right: 60,
          width: 620,
          display: "flex",
          flexDirection: "column",
          gap: 22,
          alignItems: "flex-end",
        }}
      >
        <Kicker delay={2} color={C.red}>
          Foul mouth mode
        </Kicker>
        <Headline
          words={["OG", "BOT", "BITES", "BACK"]}
          delay={8}
          size={92}
          accentIndex={[2, 3]}
          align="center"
        />
        {LINES.map((l, i) => {
          const s = spring({
            frame: frame - 46 - i * 26,
            fps,
            config: { damping: 15, stiffness: 170 },
          });
          return (
            <div
              key={i}
              style={{
                alignSelf: l.mine ? "flex-end" : "flex-start",
                maxWidth: 560,
                padding: "22px 28px",
                borderRadius: 28,
                background: l.mine ? `${C.blue}dd` : "#0d1330f0",
                border: `2px solid ${l.mine ? C.blueSoft : C.red}66`,
                color: C.white,
                fontFamily: body,
                fontSize: 34,
                lineHeight: 1.28,
                boxShadow: `0 20px 60px -20px ${l.mine ? C.blue : C.red}88`,
                transform: `translateY(${interpolate(s, [0, 1], [50, 0])}px) scale(${interpolate(
                  s,
                  [0, 1],
                  [0.9, 1],
                )})`,
                opacity: interpolate(s, [0, 0.4], [0, 1], { extrapolateRight: "clamp" }),
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  letterSpacing: 4,
                  color: l.mine ? "#dfe3ee" : C.red,
                  marginBottom: 8,
                  fontWeight: 700,
                }}
              >
                {l.who}
              </div>
              {l.text}
            </div>
          );
        })}
        <div
          style={{
            fontFamily: body,
            fontSize: 26,
            color: C.muted,
            opacity: interpolate(frame, [140, 160], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          Or keep it clean — one tap.
        </div>
      </div>
    </AbsoluteFill>
  );
};
