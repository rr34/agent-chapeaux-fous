import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import readline from "node:readline";

export class WhisperTranscriber {
  constructor({ pythonExecutable, workerPath, timeoutMs }) {
    this.pythonExecutable = pythonExecutable;
    this.workerPath = workerPath;
    this.timeoutMs = timeoutMs;
    this.process = null;
    this.pending = new Map();
  }

  ensureProcess() {
    if (this.process && !this.process.killed) return;
    const child = spawn(this.pythonExecutable, ["-u", this.workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.process = child;
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message);
      else pending.reject(new Error(message.error || "Whisper transcription failed"));
    });
    child.stderr.on("data", (chunk) => process.stderr.write(`[whisper] ${chunk}`));
    child.on("error", (error) => this.rejectAll(error));
    child.on("exit", (code, signal) => {
      this.process = null;
      this.rejectAll(new Error(`Whisper worker exited (${signal || code})`));
    });
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  transcribe(inputPath) {
    this.ensureProcess();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Whisper transcription exceeded ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.process.stdin.write(`${JSON.stringify({ id, inputPath })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  close() {
    this.process?.kill("SIGTERM");
    this.process = null;
  }
}
