import { Worker } from "node:worker_threads";
import { deserialize } from "node:v8";

const responseBytes = 64 * 1024 * 1024;

function restoredError(details) {
  const error = new Error(details?.message ?? "MariaDB operation failed");
  error.name = details?.name ?? "Error";
  if (details?.stack) error.stack = details.stack;
  if (details?.code) error.code = details.code;
  if (details?.mariaDbCode) error.mariaDbCode = details.mariaDbCode;
  if (details?.errno) error.errno = details.errno;
  if (details?.sqlState) error.sqlState = details.sqlState;
  return error;
}

class MariaDbStatementSync {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
  }

  all(...parameters) {
    return this.database.request({ type: "prepared", mode: "all", sql: this.sql, parameters });
  }

  get(...parameters) {
    return this.database.request({ type: "prepared", mode: "get", sql: this.sql, parameters });
  }

  run(...parameters) {
    return this.database.request({ type: "prepared", mode: "run", sql: this.sql, parameters });
  }
}

export class MariaDatabaseSync {
  constructor(configuration, { timeoutMs = 120_000 } = {}) {
    this.engine = "mariadb";
    this.configuration = { ...configuration };
    this.timeoutMs = timeoutMs;
    this.closed = false;
    this.controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    this.responseBuffer = new SharedArrayBuffer(responseBytes);
    this.worker = new Worker(new URL("./mariadb-sync-worker.mjs", import.meta.url), { type: "module" });
    this.server = this.request({ type: "init", configuration: this.configuration });
  }

  request(request) {
    if (this.closed) throw new Error("MariaDB connection is closed");
    const control = new Int32Array(this.controlBuffer);
    Atomics.store(control, 0, 0);
    Atomics.store(control, 1, 0);
    this.worker.postMessage({
      request,
      controlBuffer: this.controlBuffer,
      responseBuffer: this.responseBuffer,
    });
    const result = Atomics.wait(control, 0, 0, this.timeoutMs);
    if (result === "timed-out") throw new Error(`MariaDB operation exceeded ${this.timeoutMs}ms`);
    const length = Atomics.load(control, 1);
    const envelope = deserialize(Buffer.from(this.responseBuffer, 0, length));
    if (!envelope.ok) throw restoredError(envelope.error);
    return envelope.value;
  }

  prepare(sql) {
    return new MariaDbStatementSync(this, sql);
  }

  exec(sql) {
    this.request({ type: "exec", sql });
  }

  hybridSearch(options) {
    return this.request({ type: "hybridSearch", options });
  }

  close() {
    if (this.closed) return;
    try { this.request({ type: "close" }); } finally {
      this.closed = true;
      void this.worker.terminate();
    }
  }
}
