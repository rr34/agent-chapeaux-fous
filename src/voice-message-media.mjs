import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const voiceMessageMaximumDurationMs = 60_000;
export const voiceMessageMaximumUploadBytes = 4 * 1024 * 1024;
const encodedDurationToleranceMs = 500;

const acceptedTypes = new Map([
  ["audio/ogg", "ogg"],
  ["audio/webm", "webm"],
  ["audio/mp4", "m4a"],
  ["video/mp4", "m4a"],
  ["audio/wav", "wav"],
]);

function diagnosticDetail(error) {
  return String(error?.stderr || error?.message || error || "unknown media error")
    .replace(/\s+/gu, " ").trim().slice(0, 2000);
}

function inputError(message, statusCode = 400, code = "VOICE_INVALID", detail = "") {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    ...(detail ? { diagnosticDetail: detail } : {}),
  });
}

export function parseProbedDurationMs(stdout) {
  let parsed;
  try { parsed = JSON.parse(String(stdout)); }
  catch { throw inputError("The voice message is not valid audio.", 400, "VOICE_PROBE"); }
  const seconds = Number(parsed?.format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw inputError("The voice message has no measurable audio duration.", 400, "VOICE_DURATION");
  }
  return Math.round(seconds * 1000);
}

async function probeDurationMs(filename, run = execFileAsync, code = "VOICE_PROBE") {
  try {
    const { stdout } = await run("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "json", filename,
    ], { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 30_000 });
    return parseProbedDurationMs(stdout);
  } catch (error) {
    if (error?.statusCode) throw error;
    throw inputError("The voice message is not valid audio.", 400, code, diagnosticDetail(error));
  }
}

export async function receiveVoiceMessage(request, { mediaRoot, run = execFileAsync } = {}) {
  const mimeType = String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  const inputExtension = acceptedTypes.get(mimeType);
  if (!inputExtension) throw inputError(
    "Voice messages must use Ogg, WebM, MP4, or WAV audio.", 415, "VOICE_TYPE",
  );

  const now = new Date();
  const relativeDirectory = path.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"));
  const directory = path.join(mediaRoot, relativeDirectory);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const inputFilename = path.join(directory, `${randomUUID()}.incoming.${inputExtension}`);
  const outputName = `${randomUUID()}.ogg`;
  const outputFilename = path.join(directory, outputName);
  const inputHandle = await fsp.open(inputFilename, "wx", 0o600);
  let byteSize = 0;
  try {
    for await (const chunk of request) {
      byteSize += chunk.length;
      if (byteSize > voiceMessageMaximumUploadBytes) {
        throw inputError("Voice message upload is too large.", 413, "VOICE_SIZE");
      }
      await inputHandle.write(chunk);
    }
    await inputHandle.sync();
  } catch (error) {
    await inputHandle.close();
    await fsp.unlink(inputFilename).catch(() => {});
    throw error;
  }
  await inputHandle.close();
  if (byteSize === 0) {
    await fsp.unlink(inputFilename).catch(() => {});
    throw inputError("Voice message upload was empty.", 400, "VOICE_EMPTY");
  }

  try {
    try {
      const inputDurationMs = await probeDurationMs(inputFilename, run, "VOICE_INPUT_PROBE");
      if (inputDurationMs > voiceMessageMaximumDurationMs + encodedDurationToleranceMs) {
        throw inputError("Voice messages may be at most one minute long.", 413, "VOICE_TOO_LONG");
      }
    } catch (error) {
      // Some playable streaming containers do not expose duration metadata until
      // they are remuxed. The bounded canonicalization below is also a decoder
      // validation step, so allow it to repair only probe failures. Preserve
      // policy errors such as an input that is measurably over one minute.
      if (error?.statusCode !== 400) throw error;
    }
    try {
      await run("ffmpeg", [
        "-nostdin", "-loglevel", "error", "-i", inputFilename, "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "libopus", "-b:a", "24k", "-t", String(voiceMessageMaximumDurationMs / 1000),
        "-f", "ogg", "-y", outputFilename,
      ], { maxBuffer: 1024 * 1024, timeout: 30_000 });
    } catch (error) {
      throw inputError(
        "The voice message could not be converted to Ogg/Opus.", 400,
        "VOICE_CONVERT", diagnosticDetail(error),
      );
    }
    const durationMs = await probeDurationMs(outputFilename, run, "VOICE_OUTPUT_PROBE");
    if (durationMs > voiceMessageMaximumDurationMs + encodedDurationToleranceMs) {
      throw inputError("Voice messages may be at most one minute long.", 413, "VOICE_TOO_LONG");
    }
    const bytes = await fsp.readFile(outputFilename);
    return {
      absoluteFilename: outputFilename,
      storagePath: path.posix.join("media", ...relativeDirectory.split(path.sep), outputName),
      originalFilename: "voice-message.ogg",
      mimeType: "audio/ogg",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.length,
      durationMs: Math.min(voiceMessageMaximumDurationMs, durationMs),
    };
  } catch (error) {
    await fsp.unlink(outputFilename).catch(() => {});
    if (error?.statusCode) throw error;
    throw inputError(
      "The voice message could not be converted to Ogg/Opus.", 400,
      "VOICE_CONVERT", diagnosticDetail(error),
    );
  } finally {
    await fsp.unlink(inputFilename).catch(() => {});
  }
}
