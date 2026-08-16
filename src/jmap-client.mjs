const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";
const SUBMISSION = "urn:ietf:params:jmap:submission";

function messageForProblem(status, body) {
  const detail = body?.detail || body?.description || body?.title;
  return `JMAP request failed with HTTP ${status}${detail ? `: ${detail}` : ""}`;
}

function methodError(method, error) {
  const detail = error?.description ? `: ${error.description}` : "";
  return new Error(`${method} failed (${error?.type || "unknown JMAP error"})${detail}`);
}

async function responseJson(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`JMAP returned a non-JSON response with HTTP ${response.status}`);
  }
  if (!response.ok) throw new Error(messageForProblem(response.status, body));
  return body;
}

function renderedTemplate(template, values) {
  return Object.entries(values).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, encodeURIComponent(value)),
    template,
  );
}

async function boundedBody(response, maximumBytes) {
  const statedSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(statedSize) && statedSize > maximumBytes) {
    throw new Error(`JMAP blob is ${statedSize} bytes; the tool limit is ${maximumBytes}`);
  }
  if (!response.body?.getReader) {
    const value = new Uint8Array(await response.arrayBuffer());
    if (value.byteLength > maximumBytes) throw new Error(`JMAP blob exceeds the ${maximumBytes}-byte tool limit`);
    return value;
  }
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) throw new Error(`JMAP blob exceeds the ${maximumBytes}-byte tool limit`);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export const JMAP_CAPABILITIES = { core: CORE, mail: MAIL, submission: SUBMISSION };

export class JmapClient {
  constructor({
    sessionUrl = "",
    accessToken = "",
    accountId = "",
    required = false,
    timeoutMs = 15_000,
    fetchFn = globalThis.fetch,
  } = {}) {
    this.sessionUrl = sessionUrl.trim();
    this.accessToken = accessToken.trim();
    this.preferredAccountId = accountId.trim();
    this.required = required;
    this.timeoutMs = timeoutMs;
    this.fetchFn = fetchFn;
    this.session = null;
    this.accountId = null;
    this.state = {
      ready: false,
      disabled: !this.sessionUrl && !this.accessToken,
      required,
      protocol: "jmap",
    };
  }

  configured() {
    return Boolean(this.sessionUrl && this.accessToken);
  }

  health() {
    return structuredClone(this.state);
  }

  requiredProblem() {
    if (!this.required || this.state.ready) return null;
    return `email JMAP integration is unavailable${this.state.error ? `: ${this.state.error}` : ""}`;
  }

  async initialize() {
    if (!this.sessionUrl && !this.accessToken) return this.health();
    if (!this.configured()) {
      this.state = {
        ready: false, disabled: false, required: this.required, protocol: "jmap",
        error: "SLAYER_JMAP_SESSION_URL and SLAYER_JMAP_ACCESS_TOKEN must be configured together",
      };
      return this.health();
    }
    try {
      const url = new URL(this.sessionUrl);
      if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error("JMAP session URL must use HTTPS except on loopback");
      }
      const response = await this.fetchFn(url, {
        headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const session = await responseJson(response);
      if (!session.capabilities?.[CORE]) throw new Error("JMAP session does not advertise the core capability");
      if (!session.capabilities?.[MAIL]) throw new Error("JMAP session does not advertise the mail capability");
      if (!session.apiUrl || !session.downloadUrl) throw new Error("JMAP session is missing apiUrl or downloadUrl");
      const accountId = this.preferredAccountId
        || session.primaryAccounts?.[MAIL]
        || Object.keys(session.accounts ?? {}).find((id) => session.accounts[id].accountCapabilities?.[MAIL]);
      if (!accountId || !session.accounts?.[accountId]?.accountCapabilities?.[MAIL]) {
        throw new Error("JMAP session has no mail-capable account");
      }
      this.session = {
        ...session,
        apiUrl: new URL(session.apiUrl, url).toString(),
        downloadUrl: new URL(session.downloadUrl, url).toString(),
        ...(session.uploadUrl ? { uploadUrl: new URL(session.uploadUrl, url).toString() } : {}),
        ...(session.eventSourceUrl ? { eventSourceUrl: new URL(session.eventSourceUrl, url).toString() } : {}),
      };
      this.accountId = accountId;
      this.state = {
        ready: true,
        disabled: false,
        required: this.required,
        protocol: "jmap",
        accountId,
        username: session.username ?? null,
        accountName: session.accounts[accountId].name ?? null,
        accountCount: Object.keys(session.accounts).length,
        submission: Boolean(session.capabilities[SUBMISSION]
          && session.accounts[accountId].accountCapabilities?.[SUBMISSION]),
      };
    } catch (error) {
      this.session = null;
      this.accountId = null;
      this.state = {
        ready: false, disabled: false, required: this.required, protocol: "jmap",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return this.health();
  }

  requireReady() {
    if (!this.session || !this.accountId) throw new Error(this.state.error || "JMAP is not connected");
    return this.session;
  }

  resolveAccountId(accountId = null, capability = MAIL) {
    const session = this.requireReady();
    const selected = accountId || this.accountId;
    if (!session.accounts?.[selected]) throw new Error(`Unknown JMAP account: ${selected}`);
    if (capability && !session.accounts[selected].accountCapabilities?.[capability]) {
      throw new Error(`JMAP account ${selected} does not support ${capability}`);
    }
    return selected;
  }

  publicSession() {
    const session = this.requireReady();
    return {
      username: session.username ?? null,
      capabilities: session.capabilities,
      accounts: session.accounts,
      primaryAccounts: session.primaryAccounts ?? {},
      selectedAccountId: this.accountId,
    };
  }

  async request(methodCalls, using = [CORE, MAIL]) {
    const session = this.requireReady();
    const response = await this.fetchFn(session.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ using: [...new Set(using)], methodCalls }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const result = await responseJson(response);
    if (!Array.isArray(result.methodResponses)) throw new Error("JMAP response is missing methodResponses");
    return result.methodResponses;
  }

  async call(method, argumentsObject, { using = [CORE, MAIL], callId = "0" } = {}) {
    const responses = await this.request([[method, argumentsObject, callId]], using);
    const matching = responses.find((entry) => entry[2] === callId);
    if (!matching) throw new Error(`${method} returned no matching JMAP method response`);
    if (matching[0] === "error") throw methodError(method, matching[1]);
    if (matching[0] !== method) throw new Error(`${method} returned unexpected response ${matching[0]}`);
    return matching[1];
  }

  async downloadBlob({ accountId = null, blobId, name = "attachment", type = "application/octet-stream", maximumBytes }) {
    const session = this.requireReady();
    const selected = this.resolveAccountId(accountId);
    const url = renderedTemplate(session.downloadUrl, {
      accountId: selected, blobId, name, type,
    });
    const response = await this.fetchFn(url, {
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: type },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      let body = null;
      try { body = await response.json(); } catch {}
      throw new Error(messageForProblem(response.status, body));
    }
    const bytes = await boundedBody(response, maximumBytes);
    return {
      bytes,
      type: response.headers.get("content-type")?.split(";", 1)[0] || type,
    };
  }
}
