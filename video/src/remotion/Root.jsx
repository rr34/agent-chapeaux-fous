import React from "react";
import { Composition } from "remotion";
import { InteractionVideo } from "./InteractionVideo.jsx";

export const SCRIPTED_INTERACTION_VIDEO_ID = "scripted-agent-ui-story";

const defaultProps = {
  input: {
    title: "A real agent interaction",
    sourceCount: 1,
    disclosure: "Includes AI-generated voices",
    scenes: [
      { sceneNumber: 1, renderSceneType: "request", requestText: "Show me what happened in that interaction.", durationSeconds: 4 },
      { sceneNumber: 2, renderSceneType: "response", responseText: "The work is complete and the interaction is preserved.", durationSeconds: 5 },
    ],
    render: { width: 1080, height: 1620, fps: 30 },
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
    width: 1080,
    height: 1620,
    fps,
    durationInFrames: Math.max(1, Math.min(fps * 7_200, Math.round(totalSeconds * fps))),
  };
}

export function RemotionRoot() {
  return (
    <Composition
      id={SCRIPTED_INTERACTION_VIDEO_ID}
      component={InteractionVideo}
      width={1080}
      height={1620}
      fps={30}
      durationInFrames={270}
      defaultProps={defaultProps}
      calculateMetadata={metadata}
    />
  );
}
