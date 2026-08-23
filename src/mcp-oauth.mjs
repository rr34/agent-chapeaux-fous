import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function randomState() {
  return randomBytes(32).toString("base64url");
}

function sameSecret(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function cleanServerName(value) {
  const name = String(value);
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error("OAuth server names may contain only letters, numbers, underscores, and hyphens");
  return name;
}

export class FileOAuthClientProvider {
  constructor({ serverName, storageRoot, redirectUrl, scopes = [] }) {
    this.serverName = cleanServerName(serverName);
    this.storageRoot = storageRoot;
    this.redirectUrl = new URL(redirectUrl);
    this.scopes = [...new Set(scopes.map((scope) => String(scope).trim()).filter(Boolean))];
    this.filename = path.join(storageRoot, `${this.serverName}.json`);
    this.record = {};
    this.loaded = false;
    this.writeQueue = Promise.resolve();
  }

  get clientMetadata() {
    return {
      redirect_uris: [this.redirectUrl.toString()],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "Chapeaux Fous",
      software_id: "agent-slayer",
      software_version: "0.2.0",
      ...(this.scopes.length ? { scope: this.scopes.join(" ") } : {}),
    };
  }

  async load() {
    if (this.loaded) return;
    await fs.mkdir(this.storageRoot, { recursive: true, mode: 0o700 });
    await fs.chmod(this.storageRoot, 0o700);
    try {
      const content = await fs.readFile(this.filename, "utf8");
      this.record = JSON.parse(content);
    } catch (error) {
      if (error?.code !== "ENOENT") throw new Error(`Could not load ${this.serverName} OAuth credentials: ${error.message}`);
      this.record = {};
    }
    this.loaded = true;

    const registeredRedirects = this.record.clientInformation?.redirect_uris;
    if (Array.isArray(registeredRedirects) && !registeredRedirects.includes(this.redirectUrl.toString())) {
      this.record = {};
      await this.persist();
    }
  }

  async persist() {
    const snapshot = `${JSON.stringify(this.record, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(this.storageRoot, { recursive: true, mode: 0o700 });
      const temporary = `${this.filename}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
      await fs.writeFile(temporary, snapshot, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await fs.rename(temporary, this.filename);
      await fs.chmod(this.filename, 0o600);
    });
    return this.writeQueue;
  }

  async clientInformation() {
    await this.load();
    return this.record.clientInformation;
  }

  async saveClientInformation(clientInformation) {
    await this.load();
    this.record.clientInformation = clientInformation;
    await this.persist();
  }

  async tokens() {
    await this.load();
    return this.record.tokens;
  }

  async saveTokens(tokens) {
    await this.load();
    this.record.tokens = {
      ...tokens,
      ...(tokens.refresh_token ? {} : { refresh_token: this.record.tokens?.refresh_token }),
    };
    if (!this.record.tokens.refresh_token) delete this.record.tokens.refresh_token;
    await this.persist();
  }

  async state() {
    await this.load();
    if (!this.record.pendingState) {
      this.record.pendingState = randomState();
      await this.persist();
    }
    return this.record.pendingState;
  }

  async saveCodeVerifier(codeVerifier) {
    await this.load();
    this.record.codeVerifier = codeVerifier;
    await this.persist();
  }

  async codeVerifier() {
    await this.load();
    if (!this.record.codeVerifier) throw new Error(`No pending ${this.serverName} OAuth authorization`);
    return this.record.codeVerifier;
  }

  async redirectToAuthorization(authorizationUrl) {
    await this.load();
    this.record.authorizationUrl = authorizationUrl.toString();
    await this.persist();
  }

  async saveDiscoveryState(discoveryState) {
    await this.load();
    this.record.discoveryState = discoveryState;
    await this.persist();
  }

  async discoveryState() {
    await this.load();
    return this.record.discoveryState;
  }

  async invalidateCredentials(scope) {
    await this.load();
    if (scope === "all") this.record = {};
    if (scope === "client") delete this.record.clientInformation;
    if (scope === "tokens") delete this.record.tokens;
    if (scope === "verifier") delete this.record.codeVerifier;
    if (scope === "discovery") delete this.record.discoveryState;
    await this.persist();
  }

  async beginAuthorization() {
    await this.load();
    this.record.pendingState = randomState();
    delete this.record.tokens;
    delete this.record.codeVerifier;
    delete this.record.authorizationUrl;
    await this.persist();
  }

  async authorizationUrl() {
    await this.load();
    return this.record.authorizationUrl;
  }

  async assertState(state) {
    await this.load();
    if (!sameSecret(this.record.pendingState, state)) throw new Error("OAuth state did not match the pending authorization");
  }

  async completeAuthorization() {
    await this.load();
    delete this.record.pendingState;
    delete this.record.codeVerifier;
    delete this.record.authorizationUrl;
    await this.persist();
  }
}
