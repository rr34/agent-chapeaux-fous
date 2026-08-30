import React from "react";
import { Composition } from "remotion";
import { InteractionVideo } from "./InteractionVideo.jsx";

export const SCRIPTED_INTERACTION_VIDEO_ID = "scripted-agent-ui-story";

const defaultProps = {
  input: {
    title: "A real agent interaction",
    sourceCount: 1,
    disclosure: "Includes AI-generated narration",
    scenes: [
      { sceneNumber: 1, renderSceneType: "intro", heading: "Watch the work happen", onScreenText: "A request becomes a visible, verifiable result.", durationSeconds: 4 },
      { sceneNumber: 2, renderSceneType: "request", requestText: "Show me what happened in that interaction.", sourceReference: "Request #1", durationSeconds: 5 },
      { sceneNumber: 3, renderSceneType: "activity", activity: [{ label: "Agent", detail: "Processed the request" }], durationSeconds: 5 },
      { sceneNumber: 4, renderSceneType: "response", responseText: "The work is complete and the interaction is preserved.", durationSeconds: 5 },
      { sceneNumber: 5, renderSceneType: "outro", heading: "The interaction, made visible", durationSeconds: 4 },
    ],
    render: { width: 1080, height: 1920, fps: 30 },
  },
};

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : fallback;
}

function metadata({ props }) {
  const input = props?.input ?? {};
  const render = input.render ?? {};
  const fps = positiveInteger(render.fps, 30);
  const totalSeconds = (Array.isArray(input.scenes) ? input.scenes : [])
    .reduce((sum, scene) => sum + Math.max(1 / fps, Number(scene?.durationSeconds) || 4), 0);
  return {
    width: positiveInteger(render.width, 1080),
    height: positiveInteger(render.height, 1920),
    fps,
    durationInFrames: Math.max(1, Math.min(fps * 600, Math.round(totalSeconds * fps))),
  };
}

export function RemotionRoot() {
  return (
    <Composition
      id={SCRIPTED_INTERACTION_VIDEO_ID}
      component={InteractionVideo}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={690}
      defaultProps={defaultProps}
      calculateMetadata={metadata}
    />
  );
}
