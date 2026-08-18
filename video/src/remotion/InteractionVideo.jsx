import React from "react";
import { useAudioData, visualizeAudio } from "@remotion/media-utils";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const ORANGE = "#ff5b35";
const PANEL = "#171b1f";

function clean(value, fallback = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim() || fallback;
}

function words(value) {
  return clean(value).split(" ").filter(Boolean);
}

function fade(frame, start, end, edge = 10) {
  return interpolate(frame, [start, start + edge, end - edge, end], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

function ActiveCaption({ cue, cueFrame, cueFrames }) {
  const tokens = words(cue?.text);
  const active = Math.min(tokens.length - 1, Math.max(0, Math.floor((cueFrame / Math.max(1, cueFrames)) * tokens.length)));
  return (
    <div style={styles.captionBox}>
      {tokens.map((token, index) => (
        <span key={`${token}-${index}`} style={{
          ...styles.captionWord,
          color: index === active ? "#111" : "#fff",
          background: index === active ? ORANGE : "transparent",
        }}>{token}</span>
      ))}
    </div>
  );
}

function MicScene({ input, from, duration }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - from;
  const sourceMs = Number(input.audioStartMs) + (local / fps) * 1000;
  const audioData = useAudioData(input.audioDataUrl);
  const speakingWord = (input.rawWords ?? []).find((word) => sourceMs >= word.startMs && sourceMs <= word.endMs);
  const wordProgress = speakingWord
    ? (sourceMs - speakingWord.startMs) / Math.max(1, speakingWord.endMs - speakingWord.startMs)
    : 0;
  const timedPulse = speakingWord ? Math.sin(Math.PI * Math.max(0, Math.min(1, wordProgress))) : 0;
  const samples = audioData ? visualizeAudio({
    audioData,
    frame: Math.max(0, Math.round((sourceMs / 1000) * fps)),
    fps,
    numberOfSamples: 32,
    optimizeFor: "speed",
    smoothing: true,
  }) : [];
  const actualAmplitude = samples.length ? Math.max(...samples.map((sample) => Math.abs(sample))) : 0;
  const speechPulse = audioData ? Math.min(1, actualAmplitude * 3.4) : timedPulse;
  const cue = (input.captionCues ?? []).find((item) => sourceMs >= item.startMs && sourceMs <= item.endMs)
    ?? (input.captionCues ?? []).at(-1);
  const cueFrame = cue ? ((sourceMs - cue.startMs) / 1000) * fps : 0;
  const cueFrames = cue ? ((cue.endMs - cue.startMs) / 1000) * fps : 1;
  return (
    <Sequence from={from} durationInFrames={duration}>
      <AbsoluteFill style={{ ...styles.scene, opacity: fade(frame, from, from + duration) }}>
        <div style={styles.sceneKicker}>THE REQUEST</div>
        <div style={styles.micWrap}>
          <div style={{ ...styles.pulseRing, transform: `scale(${1 + speechPulse * 0.28})`, opacity: 0.18 + speechPulse * 0.35 }} />
          <div style={{ ...styles.micButton, transform: `scale(${1 + speechPulse * 0.13})` }}>
            <div style={styles.micCore} />
          </div>
        </div>
        <div style={styles.listenLabel}>{speakingWord ? "LISTENING" : "RECORDING"}</div>
        {cue ? <ActiveCaption cue={cue} cueFrame={cueFrame} cueFrames={cueFrames} /> : null}
      </AbsoluteFill>
      {input.audioDataUrl ? (
        <Audio
          src={input.audioDataUrl}
          startFrom={Math.max(0, Math.round((Number(input.audioStartMs) / 1000) * fps))}
          endAt={Math.max(1, Math.round((Number(input.audioEndMs) / 1000) * fps))}
        />
      ) : null}
    </Sequence>
  );
}

function ActivityScene({ input, from, duration }) {
  const frame = useCurrentFrame();
  const activity = (input.activity ?? []).slice(0, 5);
  return (
    <Sequence from={from} durationInFrames={duration}>
      <AbsoluteFill style={{ ...styles.scene, opacity: fade(frame, from, from + duration) }}>
        <div style={styles.sceneKicker}>WHAT SLAYER DID</div>
        <div style={styles.activityRail} />
        <div style={styles.activityList}>
          {activity.map((item, index) => {
            const appeared = spring({ frame: frame - from - index * 9, fps: 30, config: { damping: 18, stiffness: 150 } });
            return (
              <div key={`${item.label}-${index}`} style={{
                ...styles.activityItem,
                opacity: appeared,
                transform: `translateY(${(1 - appeared) * 34}px)`,
              }}>
                <div style={styles.activityDot} />
                <div>
                  <div style={styles.activityLabel}>{clean(item.label, "Agent activity")}</div>
                  <div style={styles.activityDetail}>{clean(item.detail, "Completed")}</div>
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Sequence>
  );
}

function ResponseScene({ input, from, duration }) {
  const frame = useCurrentFrame();
  const local = frame - from;
  const highlights = (input.responseHighlights ?? []).slice(0, 6);
  return (
    <Sequence from={from} durationInFrames={duration}>
      <AbsoluteFill style={{ ...styles.scene, opacity: fade(frame, from, from + duration, 8) }}>
        <div style={styles.sceneKicker}>THE RESPONSE</div>
        <div style={styles.responseCard}>
          <div style={styles.responseAccent} />
          {highlights.map((highlight, index) => {
            const reveal = interpolate(local, [10 + index * 12, 20 + index * 12], [0, 1], {
              extrapolateLeft: "clamp", extrapolateRight: "clamp",
            });
            return <div key={index} style={{ ...styles.responseLine, opacity: reveal }}>{clean(highlight)}</div>;
          })}
        </div>
        <div style={styles.outro}>YOUR AGENT. YOUR DATA. THE EXACT TRACE.</div>
      </AbsoluteFill>
    </Sequence>
  );
}

export function InteractionVideo({ input }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const introFrames = Math.round(3 * fps);
  const requestedAudioFrames = Math.max(1, Math.round(((Number(input.audioEndMs) - Number(input.audioStartMs)) / 1000) * fps));
  const responseFrames = Math.max(Math.round(8 * fps), Math.min(Math.round(13 * fps), durationInFrames - introFrames - requestedAudioFrames - Math.round(4 * fps)));
  const activityFrames = Math.max(Math.round(4 * fps), durationInFrames - introFrames - requestedAudioFrames - responseFrames);
  const micFrom = introFrames;
  const activityFrom = micFrom + requestedAudioFrames;
  const responseFrom = activityFrom + activityFrames;
  const introScale = spring({ frame, fps, config: { damping: 16, stiffness: 115 } });
  return (
    <AbsoluteFill style={styles.page}>
      <div style={styles.grain} />
      <Sequence durationInFrames={introFrames}>
        <AbsoluteFill style={{ ...styles.intro, opacity: fade(frame, 0, introFrames, 7) }}>
          <div style={styles.brand}>AGENT SLAYER</div>
          <h1 style={{ ...styles.title, transform: `translateY(${(1 - introScale) * 60}px)`, opacity: introScale }}>
            {clean(input.title, "I asked my agent to handle it")}
          </h1>
          <div style={styles.titleRule} />
          <div style={styles.subtitle}>A real request. Real tools. One recorded trace.</div>
        </AbsoluteFill>
      </Sequence>
      <MicScene input={input} from={micFrom} duration={requestedAudioFrames} />
      <ActivityScene input={input} from={activityFrom} duration={activityFrames} />
      <ResponseScene input={input} from={responseFrom} duration={responseFrames} />
      <div style={styles.cornerBrand}>SLAYER</div>
      <div style={styles.progressTrack}><div style={{ ...styles.progressFill, width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%` }} /></div>
    </AbsoluteFill>
  );
}

const styles = {
  page: { background: "#0c0e10", color: "#f4f1ea", fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif', overflow: "hidden" },
  grain: { position: "absolute", inset: 0, opacity: 0.07, backgroundImage: "radial-gradient(circle at 15% 10%, #ff5b35 0, transparent 33%), radial-gradient(circle at 90% 80%, #3b4550 0, transparent 28%)" },
  scene: { padding: "150px 76px 130px", justifyContent: "center" },
  intro: { padding: "170px 80px", justifyContent: "center" },
  brand: { color: ORANGE, fontSize: 30, fontWeight: 850, letterSpacing: 7 },
  title: { maxWidth: 920, margin: "58px 0 46px", fontSize: 91, lineHeight: 1.02, letterSpacing: -5, fontWeight: 850 },
  titleRule: { width: 180, height: 10, background: ORANGE, borderRadius: 10 },
  subtitle: { marginTop: 42, maxWidth: 800, color: "#aeb7bd", fontSize: 36, lineHeight: 1.35 },
  sceneKicker: { position: "absolute", top: 145, left: 76, color: ORANGE, fontSize: 27, fontWeight: 800, letterSpacing: 5 },
  micWrap: { position: "relative", width: 360, height: 360, margin: "0 auto 55px", display: "grid", placeItems: "center" },
  pulseRing: { position: "absolute", width: 330, height: 330, border: `16px solid ${ORANGE}`, borderRadius: "50%" },
  micButton: { width: 250, height: 250, display: "grid", placeItems: "center", borderRadius: "50%", background: "linear-gradient(145deg, #3b2d28, #171411)", border: "4px solid rgba(255,255,255,.14)", boxShadow: "0 30px 90px rgba(0,0,0,.55)" },
  micCore: { width: 112, height: 112, borderRadius: "50%", background: ORANGE, boxShadow: `0 0 70px ${ORANGE}66` },
  listenLabel: { marginBottom: 54, color: "#9ca6ad", textAlign: "center", fontSize: 24, fontWeight: 750, letterSpacing: 6 },
  captionBox: { minHeight: 250, display: "flex", flexWrap: "wrap", alignContent: "center", justifyContent: "center", gap: "10px 12px", padding: "35px 28px", background: "rgba(23,27,31,.92)", border: "2px solid #333b42", borderRadius: 30, boxShadow: "0 26px 90px rgba(0,0,0,.4)" },
  captionWord: { padding: "3px 6px 6px", borderRadius: 7, fontSize: 49, lineHeight: 1.16, fontWeight: 780 },
  activityRail: { position: "absolute", left: 105, top: 340, bottom: 280, width: 5, background: "#343c43" },
  activityList: { display: "flex", flexDirection: "column", gap: 34, paddingLeft: 78 },
  activityItem: { position: "relative", minHeight: 180, padding: "34px 36px", background: PANEL, border: "2px solid #303840", borderRadius: 25 },
  activityDot: { position: "absolute", left: -61, top: 66, width: 28, height: 28, border: `7px solid ${ORANGE}`, borderRadius: "50%", background: "#0c0e10" },
  activityLabel: { color: ORANGE, fontSize: 25, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" },
  activityDetail: { marginTop: 14, fontSize: 37, lineHeight: 1.25, fontWeight: 650 },
  responseCard: { position: "relative", padding: "62px 52px", background: PANEL, border: "2px solid #303840", borderRadius: 30, overflow: "hidden" },
  responseAccent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 13, background: ORANGE },
  responseLine: { marginBottom: 31, paddingLeft: 22, fontSize: 40, lineHeight: 1.3, fontWeight: 620 },
  outro: { marginTop: 54, color: "#9ca6ad", fontSize: 24, fontWeight: 800, letterSpacing: 4, textAlign: "center" },
  cornerBrand: { position: "absolute", right: 58, top: 56, color: "rgba(255,255,255,.45)", fontSize: 23, fontWeight: 850, letterSpacing: 5 },
  progressTrack: { position: "absolute", left: 0, right: 0, bottom: 0, height: 14, background: "#23282d" },
  progressFill: { height: "100%", background: ORANGE },
};
