import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const AGENT = "#4e5b43";
const USER = "#6e7b61";
const PALE = "#c9d3bf";
const INK = "#20251e";

function clean(value, fallback = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim() || fallback;
}

function clip(value, length = 720) {
  const text = clean(value);
  return text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`;
}

function sceneFrames(scene, fps) {
  return Math.max(1, Math.round((Number(scene?.durationSeconds) || 4) * fps));
}

function enter(frame, fps, delay = 0) {
  return spring({ frame: frame - delay, fps, config: { damping: 19, stiffness: 145 } });
}

function TopBar({ input }) {
  return (
    <div style={styles.topBar}>
      <div style={styles.brandMark}>A</div>
      <div>
        <div style={styles.brand}>AGENT</div>
        <div style={styles.session}>{clean(input.title, "Interaction video")}</div>
      </div>
      <div style={styles.connected}><span style={styles.connectedDot} /> connected</div>
    </div>
  );
}

function UserBubble({ text, label = "You" }) {
  return (
    <div style={styles.userRow}>
      <div style={styles.userBubble}>
        <div style={styles.bubbleLabel}>{label}</div>
        <div style={styles.bubbleText}>{clip(text, 620)}</div>
      </div>
    </div>
  );
}

function AgentBubble({ text, label = "Agent" }) {
  return (
    <div style={styles.agentRow}>
      <div style={styles.avatar}>A</div>
      <div style={styles.agentBubble}>
        <div style={{ ...styles.bubbleLabel, color: AGENT }}>{label}</div>
        <div style={styles.bubbleText}>{clip(text, 840)}</div>
      </div>
    </div>
  );
}

function TimedCaption({ scene, localFrame, fps }) {
  if (!scene?.authenticAudio || !scene?.captionCues?.length) return null;
  const sourceMs = Number(scene.audioStartMs || 0) + (localFrame / fps) * 1000;
  const cue = scene.captionCues.find((item) => sourceMs >= item.startMs && sourceMs <= item.endMs);
  if (!cue) return null;
  return <div style={styles.caption}>{clean(cue.text)}</div>;
}

function SceneAudio({ scene, fps }) {
  if (!scene?.audioDataUrl) return null;
  if (!scene.authenticAudio) return <Audio src={scene.audioDataUrl} />;
  return (
    <Audio
      src={scene.audioDataUrl}
      startFrom={Math.max(0, Math.round((Number(scene.audioStartMs) / 1000) * fps))}
      endAt={Math.max(1, Math.round((Number(scene.audioEndMs) / 1000) * fps))}
    />
  );
}

function IntroScene({ input, scene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = enter(frame, fps);
  return (
    <div style={styles.centerStage}>
      <div style={{ ...styles.eyebrow, opacity: reveal }}>A REAL AGENT INTERACTION</div>
      <h1 style={{ ...styles.hero, opacity: reveal, transform: `translateY(${(1 - reveal) * 48}px)` }}>
        {clean(scene.heading, input.title || "Watch the work happen")}
      </h1>
      <div style={styles.heroRule} />
      <p style={styles.heroCopy}>{clip(scene.onScreenText || scene.voiceover, 360)}</p>
      <div style={styles.sourceCount}>{input.sourceCount || 1} source interaction{input.sourceCount === 1 ? "" : "s"}</div>
    </div>
  );
}

function RequestScene({ scene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = enter(frame, fps, 2);
  return (
    <div style={styles.contentStage}>
      <div style={styles.sectionLabel}>REQUEST</div>
      <div style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 34}px)` }}>
        <UserBubble text={scene.requestText || scene.onScreenText} label={scene.requestLabel || "You"} />
      </div>
      <div style={styles.requestMeta}>
        <span style={styles.requestBadge}>{scene.authenticAudio ? "ORIGINAL REQUEST AUDIO" : "TYPED REQUEST"}</span>
        <span>{clean(scene.sourceReference, "Selected interaction")}</span>
      </div>
      <TimedCaption scene={scene} localFrame={frame} fps={fps} />
    </div>
  );
}

function ActivityScene({ scene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const activity = (scene.activity || []).slice(0, 6);
  return (
    <div style={styles.contentStage}>
      <div style={styles.sectionLabel}>PROCESSING & TOOL ACTIVITY</div>
      <div style={styles.activityList}>
        {activity.map((item, index) => {
          const reveal = enter(frame, fps, 6 + index * 9);
          return (
            <div key={`${item.label}-${index}`} style={{ ...styles.activityItem, opacity: reveal, transform: `translateX(${(1 - reveal) * 44}px)` }}>
              <div style={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</div>
              <div>
                <div style={styles.activityLabel}>{clean(item.label, "Agent activity")}</div>
                <div style={styles.activityDetail}>{clip(item.detail, 230) || "Completed"}</div>
              </div>
              <div style={styles.activityEnd}>
                <div style={styles.completeMark}>✓</div>
                <div style={styles.activityTiming}>+{(Math.max(0, Number(item.atMs) || 0) / 1000).toFixed(1)}s</div>
              </div>
            </div>
          );
        })}
      </div>
      {scene.onScreenText ? <div style={styles.sceneNote}>{clip(scene.onScreenText, 260)}</div> : null}
    </div>
  );
}

function ResponseScene({ scene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = enter(frame, fps, 2);
  return (
    <div style={styles.contentStage}>
      <div style={styles.sectionLabel}>RESPONSE</div>
      <div style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 30}px)` }}>
        <AgentBubble text={scene.responseText || scene.onScreenText} />
      </div>
      {(scene.highlights || []).length ? (
        <div style={styles.highlights}>
          {scene.highlights.slice(0, 4).map((item, index) => <div key={index} style={styles.highlight}>✓ {clip(item, 180)}</div>)}
        </div>
      ) : null}
    </div>
  );
}

function OutroScene({ input, scene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const reveal = enter(frame, fps);
  return (
    <div style={styles.centerStage}>
      <div style={{ ...styles.outroLogo, opacity: reveal }}>AGENT</div>
      <h2 style={{ ...styles.outroTitle, opacity: reveal }}>{clean(scene.heading, "The interaction, made visible")}</h2>
      <p style={styles.heroCopy}>{clip(scene.onScreenText || scene.voiceover, 360)}</p>
      <div style={styles.outroSource}>{clean(input.callToAction, "Built from the actual request, activity, and response")}</div>
    </div>
  );
}

function ScriptScene({ input, scene, index }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [0, 8, Math.max(9, durationInFrames - 8), durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  let content;
  if (scene.renderSceneType === "request") content = <RequestScene scene={scene} />;
  else if (scene.renderSceneType === "activity") content = <ActivityScene scene={scene} />;
  else if (scene.renderSceneType === "response") content = <ResponseScene scene={scene} />;
  else if (scene.renderSceneType === "outro") content = <OutroScene input={input} scene={scene} />;
  else content = <IntroScene input={input} scene={scene} />;
  return (
    <AbsoluteFill style={{ ...styles.scene, opacity }}>
      {content}
      <SceneAudio scene={scene} fps={fps} />
      <div style={styles.sceneIndex}>{String(index + 1).padStart(2, "0")}</div>
    </AbsoluteFill>
  );
}

export function InteractionVideo({ input }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const scenes = Array.isArray(input.scenes) ? input.scenes : [];
  let cursor = 0;
  return (
    <AbsoluteFill style={styles.page}>
      <TopBar input={input} />
      <div style={styles.canvasRule} />
      {scenes.map((scene, index) => {
        const duration = sceneFrames(scene, fps);
        const from = cursor;
        cursor += duration;
        return (
          <Sequence key={`${scene.sceneNumber || index}-${scene.renderSceneType}`} from={from} durationInFrames={duration}>
            <ScriptScene input={input} scene={scene} index={index} />
          </Sequence>
        );
      })}
      {input.disclosure ? <div style={styles.disclosure}>{clean(input.disclosure)}</div> : null}
      <div style={styles.progressTrack}><div style={{ ...styles.progressFill, width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%` }} /></div>
    </AbsoluteFill>
  );
}

const styles = {
  page: { background: "#f5f5f0", color: INK, fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif', overflow: "hidden" },
  topBar: { position: "absolute", left: 0, right: 0, top: 0, height: 116, display: "flex", alignItems: "center", gap: 20, padding: "0 52px", background: "#fff", borderBottom: "2px solid #dfe3da", zIndex: 20 },
  brandMark: { width: 58, height: 58, display: "grid", placeItems: "center", borderRadius: 17, background: AGENT, color: "#fff", fontSize: 31, fontWeight: 800 },
  brand: { color: AGENT, fontSize: 22, fontWeight: 850, letterSpacing: 4 },
  session: { maxWidth: 620, marginTop: 5, color: "#70776c", fontSize: 18, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  connected: { marginLeft: "auto", color: "#65705f", fontSize: 18, fontWeight: 650 },
  connectedDot: { display: "inline-block", width: 12, height: 12, marginRight: 8, borderRadius: "50%", background: "#6d9a5c" },
  canvasRule: { position: "absolute", left: 38, top: 144, bottom: 90, width: 3, background: "#e1e5dc" },
  scene: { padding: "156px 58px 112px", boxSizing: "border-box" },
  centerStage: { height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "0 38px" },
  contentStage: { height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 14px" },
  eyebrow: { color: AGENT, fontSize: 23, fontWeight: 850, letterSpacing: 5 },
  hero: { maxWidth: 900, margin: "42px 0 34px", color: INK, fontSize: 76, lineHeight: 1.06, letterSpacing: -3.5, fontWeight: 800 },
  heroRule: { width: 150, height: 8, background: AGENT, borderRadius: 8 },
  heroCopy: { maxWidth: 800, margin: "36px auto 0", color: "#5f675b", fontSize: 31, lineHeight: 1.42 },
  sourceCount: { marginTop: 46, padding: "13px 23px", borderRadius: 999, background: PALE, color: AGENT, fontSize: 19, fontWeight: 700 },
  sectionLabel: { marginBottom: 42, color: AGENT, fontSize: 22, fontWeight: 850, letterSpacing: 5 },
  userRow: { display: "flex", justifyContent: "flex-end" },
  userBubble: { maxWidth: 850, padding: "34px 39px", background: USER, color: "#fff", borderRadius: "28px 28px 7px 28px", boxShadow: "0 18px 42px rgba(49,61,45,.17)" },
  agentRow: { display: "flex", alignItems: "flex-start", gap: 20 },
  avatar: { flex: "0 0 auto", width: 56, height: 56, display: "grid", placeItems: "center", borderRadius: 16, background: AGENT, color: "#fff", fontSize: 27, fontWeight: 800 },
  agentBubble: { maxWidth: 850, padding: "34px 39px", background: "#fff", color: INK, border: "2px solid #dce1d7", borderRadius: "7px 28px 28px 28px", boxShadow: "0 18px 42px rgba(49,61,45,.09)" },
  bubbleLabel: { marginBottom: 14, color: "#e5ebdf", fontSize: 18, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" },
  bubbleText: { fontSize: 35, lineHeight: 1.4, fontWeight: 560, whiteSpace: "pre-wrap" },
  requestMeta: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 17, marginTop: 25, color: "#757d71", fontSize: 17 },
  requestBadge: { padding: "8px 13px", borderRadius: 8, background: PALE, color: AGENT, fontWeight: 800, letterSpacing: 1 },
  caption: { position: "absolute", left: 90, right: 90, bottom: 145, padding: "19px 26px", borderRadius: 15, background: "rgba(32,37,30,.92)", color: "#fff", textAlign: "center", fontSize: 27, lineHeight: 1.3, fontWeight: 700 },
  activityList: { display: "flex", flexDirection: "column", gap: 17 },
  activityItem: { minHeight: 102, display: "grid", gridTemplateColumns: "70px 1fr 54px", alignItems: "center", gap: 18, padding: "22px 25px", background: "#fff", border: "2px solid #dce1d7", borderRadius: 19, boxShadow: "0 10px 28px rgba(49,61,45,.07)" },
  stepNumber: { color: AGENT, fontSize: 24, fontWeight: 850, letterSpacing: 2 },
  activityLabel: { color: INK, fontSize: 27, fontWeight: 760 },
  activityDetail: { marginTop: 7, color: "#6b7367", fontSize: 20, lineHeight: 1.3 },
  completeMark: { width: 43, height: 43, display: "grid", placeItems: "center", borderRadius: "50%", background: PALE, color: AGENT, fontSize: 22, fontWeight: 850 },
  activityEnd: { display: "flex", flexDirection: "column", alignItems: "center", gap: 7 },
  activityTiming: { color: "#727a6e", fontSize: 14, fontWeight: 700 },
  sceneNote: { marginTop: 28, paddingLeft: 12, color: "#697165", fontSize: 24, lineHeight: 1.38 },
  highlights: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, margin: "30px 0 0 76px" },
  highlight: { padding: "17px 20px", borderRadius: 13, background: PALE, color: AGENT, fontSize: 20, fontWeight: 690 },
  outroLogo: { color: AGENT, fontSize: 33, fontWeight: 900, letterSpacing: 9 },
  outroTitle: { maxWidth: 840, margin: "43px 0 0", color: INK, fontSize: 68, lineHeight: 1.08, letterSpacing: -3, fontWeight: 820 },
  outroSource: { marginTop: 52, color: AGENT, fontSize: 21, fontWeight: 800, letterSpacing: 2 },
  sceneIndex: { position: "absolute", right: 57, bottom: 66, color: "#afb6aa", fontSize: 20, fontWeight: 800, letterSpacing: 3 },
  disclosure: { position: "absolute", left: 58, bottom: 57, color: "#747c70", fontSize: 16, fontWeight: 620, zIndex: 30 },
  progressTrack: { position: "absolute", left: 0, right: 0, bottom: 0, height: 10, background: "#dce1d7", zIndex: 40 },
  progressFill: { height: "100%", background: AGENT },
};
