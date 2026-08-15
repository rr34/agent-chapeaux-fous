import fs from "node:fs/promises";
import { CodexAppServerClient } from "./codex-app-server-client.mjs";

const requiredMethods = ["start", "close", "health", "describeRequest", "runTurn"];

export function assertModelTransport(transport) {
  if (!transport?.id || !transport?.displayName) {
    throw new Error("A model transport needs id and displayName properties");
  }
  for (const method of requiredMethods) {
    if (typeof transport[method] !== "function") {
      throw new Error(`Model transport ${transport.id} does not implement ${method}()`);
    }
  }
  return transport;
}

export async function createModelTransport(config) {
  if (config.modelTransport !== "codex-app-server") {
    throw new Error(
      `Unsupported SLAYER_MODEL_TRANSPORT: ${config.modelTransport}. `
      + "Install an adapter and register it in src/model-transport.mjs.",
    );
  }

  await Promise.all([
    fs.mkdir(config.codexHome, { recursive: true, mode: 0o700 }),
    fs.mkdir(config.codexWorkDirectory, { recursive: true, mode: 0o700 }),
  ]);
  return assertModelTransport(new CodexAppServerClient({
    command: config.codexCommand,
    requiredVersion: config.codexRequiredVersion,
    codexHome: config.codexHome,
    cwd: config.codexWorkDirectory,
    requestTimeoutMs: config.codexRequestTimeoutMs,
  }));
}
