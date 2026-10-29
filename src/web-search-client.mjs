const endpoint = "https://api.search.brave.com/res/v1/web/search";
const maximumResponseBytes = 2 * 1024 * 1024;

function inputError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function plainText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/gu, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/gu, " ")
    .trim();
}

function publicResultUrl(value) {
  try {
    const url = new URL(String(value));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export class WebSearchClient {
  constructor({ apiKey = "", timeoutMs = 15_000, fetchImpl = globalThis.fetch } = {}) {
    this.apiKey = String(apiKey).trim();
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  health() {
    return {
      ready: Boolean(this.apiKey && this.fetchImpl),
      provider: "brave",
      reason: this.apiKey ? null : "BRAVE_SEARCH_API_KEY is required for web search",
    };
  }

  async search(queryValue, countValue = 5) {
    const query = String(queryValue ?? "").trim();
    const count = Number(countValue);
    if (!query || query.length > 500) throw inputError("Web search query must contain 1 to 500 characters");
    if (!Number.isSafeInteger(count) || count < 1 || count > 10) {
      throw inputError("Web search count must be an integer from 1 to 10");
    }
    if (!this.apiKey) throw new Error("Web search is not configured: BRAVE_SEARCH_API_KEY is required");
    const url = new URL(endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));
    url.searchParams.set("safesearch", "moderate");
    url.searchParams.set("text_decorations", "false");
    url.searchParams.set("spellcheck", "true");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": this.apiKey,
        },
        signal: controller.signal,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maximumResponseBytes) throw new Error("Web search response exceeded 2 MiB");
      let body;
      try { body = JSON.parse(bytes.toString("utf8")); }
      catch { throw new Error(`Web search returned malformed JSON (HTTP ${response.status})`); }
      if (!response.ok) {
        const detail = plainText(body?.message || body?.error?.message || body?.error || "provider request failed");
        throw new Error(`Web search failed with HTTP ${response.status}: ${detail}`);
      }
      const results = (body?.web?.results ?? []).flatMap((result) => {
        const urlValue = publicResultUrl(result?.url);
        if (!urlValue) return [];
        return [{
          title: plainText(result.title) || urlValue,
          url: urlValue,
          snippet: plainText(result.description) || null,
          published: plainText(result.age) || null,
          language: plainText(result.language) || null,
        }];
      }).slice(0, count);
      return {
        query,
        provider: "brave",
        count: results.length,
        moreResultsAvailable: Boolean(body?.query?.more_results_available),
        results,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Web search timed out");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
