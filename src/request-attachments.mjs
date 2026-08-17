import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

const allowedExtensions = new Map([
  [".csv", new Set([
    "text/csv", "application/csv", "text/comma-separated-values",
    "application/vnd.ms-excel", "text/plain", "application/octet-stream",
  ])],
  [".txt", new Set(["text/plain", "text/csv", "application/octet-stream"])],
  [".vcf", new Set([
    "text/vcard", "text/x-vcard", "text/directory", "application/vcard",
    "application/x-vcard", "text/plain", "application/octet-stream",
  ])],
]);

const supportedAttachmentMessage = "Only text .csv, .txt, and .vcf attachments are supported";
const allowedTextControlBytes = new Set([0x09, 0x0a, 0x0c, 0x0d]);

function inputError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function normalizedFilename(value) {
  const filename = path.posix.basename(String(value ?? "").replaceAll("\\", "/")).trim();
  if (!filename || filename.length > 255 || /[\u0000-\u001f\u007f]/.test(filename)) {
    throw inputError("Attachment filename is invalid");
  }
  return filename;
}

function normalizedMimeType(value) {
  return String(value || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
}

function withoutByteOrderMark(text) {
  return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function decoded(bytes, encoding) {
  return withoutByteOrderMark(new TextDecoder(encoding, { fatal: true }).decode(bytes));
}

function utf16Encoding(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes.length < 8) return null;
  let evenNulls = 0;
  let oddNulls = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0) continue;
    if (index % 2 === 0) evenNulls += 1;
    else oddNulls += 1;
  }
  const pairs = Math.floor(bytes.length / 2);
  if (oddNulls / pairs > 0.3 && evenNulls / pairs < 0.05) return "utf-16le";
  if (evenNulls / pairs > 0.3 && oddNulls / pairs < 0.05) return "utf-16be";
  return null;
}

function looksBinary(bytes) {
  let suspiciousControls = 0;
  for (const byte of bytes) {
    if (byte === 0) return true;
    if ((byte < 0x20 && !allowedTextControlBytes.has(byte)) || byte === 0x7f) {
      suspiciousControls += 1;
    }
  }
  return suspiciousControls > Math.max(2, Math.floor(bytes.length * 0.01));
}

function decodedText(bytes) {
  const utf16 = utf16Encoding(bytes);
  if (utf16) {
    try {
      const text = decoded(bytes, utf16);
      if (text.includes("\u0000")) throw new Error("decoded null byte");
      return { text, encoding: utf16 };
    } catch {
      throw inputError("Attachment appears to contain binary data");
    }
  }
  try {
    const text = decoded(bytes, "utf-8");
    if (text.includes("\u0000")) throw inputError("Attachment appears to contain binary data");
    return { text, encoding: "utf-8" };
  } catch {
    if (looksBinary(bytes)) throw inputError("Attachment appears to contain binary data");
    return {
      text: withoutByteOrderMark(new TextDecoder("windows-1252").decode(bytes)),
      encoding: "windows-1252",
    };
  }
}

export function safeMediaPath(mediaRoot, storagePath) {
  const root = path.resolve(mediaRoot);
  const relative = String(storagePath ?? "").replace(/^media\//, "");
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(`${root}${path.sep}`)) {
    throw new Error("Stored media path escapes the media directory");
  }
  return filename;
}

export async function receiveTextAttachment(request, {
  filename: requestedFilename,
  mediaRoot,
  maximumBytes,
  ledger,
  now = new Date(),
  uuid = randomUUID,
} = {}) {
  const originalFilename = normalizedFilename(requestedFilename);
  const extension = path.extname(originalFilename).toLowerCase();
  const mimeType = normalizedMimeType(request.headers?.["content-type"]);
  const allowedMimeTypes = allowedExtensions.get(extension);
  if (!allowedMimeTypes || !allowedMimeTypes.has(mimeType)) {
    throw inputError(supportedAttachmentMessage, 415);
  }

  const chunks = [];
  let byteSize = 0;
  for await (const chunk of request) {
    byteSize += chunk.length;
    if (byteSize > maximumBytes) {
      throw inputError(`Attachment exceeds the ${maximumBytes}-byte limit`, 413);
    }
    chunks.push(chunk);
  }
  if (byteSize === 0) throw inputError("Attachment was empty");
  const bytes = Buffer.concat(chunks);
  const { encoding } = decodedText(bytes);

  const relativeDirectory = path.join(
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
  );
  const directory = path.join(mediaRoot, relativeDirectory);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const storedName = `${uuid()}${extension}`;
  const absoluteFilename = path.join(directory, storedName);
  await fsp.writeFile(absoluteFilename, bytes, { flag: "wx", mode: 0o600 });

  const storagePath = path.posix.join("media", ...relativeDirectory.split(path.sep), storedName);
  let file;
  try {
    file = ledger.registerFile({
      storagePath,
      originalFilename,
      mediaKind: "document",
      mimeType,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize,
    });
  } catch (error) {
    await fsp.unlink(absoluteFilename).catch(() => {});
    throw error;
  }
  if (file.duplicate && file.storagePath !== storagePath) {
    await fsp.unlink(absoluteFilename).catch(() => {});
  }
  return {
    ...file,
    originalFilename,
    mediaKind: "document",
    mimeType,
    byteSize,
    encoding,
  };
}

export async function readTextAttachment({ mediaRoot, file, maximumBytes }) {
  if (!file || file.media_kind !== "document") throw new Error("Request attachment is not a document");
  const originalFilename = normalizedFilename(file.original_filename);
  const extension = path.extname(originalFilename).toLowerCase();
  const mimeType = normalizedMimeType(file.mime_type);
  if (!allowedExtensions.get(extension)?.has(mimeType)) {
    throw new Error("Stored request attachment is not a supported CSV, text, or vCard file");
  }
  const bytes = await fsp.readFile(safeMediaPath(mediaRoot, file.storage_path));
  if (bytes.length > maximumBytes) throw new Error("Stored request attachment exceeds the configured limit");
  if (file.byte_size != null && Number(file.byte_size) !== bytes.length) {
    throw new Error("Stored request attachment size does not match its file record");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (file.sha256 && file.sha256 !== sha256) {
    throw new Error("Stored request attachment checksum does not match its file record");
  }
  const decodedAttachment = decodedText(bytes);
  return {
    fileId: Number(file.file_id),
    filename: originalFilename,
    mediaKind: file.media_kind,
    mimeType,
    byteSize: bytes.length,
    sha256,
    text: decodedAttachment.text,
    encoding: decodedAttachment.encoding,
  };
}
