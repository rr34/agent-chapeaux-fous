const allowedVoices = new Set([
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova",
  "onyx", "sage", "shimmer", "verse", "marin", "cedar",
]);
const maximumSpeechCharacters = 20_000;
const maximumChunkCharacters = 3_000;
const pcmSampleRate = 24_000;
const pcmBytesPerSample = 2;

function requiredText(value, label, maximum) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > maximum) throw new Error(`${label} cannot exceed ${maximum} characters`);
  return text;
}

function selectedVoice(value) {
  const voice = requiredText(value, "TTS voice", 40).toLowerCase();
  if (!allowedVoices.has(voice)) throw new Error(`Unknown TTS voice: ${voice}`);
  return voice;
}

function speechChunks(text) {
  const chunks = [];
  let remaining = text;
  const preferredBreaks = [". ", "! ", "? ", "; ", ", ", " "];
  while (remaining.length > maximumChunkCharacters) {
    const candidate = remaining.slice(0, maximumChunkCharacters + 1);
    const minimumBreak = Math.floor(maximumChunkCharacters * 0.6);
    let cut = maximumChunkCharacters;
    for (const marker of preferredBreaks) {
      const found = candidate.lastIndexOf(marker, maximumChunkCharacters);
      if (found >= minimumBreak) {
        cut = found + marker.length;
        break;
      }
    }
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function wavFromPcm(pcm) {
  if (pcm.length % pcmBytesPerSample !== 0) {
    throw new Error("OpenAI speech generation returned malformed PCM audio");
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(pcmSampleRate, 24);
  header.writeUInt32LE(pcmSampleRate * pcmBytesPerSample, 28);
  header.writeUInt16LE(pcmBytesPerSample, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class OpenAISpeechService {
  constructor({
    apiKey,
    baseUrl = "https://api.openai.com/v1",
    model = "gpt-4o-mini-tts",
    voice = "ash",
    instructions = "Speak quickly and naturally in a playful casual conversation. Avoid announcer, tutorial, corporate-demo, audiobook, and sales-presentation delivery.",
    timeoutMs = 120_000,
    fetchImpl = globalThis.fetch,
  }) {
    this.apiKey = String(apiKey ?? "").trim();
    this.baseUrl = String(baseUrl).replace(/\/+$/u, "");
    this.model = requiredText(model, "TTS model", 100);
    this.voice = selectedVoice(voice);
    this.instructions = requiredText(instructions, "TTS instructions", 1_000);
    this.timeoutMs = Number(timeoutMs);
    this.fetchImpl = fetchImpl;
  }

  async synthesize(text, { instructions = this.instructions, voice = this.voice } = {}) {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is required for server-side video narration");
    const input = requiredText(text, "Narration text", maximumSpeechCharacters);
    const requestedVoice = selectedVoice(voice);
    const requestedInstructions = requiredText(instructions, "TTS instructions", 1_000);
    const chunks = speechChunks(input);
    const pcmParts = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const response = await this.fetchImpl(`${this.baseUrl}/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          voice: requestedVoice,
          input: chunks[index],
          instructions: requestedInstructions,
          response_format: "pcm",
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const body = await response.json();
          detail = body?.error?.message || detail;
        } catch {
          // The bounded status is sufficient when the provider did not return JSON.
        }
        throw new Error(`OpenAI speech generation failed in chunk ${index + 1} of ${chunks.length}: ${detail}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length === 0) throw new Error(`OpenAI speech generation returned empty audio for chunk ${index + 1}`);
      if (bytes.length > 20 * 1024 * 1024) throw new Error(`OpenAI speech chunk ${index + 1} exceeded the audio limit`);
      pcmParts.push(bytes);
    }
    const pcm = Buffer.concat(pcmParts);
    if (pcm.length > 256 * 1024 * 1024) throw new Error("OpenAI speech generation exceeded the combined audio limit");
    return {
      bytes: wavFromPcm(pcm),
      mimeType: "audio/wav",
      model: this.model,
      voice: requestedVoice,
      chunkCount: chunks.length,
      durationMs: Math.round((pcm.length / (pcmSampleRate * pcmBytesPerSample)) * 1_000),
      aiGenerated: true,
    };
  }
}
