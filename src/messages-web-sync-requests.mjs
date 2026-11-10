import { randomUUID } from "node:crypto";
import { currentPersonId } from "./person-context.mjs";

const accountPattern = /^[A-Za-z0-9._-]+$/u;
const terminalStatuses = new Set(["complete", "error", "cancelled"]);
const allowedStatuses = new Set(["pending", "running", ...terminalStatuses]);
const historyModes = new Set(["incremental", "days_30", "days_90", "days_365", "all"]);
const countFields = [
  "conversationIndex", "conversationCount", "messagesRead", "messagesAccepted",
  "messagesCreated", "messagesUpdated", "messagesDeduplicated", "messagesAmbiguous",
  "unresolvedParticipants", "undatedSkipped",
];

function accountKey(value) {
  const result = String(value || "default").trim();
  if (!result || result.length > 96 || !accountPattern.test(result)) {
    throw Object.assign(new Error("accountKey is invalid"), { statusCode: 400 });
  }
  return result;
}

function requestId(value) {
  const result = String(value || "");
  if (!/^[0-9a-f-]{36}$/u.test(result)) throw Object.assign(new Error("Synchronization request not found"), { statusCode: 404 });
  return result;
}

function publicRequest(request) {
  const { personId: _personId, ...visible } = request;
  return structuredClone(visible);
}

function historyMode(input) {
  const value = input.fullHistory === true ? "all" : String(input.historyMode || "incremental");
  if (!historyModes.has(value)) throw Object.assign(new Error("historyMode is invalid"), { statusCode: 400 });
  return value;
}

export class MessagesWebSyncRequests {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.requests = new Map();
  }

  expireStale() {
    const cutoff = this.now() - 6 * 60 * 60 * 1000;
    for (const request of this.requests.values()) {
      if (!terminalStatuses.has(request.status) && request.updatedAtMs < cutoff) {
        request.status = "error";
        request.phase = "Timed out waiting for the browser extension";
        request.error = "The Google Messages synchronization did not report progress for six hours.";
        request.updatedAtMs = this.now();
        request.completedAtMs = request.updatedAtMs;
      }
    }
  }

  create(input = {}) {
    this.expireStale();
    const key = accountKey(input.accountKey);
    const existing = [...this.requests.values()].find((request) => (
      request.personId === currentPersonId()
      && request.accountKey === key && !terminalStatuses.has(request.status)
    ));
    if (existing) return { ...publicRequest(existing), reused: true };
    const timestamp = this.now();
    const request = {
      requestId: randomUUID(),
      personId: currentPersonId(),
      accountKey: key,
      historyMode: historyMode(input),
      status: "pending",
      phase: "Waiting for the Brave extension",
      error: null,
      createdAtMs: timestamp,
      updatedAtMs: timestamp,
      completedAtMs: null,
      conversationIndex: 0,
      conversationCount: 0,
      messagesRead: 0,
      messagesAccepted: 0,
      messagesCreated: 0,
      messagesUpdated: 0,
      messagesDeduplicated: 0,
      messagesAmbiguous: 0,
      unresolvedParticipants: 0,
      undatedSkipped: 0,
    };
    this.requests.set(request.requestId, request);
    return publicRequest(request);
  }

  get(id) {
    this.expireStale();
    const request = this.requests.get(requestId(id));
    if (!request || request.personId !== currentPersonId()) throw Object.assign(new Error("Synchronization request not found"), { statusCode: 404 });
    return publicRequest(request);
  }

  next(accountKeyValue) {
    this.expireStale();
    const key = accountKey(accountKeyValue);
    const request = [...this.requests.values()]
      .filter((candidate) => candidate.personId === currentPersonId()
        && candidate.accountKey === key && candidate.status === "pending")
      .toSorted((left, right) => left.createdAtMs - right.createdAtMs)[0];
    return request ? {
      requestId: request.requestId,
      accountKey: request.accountKey,
      historyMode: request.historyMode,
      fullHistory: request.historyMode === "all",
    } : null;
  }

  update(id, input = {}) {
    const request = this.requests.get(requestId(id));
    if (!request || request.personId !== currentPersonId()) throw Object.assign(new Error("Synchronization request not found"), { statusCode: 404 });
    const status = String(input.status || request.status);
    if (!allowedStatuses.has(status)) throw Object.assign(new Error("Synchronization status is invalid"), { statusCode: 400 });
    request.status = status;
    request.phase = String(input.phase || request.phase).slice(0, 1000);
    request.error = input.error == null ? null : String(input.error).slice(0, 4000);
    for (const field of countFields) {
      if (input[field] == null) continue;
      const count = Number(input[field]);
      if (!Number.isSafeInteger(count) || count < 0) {
        throw Object.assign(new Error(`${field} must be a nonnegative integer`), { statusCode: 400 });
      }
      request[field] = count;
    }
    request.updatedAtMs = this.now();
    if (terminalStatuses.has(status)) request.completedAtMs = request.updatedAtMs;
    return publicRequest(request);
  }
}
