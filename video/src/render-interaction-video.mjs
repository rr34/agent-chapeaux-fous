import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

const directory = path.dirname(fileURLToPath(import.meta.url));
const entryPoint = path.join(directory, "remotion", "index.jsx");
const compositionId = "slayer-interaction";
let bundlePromise;

function bundleLocation() {
  if (!bundlePromise) bundlePromise = bundle({ entryPoint, onProgress: () => {} });
  return bundlePromise;
}

export async function renderInteractionVideo({ input, outputLocation, browserExecutable = null }) {
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
