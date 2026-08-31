import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const directory = path.dirname(fileURLToPath(import.meta.url));
const entryPoint = path.join(directory, "remotion", "index.jsx");
const compositionId = "scripted-agent-ui-story";
let bundlePromise;

function bundleLocation() {
  if (!bundlePromise) bundlePromise = bundle({ entryPoint, onProgress: () => {} });
  return bundlePromise;
}

export async function renderScriptedInteractionVideo({ input, outputLocation, browserExecutable = null }) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Video input must be an object");
  const output = path.resolve(String(outputLocation || ""));
  if (!output.toLowerCase().endsWith(".mp4")) throw new Error("Video output must be an MP4 path");
  await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  const inputProps = { input };
  const serveUrl = await bundleLocation();
  const composition = await selectComposition({
    serveUrl, id: compositionId, inputProps, browserExecutable, logLevel: "warn",
  });
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    audioCodec: "aac",
    outputLocation: output,
    overwrite: true,
    browserExecutable,
    logLevel: "warn",
  });
  return {
    compositionId,
    outputLocation: output,
    durationSeconds: composition.durationInFrames / composition.fps,
    width: composition.width,
    height: composition.height,
  };
}

// Preserve the historical single-interaction entry point as a small adapter;
// the active server path always supplies the full script-driven scene contract.
export async function renderInteractionVideo(options) {
  const legacy = options?.input;
  if (Array.isArray(legacy?.scenes)) return renderScriptedInteractionVideo(options);
  const audioSeconds = Math.max(1, (Number(legacy?.audioEndMs) - Number(legacy?.audioStartMs)) / 1000 || 4);
  const input = {
    title: legacy?.title || "A real agent interaction",
    sourceCount: 1,
    scenes: [
      {
        sceneNumber: 1, renderSceneType: "request", requestText: legacy?.normalizedTranscript,
        authenticAudio: true,
        audioDataUrl: legacy?.audioDataUrl, audioStartMs: legacy?.audioStartMs,
        audioEndMs: legacy?.audioEndMs, captionCues: legacy?.captionCues,
        rawWords: legacy?.rawWords, durationSeconds: audioSeconds,
      },
      {
        sceneNumber: 2, renderSceneType: "response",
        responseText: (legacy?.responseHighlights || []).join(" "),
        durationSeconds: Math.max(3, legacy?.responseHighlights?.length * 1.5 || 3),
      },
    ],
    render: legacy?.render || { fps: 30, width: 1080, height: 1620 },
  };
  return renderScriptedInteractionVideo({ ...options, input });
}
