import { randomUUID } from "node:crypto";

const defaultInstructions = "Speak as a warm, concise concert companion. Use a natural conversational pace, pronounce musical titles carefully, and speak the supplied words verbatim without adding commentary.";

function narrationText(value) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (!text) throw Object.assign(new Error("Narration text is required"), { statusCode: 400 });
  if (text.length > 2_000) {
    throw Object.assign(new Error("Narration text cannot exceed 2000 characters"), { statusCode: 400 });
  }
  return text;
}

function narrationVolume(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw Object.assign(new Error("Narration volume must be between 0 and 1"), { statusCode: 400 });
  }
  return volume;
}

function scaledPcmWav(bytes, volume) {
  const output = Buffer.from(bytes);
  if (volume === 1) return output;
  if (output.length < 44 || output.toString("ascii", 0, 4) !== "RIFF" || output.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Generated narration is not a supported WAV file");
  }
  let offset = 12;
  let format = null;
  let bitsPerSample = null;
  let dataOffset = null;
  let dataLength = null;
  while (offset + 8 <= output.length) {
    const chunkType = output.toString("ascii", offset, offset + 4);
    const chunkLength = output.readUInt32LE(offset + 4);
    const contentOffset = offset + 8;
    if (contentOffset + chunkLength > output.length) break;
    if (chunkType === "fmt " && chunkLength >= 16) {
      format = output.readUInt16LE(contentOffset);
      bitsPerSample = output.readUInt16LE(contentOffset + 14);
    }
    if (chunkType === "data") {
      dataOffset = contentOffset;
      dataLength = chunkLength;
      break;
    }
    offset = contentOffset + chunkLength + (chunkLength % 2);
  }
  if (format !== 1 || bitsPerSample !== 16 || dataOffset == null || dataLength == null || dataLength % 2 !== 0) {
    throw new Error("Generated narration WAV must contain 16-bit PCM audio");
  }
  for (let sampleOffset = dataOffset; sampleOffset < dataOffset + dataLength; sampleOffset += 2) {
    const scaled = Math.round(output.readInt16LE(sampleOffset) * volume);
    output.writeInt16LE(Math.max(-32_768, Math.min(32_767, scaled)), sampleOffset);
  }
  return output;
}

export class MusicNarrationService {
  constructor({
    speech,
    voice = "cedar",
    instructions = defaultInstructions,
    maximumEntries = 100,
    maximumBytes = 128 * 1024 * 1024,
    ttlMs = 6 * 60 * 60 * 1_000,
    now = () => Date.now(),
    createId = randomUUID,
  }) {
    this.speech = speech;
    this.voice = voice;
    this.instructions = instructions;
    this.maximumEntries = maximumEntries;
    this.maximumBytes = maximumBytes;
    this.ttlMs = ttlMs;
    this.now = now;
    this.createId = createId;
    this.entries = new Map();
  }

  prune() {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAtMs <= now) this.entries.delete(id);
    }
    let byteSize = [...this.entries.values()].reduce((total, entry) => total + entry.bytes.length, 0);
    while (this.entries.size > this.maximumEntries || byteSize > this.maximumBytes) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.entries.delete(oldest[0]);
      byteSize -= oldest[1].bytes.length;
    }
  }

  async create(input) {
    const text = narrationText(input?.text);
    const generated = await this.speech.synthesize(text, {
      instructions: this.instructions,
      voice: this.voice,
    });
    if (generated.bytes.length > this.maximumBytes) {
      throw Object.assign(new Error("Generated narration is too large"), { statusCode: 413 });
    }
    const narrationId = this.createId();
    const createdAtMs = this.now();
    this.entries.set(narrationId, {
      narrationId,
      text,
      bytes: generated.bytes,
      mimeType: generated.mimeType,
      durationMs: generated.durationMs,
      model: generated.model,
      voice: generated.voice,
      aiGenerated: true,
      createdAtMs,
      expiresAtMs: createdAtMs + this.ttlMs,
    });
    this.prune();
    return {
      narrationId,
      durationMs: generated.durationMs,
      model: generated.model,
      voice: generated.voice,
      aiGenerated: true,
      streamUrl: `/api/music/narrations/${narrationId}/stream`,
    };
  }

  async createPrepared(input) {
    const text = narrationText(input?.text);
    const volume = narrationVolume(input?.volume);
    const source = input?.sourceNarrationId ? this.get(input.sourceNarrationId) : null;
    if (input?.sourceOnly && (source?.text !== text || source.preparedVolume != null)) {
      throw Object.assign(new Error("The source narration is unavailable or does not match"), { statusCode: 409 });
    }
    const generated = source?.text === text && source.preparedVolume == null
      ? source
      : await this.speech.synthesize(text, {
        instructions: this.instructions,
        voice: this.voice,
      });
    const bytes = scaledPcmWav(generated.bytes, volume);
    if (bytes.length > this.maximumBytes) {
      throw Object.assign(new Error("Generated narration is too large"), { statusCode: 413 });
    }
    const narrationId = this.createId();
    const createdAtMs = this.now();
    this.entries.set(narrationId, {
      narrationId,
      text,
      bytes,
      mimeType: generated.mimeType,
      durationMs: generated.durationMs,
      model: generated.model,
      voice: generated.voice,
      aiGenerated: true,
      preparedVolume: volume,
      createdAtMs,
      expiresAtMs: createdAtMs + this.ttlMs,
    });
    this.prune();
    return {
      narrationId,
      durationMs: generated.durationMs,
      model: generated.model,
      voice: generated.voice,
      aiGenerated: true,
      preparedVolume: volume,
      streamUrl: `/api/music/narrations/${narrationId}/stream`,
    };
  }

  get(narrationId) {
    this.prune();
    return this.entries.get(String(narrationId)) ?? null;
  }

  remove(narrationId) {
    return this.entries.delete(String(narrationId));
  }
}
