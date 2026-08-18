import React from "react";
import { Composition } from "remotion";
import { InteractionVideo } from "./InteractionVideo.jsx";

export const INTERACTION_VIDEO_ID = "slayer-interaction";

const defaultProps = {
  input: {
    title: "I asked my agent to handle it",
    normalizedTranscript: "Show me what happened in that last interaction.",
    captionCues: [{ startMs: 0, endMs: 2500, text: "Show me what happened in that last interaction." }],
    rawWords: [{ startMs: 0, endMs: 400, word: "Show" }],
    audioStartMs: 0,
    audioEndMs: 2500,
    audioDataUrl: "",
    responseHighlights: ["The request was understood.", "The work was recorded in the exact trace."],
    activity: [{ label: "Agent", detail: "Processed the request", atMs: 0 }],
    render: { width: 1080, height: 1920, fps: 30, durationSeconds: 32 },
  },
};

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : fallback;
}

function metadata({ props }) {
  const render = props?.input?.render ?? {};
  const fps = positiveInteger(render.fps, 30);
  const durationSeconds = Math.max(20, Math.min(60, Number(render.durationSeconds) || 35));
  return {
    width: positiveInteger(render.width, 1080),
    height: positiveInteger(render.height, 1920),
    fps,
    durationInFrames: Math.max(1, Math.round(durationSeconds * fps)),
  };
}

export function RemotionRoot() {
  return (
    <Composition
      id={INTERACTION_VIDEO_ID}
      component={InteractionVideo}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={1050}
      defaultProps={defaultProps}
      calculateMetadata={metadata}
    />
  );
}
