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

  get(narrationId) {
    this.prune();
    return this.entries.get(String(narrationId)) ?? null;
  }
}
