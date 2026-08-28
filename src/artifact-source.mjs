import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { safeMediaPath } from "./request-attachments.mjs";

const verificationBufferBytes = 1024 * 1024;

function inputError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

async function verifiedDigest(handle, byteSize) {
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(verificationBufferBytes, Math.max(1, byteSize)));
  let offset = 0;
  while (offset < byteSize) {
    const requested = Math.min(buffer.length, byteSize - offset);
    const { bytesRead } = await handle.read(buffer, 0, requested, offset);
    if (bytesRead === 0) throw new Error("Stored artifact ended before its recorded byte size");
    digest.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return digest.digest("hex");
}

function countJsonLine(value, recordCount) {
  const line = value.endsWith("\r") ? value.slice(0, -1) : value;
  if (!line.trim()) return recordCount;
  let parsed;
  try { parsed = JSON.parse(line); }
  catch { throw new Error(`JSON Lines artifact contains invalid JSON on nonblank line ${recordCount + 1}`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`JSON Lines artifact line ${recordCount + 1} is not one JSON object`);
  }
  return recordCount + 1;
}

async function verifiedJsonLines(handle, byteSize) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const buffer = Buffer.allocUnsafe(Math.min(verificationBufferBytes, Math.max(1, byteSize)));
  let pending = "";
  let offset = 0;
  let recordCount = 0;
  try {
    while (offset < byteSize) {
      const requested = Math.min(buffer.length, byteSize - offset);
      const { bytesRead } = await handle.read(buffer, 0, requested, offset);
      if (bytesRead === 0) throw new Error("JSON Lines artifact ended before its recorded byte size");
      pending += decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) recordCount = countJsonLine(line, recordCount);
      offset += bytesRead;
    }
    pending += decoder.decode();
  } catch (error) {
    if (error instanceof TypeError) throw new Error("JSON Lines artifact is not valid UTF-8");
    throw error;
  }
  recordCount = countJsonLine(pending, recordCount);
  if (recordCount === 0) throw new Error("JSON Lines artifact contains no records");
  return recordCount;
}

export function createFileArtifactSource({ ledger, mediaRoot }) {
  return {
    async open(fileId) {
      const stored = ledger.file(fileId);
      if (!stored) throw inputError(`File ${fileId} was not found`, 404);
      const filename = safeMediaPath(mediaRoot, stored.storage_path);
      const handle = await fsp.open(filename, "r");
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw new Error(`Stored artifact ${fileId} is not a regular file`);
        const byteSize = Number(stat.size);
        if (stored.byte_size != null && Number(stored.byte_size) !== byteSize) {
          throw new Error(`Stored artifact ${fileId} size does not match its file record`);
        }
        const sha256 = await verifiedDigest(handle, byteSize);
        if (stored.sha256 && String(stored.sha256).toLowerCase() !== sha256) {
          throw new Error(`Stored artifact ${fileId} checksum does not match its file record`);
        }
        const mimeType = String(stored.mime_type || "application/octet-stream").toLowerCase();
        const jsonLineRecordCount = mimeType === "application/x-ndjson"
          ? await verifiedJsonLines(handle, byteSize)
          : null;
        return {
          descriptor: {
            file: { file_id: Number(stored.file_id) },
            fileId: Number(stored.file_id),
            filename: path.basename(String(stored.original_filename || `file-${fileId}`)),
            mimeType,
            byteSize,
            sha256,
            jsonLineRecordCount,
          },
          async read(offset, maximumBytes) {
            if (!Number.isSafeInteger(offset) || offset < 0 || offset > byteSize) {
              throw inputError("Artifact read offset is invalid");
            }
            if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
              throw inputError("Artifact read size is invalid");
            }
            const length = Math.min(maximumBytes, byteSize - offset);
            if (length === 0) return Buffer.alloc(0);
            const buffer = Buffer.allocUnsafe(length);
            const { bytesRead } = await handle.read(buffer, 0, length, offset);
            if (bytesRead !== length) throw new Error(`Stored artifact ${fileId} changed during transfer`);
            return buffer;
          },
          async close() {
            await handle.close();
          },
        };
      } catch (error) {
        await handle.close().catch(() => {});
        throw error;
      }
    },
  };
}
