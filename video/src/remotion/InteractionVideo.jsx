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
const SPEECH_LEAD_IN_SECONDS = 0.24;

function clean(value, fallback = "") {
  return String(value ?? "").replace(/\s+/g, " ").trim() || fallback;
}

function sceneFrames(scene, fps) {
  return Math.max(1, Math.round((Number(scene?.durationSeconds) || 3) * fps));
}

function messageText(scene) {
  return clean(
    scene?.renderSceneType === "request" ? scene.requestText : scene.responseText,
    scene?.renderSceneType === "request" ? "Voice request" : "No response was recorded.",
  );
}

function textMetrics(text, current) {
  const length = text.length;
  const fontSize = length > 1800 ? 21 : length > 1000 ? 24 : length > 500 ? 28 : 33;
  const lineHeight = fontSize * 1.38;
  const charactersPerLine = Math.max(24, Math.floor(730 / (fontSize * 0.54)));
  const estimatedLines = Math.max(1, Math.ceil(length / charactersPerLine));
  const estimatedHeight = estimatedLines * lineHeight;
  const maximumHeight = current ? 760 : estimatedHeight + 8;
  return { fontSize, lineHeight, estimatedHeight, maximumHeight };
}

function messageHeight(scene) {
  const metrics = textMetrics(messageText(scene), true);
  return Math.min(metrics.maximumHeight, metrics.estimatedHeight + 8) + 93;
}

function timedWords(scene) {
  return (Array.isArray(scene?.rawWords) ? scene.rawWords : []).filter((word) => (
    Number.isFinite(Number(word?.startMs))
    && Number.isFinite(Number(word?.endMs))
    && Number(word.endMs) > Number(word.startMs)
  ));
}

function HighlightedText({ text, scene, current, speechMs }) {
  const words = timedWords(scene);
  const activeWord = current && speechMs >= 0
    ? words.findIndex((word) => speechMs >= Number(word.startMs) - 35 && speechMs < Number(word.endMs) + 55)
    : -1;
  let wordIndex = -1;
  return (text.match(/\s+|[^\s]+/gu) || [text]).map((piece, pieceIndex) => {
    if (/^\s+$/u.test(piece)) return <React.Fragment key={`space-${pieceIndex}`}>{piece}</React.Fragment>;
    wordIndex += 1;
    const active = wordIndex === activeWord;
    return (
      <span
        key={`word-${pieceIndex}`}
        style={active ? {
          background: scene.renderSceneType === "request" ? "#f4e86f" : "#9ac477",
          color: INK,
          borderRadius: 7,
          boxShadow: "0 2px 0 rgba(32,37,30,.16)",
          fontWeight: 820,
          margin: "0 -3px",
          padding: "1px 3px 2px",
        } : undefined}
      >
        {piece}
      </span>
    );
  });
}

function MessageText({ text, current, scene }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const metrics = textMetrics(text, current);
  const viewportHeight = Math.min(metrics.maximumHeight, metrics.estimatedHeight + 8);
  const overflow = Math.max(0, metrics.estimatedHeight - viewportHeight + 12);
  const scrollStart = Math.min(durationInFrames - 1, Math.round(fps * 0.5));
  const scrollEnd = Math.max(scrollStart + 1, durationInFrames - Math.round(fps * 0.5));
  const scroll = current && overflow > 0
    ? interpolate(frame, [scrollStart, scrollEnd], [0, overflow], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      })
    : 0;
  return (
    <div style={{ height: viewportHeight, overflow: "hidden" }}>
      <div style={{
        fontSize: metrics.fontSize,
        lineHeight: `${metrics.lineHeight}px`,
        fontWeight: 560,
        transform: `translateY(${-scroll}px)`,
      }}>
        <HighlightedText
          text={text}
          scene={scene}
          current={current}
          speechMs={((frame / fps) - SPEECH_LEAD_IN_SECONDS) * 1_000 * (Number(scene.playbackRate) || 1)}
        />
      </div>
    </div>
  );
}

function UserBubble({ scene, current }) {
  return (
    <div style={{ ...styles.messageRow, justifyContent: "flex-end" }}>
      <div style={{ ...styles.bubble, ...styles.userBubble, ...(current ? styles.currentBubble : styles.previousBubble) }}>
        <div style={{ ...styles.bubbleLabel, color: "#e5ebdf" }}>You</div>
        <MessageText text={messageText(scene)} current={current} scene={scene} />
      </div>
    </div>
  );
}

function AgentBubble({ scene, current }) {
  return (
    <div style={{ ...styles.messageRow, justifyContent: "flex-start", alignItems: "flex-start" }}>
      <div style={styles.avatar}>A</div>
      <div style={{ ...styles.bubble, ...styles.agentBubble, ...(current ? styles.currentBubble : styles.previousBubble) }}>
        <div style={{ ...styles.bubbleLabel, color: AGENT }}>Agent</div>
        <MessageText text={messageText(scene)} current={current} scene={scene} />
      </div>
    </div>
  );
}

function SceneAudio({ scene, fps }) {
  if (!scene?.audioDataUrl) return null;
  const delayFrames = Math.max(1, Math.round(SPEECH_LEAD_IN_SECONDS * fps));
  const playbackRate = Number(scene.playbackRate) || 1;
  if (!scene.authenticAudio) {
    return (
      <Sequence from={delayFrames}>
        <Audio src={scene.audioDataUrl} playbackRate={playbackRate} />
      </Sequence>
    );
  }
  return (
    <Sequence from={delayFrames}>
      <Audio
        src={scene.audioDataUrl}
        startFrom={Math.max(0, Math.round((Number(scene.audioStartMs) / 1000) * fps))}
        endAt={Math.max(1, Math.round((Number(scene.audioEndMs) / 1000) * fps))}
        playbackRate={playbackRate}
      />
    </Sequence>
  );
}

function ChatScene({ scenes, index }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const visibleMessages = scenes.slice(0, index + 1);
  const reveal = spring({ frame, fps, config: { damping: 9, stiffness: 185, mass: 0.65 } });
  const activeScene = scenes[index];
  const settled = Math.max(0, Math.min(1, reveal));
  const translateY = Math.max(0, (1 - reveal) * 138);
  const scale = 0.74 + (0.26 * reveal);
  return (
    <AbsoluteFill style={styles.chatStage}>
      <div style={styles.thread}>
        {visibleMessages.map((scene, visibleIndex) => {
          const current = visibleIndex === visibleMessages.length - 1;
          return (
            <div
              key={`${scene.sceneNumber}-${scene.renderSceneType}`}
              style={{
                ...styles.message,
                ...(current ? {
                  height: messageHeight(scene) * settled,
                  minHeight: 0,
                  opacity: Math.max(0, Math.min(1, reveal * 1.8)),
                  transform: `translateY(${translateY}px) scale(${scale})`,
                  transformOrigin: scene.renderSceneType === "request" ? "100% 100%" : "0% 100%",
                  zIndex: 2,
                } : {}),
              }}
            >
              {scene.renderSceneType === "request"
                ? <UserBubble scene={scene} current={current} />
                : <AgentBubble scene={scene} current={current} />}
            </div>
          );
        })}
      </div>
      <SceneAudio scene={activeScene} fps={fps} />
    </AbsoluteFill>
  );
}

function TopBar() {
  return (
    <div style={styles.topBar}>
      <div style={styles.brandMark}>A</div>
      <div style={styles.brand}>AGENT</div>
      <div style={styles.connected}><span style={styles.connectedDot} /> connected</div>
    </div>
  );
}

export function InteractionVideo({ input }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const scenes = (Array.isArray(input.scenes) ? input.scenes : [])
    .filter(({ renderSceneType }) => renderSceneType === "request" || renderSceneType === "response");
  let cursor = 0;
  return (
    <AbsoluteFill style={styles.page}>
      <TopBar />
      {scenes.map((scene, index) => {
        const duration = sceneFrames(scene, fps);
        const from = cursor;
        cursor += duration;
        return (
          <Sequence key={`${scene.sceneNumber}-${scene.renderSceneType}`} from={from} durationInFrames={duration}>
            <ChatScene scenes={scenes} index={index} />
          </Sequence>
        );
      })}
      {input.disclosure ? <div style={styles.disclosure}>{clean(input.disclosure)}</div> : null}
      <div style={styles.progressTrack}>
        <div style={{ ...styles.progressFill, width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%` }} />
      </div>
    </AbsoluteFill>
  );
}

const styles = {
  page: {
    background: "#f5f5f0",
    color: INK,
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    overflow: "hidden",
  },
  topBar: {
    position: "absolute", left: 0, right: 0, top: 0, height: 104,
    display: "flex", alignItems: "center", gap: 20, padding: "0 50px",
    background: "#fff", borderBottom: "2px solid #dfe3da", zIndex: 20,
  },
  brandMark: {
    width: 56, height: 56, display: "grid", placeItems: "center", borderRadius: 16,
    background: AGENT, color: "#fff", fontSize: 29, fontWeight: 800,
  },
  brand: { color: AGENT, fontSize: 21, fontWeight: 850, letterSpacing: 4 },
  connected: { marginLeft: "auto", color: "#65705f", fontSize: 17, fontWeight: 650 },
  connectedDot: {
    display: "inline-block", width: 11, height: 11, marginRight: 8,
    borderRadius: "50%", background: "#6d9a5c",
  },
  chatStage: { padding: "138px 60px 88px", boxSizing: "border-box" },
  thread: {
    height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end",
    gap: 26, overflow: "hidden",
  },
  message: { flex: "0 0 auto" },
  messageRow: { display: "flex", gap: 18, width: "100%" },
  bubble: { maxWidth: 850, padding: "27px 32px", boxSizing: "border-box" },
  currentBubble: { opacity: 1 },
  previousBubble: { opacity: 1 },
  userBubble: {
    background: USER, color: "#fff", borderRadius: "27px 27px 7px 27px",
    boxShadow: "0 17px 40px rgba(49,61,45,.17)",
  },
  agentBubble: {
    background: "#fff", color: INK, border: "2px solid #dce1d7",
    borderRadius: "7px 27px 27px 27px", boxShadow: "0 17px 40px rgba(49,61,45,.09)",
  },
  avatar: {
    flex: "0 0 auto", width: 54, height: 54, display: "grid", placeItems: "center",
    borderRadius: 15, background: AGENT, color: "#fff", fontSize: 26, fontWeight: 800,
  },
  bubbleLabel: {
    marginBottom: 12, fontSize: 17, fontWeight: 800, letterSpacing: 2,
    textTransform: "uppercase",
  },
  disclosure: {
    position: "absolute", left: 60, bottom: 39, color: "#747c70",
    fontSize: 14, fontWeight: 620, zIndex: 30,
  },
  progressTrack: {
    position: "absolute", left: 0, right: 0, bottom: 0, height: 8,
    background: "#dce1d7", zIndex: 40,
  },
  progressFill: { height: "100%", background: PALE },
};
