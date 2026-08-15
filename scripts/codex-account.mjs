#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environmentFilename = path.join(repositoryRoot, ".env");
if (fs.existsSync(environmentFilename)) process.loadEnvFile(environmentFilename);

const action = process.argv[2];
if (!["login", "status"].includes(action)) {
  console.error("Usage: node scripts/codex-account.mjs <login|status>");
  process.exit(2);
}

const command = process.env.SLAYER_CODEX_COMMAND?.trim() || "codex";
const codexHome = path.resolve(repositoryRoot, process.env.SLAYER_CODEX_HOME?.trim() || "data/codex-home");
fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });

console.log(`Using Agent Slayer Codex home: ${codexHome}`);
const args = action === "login" ? ["login", "--device-auth"] : ["login", "status"];
const child = spawn(command, args, {
  cwd: repositoryRoot,
  env: { ...process.env, CODEX_HOME: codexHome },
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(`Unable to start Codex at ${command}: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) console.error(`Codex exited from signal ${signal}`);
  process.exitCode = code ?? 1;
});
