const allowedVoices = new Set([
  "alloy", "ash", "ballad", "coral", "echo", "fable", "nova",
  "onyx", "sage", "shimmer", "verse", "marin", "cedar",
]);

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

export class OpenAISpeechService {
  constructor({
    apiKey,
    baseUrl = "https://api.openai.com/v1",
    model = "gpt-4o-mini-tts",
    voice = "cedar",
    instructions = "Speak clearly, warmly, and confidently at a natural documentary pace.",
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
    const input = requiredText(text, "Narration text", 4_096);
    const requestedVoice = selectedVoice(voice);
    const response = await this.fetchImpl(`${this.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        voice: requestedVoice,
        input,
        instructions: requiredText(instructions, "TTS instructions", 1_000),
        response_format: "mp3",
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
      throw new Error(`OpenAI speech generation failed: ${detail}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error("OpenAI speech generation returned empty audio");
    if (bytes.length > 20 * 1024 * 1024) throw new Error("OpenAI speech generation exceeded the audio limit");
    return {
      bytes,
      mimeType: response.headers.get("content-type")?.split(";", 1)[0] || "audio/mpeg",
      model: this.model,
      voice: requestedVoice,
      aiGenerated: true,
    };
  }
}
