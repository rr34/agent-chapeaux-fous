import fsp from "node:fs/promises";
import { inspectMp3 } from "./mp3-metadata.mjs";
import { safeMediaPath } from "./request-attachments.mjs";

export class MusicDurationResolver {
  constructor({ ledger, mediaRoot }) {
    this.ledger = ledger;
    this.mediaRoot = mediaRoot;
    this.cache = new Map();
  }

  async resolve(file) {
    if (Number.isSafeInteger(file?.durationMs) && file.durationMs > 0) return file.durationMs;
    const key = `${file?.fileId ?? "unknown"}:${file?.sha256 ?? "unknown"}`;
    if (this.cache.has(key)) return this.cache.get(key);
    let durationMs = null;
    try {
      const stored = this.ledger.file(file.fileId);
      if (stored?.storage_path && stored.media_kind === "audio" && stored.mime_type === "audio/mpeg") {
        const bytes = await fsp.readFile(safeMediaPath(this.mediaRoot, stored.storage_path));
        durationMs = inspectMp3(bytes).durationMs;
        if (durationMs && typeof this.ledger.cacheAudioDuration === "function") {
          this.ledger.cacheAudioDuration(Number(stored.file_id), stored.sha256, durationMs);
        }
      }
    } catch {
      // The library remains readable when one stored file cannot be inspected.
    }
    this.cache.set(key, durationMs);
    return durationMs;
  }

  async enrich(files) {
    const enriched = [];
    for (const file of files) {
      const durationMs = await this.resolve(file);
      enriched.push(durationMs == null ? file : { ...file, durationMs });
    }
    return enriched;
  }
}
