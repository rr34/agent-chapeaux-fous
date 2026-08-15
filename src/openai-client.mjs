export class OpenAIResponsesClient {
  constructor({ apiKey, baseUrl, fetchImplementation = globalThis.fetch }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetch = fetchImplementation;
  }

  health() {
    return {
      ready: Boolean(this.apiKey),
      baseUrl: this.baseUrl,
      reason: this.apiKey ? null : "OPENAI_API_KEY is missing",
    };
  }

  async create(payload, { signal } = {}) {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is missing");
    const response = await this.fetch(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    if (!response.ok) {
      const message = body?.error?.message || body?.message || text || `HTTP ${response.status}`;
      const error = new Error(`Responses API ${response.status}: ${message}`);
      error.statusCode = response.status;
      error.responseBody = body;
      throw error;
    }
    return body;
  }
}
