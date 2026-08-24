import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { parseCsvRows } from "./contact-file-import.mjs";

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

const allowedImageExtensions = new Map([
  [".jpg", new Set(["image/jpeg", "application/octet-stream"])],
  [".jpeg", new Set(["image/jpeg", "application/octet-stream"])],
  [".png", new Set(["image/png", "application/octet-stream"])],
  [".webp", new Set(["image/webp", "application/octet-stream"])],
  [".gif", new Set(["image/gif", "application/octet-stream"])],
]);

const supportedAttachmentMessage = "Only text .csv, .txt, and .vcf attachments are supported";
const supportedRequestAttachmentMessage = "Only JPEG, PNG, WebP, GIF, CSV, TXT, and vCard attachments are supported";
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

function imageSignatureMatches(bytes, mimeType) {
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/gif") {
    const signature = bytes.subarray(0, 6).toString("ascii");
    return signature === "GIF87a" || signature === "GIF89a";
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12
      && bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function canonicalImageMimeType(extension) {
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  return `image/${extension.slice(1)}`;
}

async function requestBytes(request, maximumBytes) {
  const chunks = [];
  let byteSize = 0;
  for await (const chunk of request) {
    byteSize += chunk.length;
    if (byteSize > maximumBytes) {
      throw inputError(`Attachment exceeds the ${maximumBytes}-byte operational safety ceiling`, 413);
    }
    chunks.push(chunk);
  }
  if (byteSize === 0) throw inputError("Attachment was empty");
  return Buffer.concat(chunks);
}

async function storeAttachment(bytes, {
  extension, originalFilename, mediaKind, mimeType, encoding = null,
  title = originalFilename, description = null, mediaRoot, ledger, now, uuid,
}) {
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
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  try {
    file = ledger.registerFile({
      storagePath,
      originalFilename,
      title,
      description,
      mediaKind,
      mimeType,
      sha256,
      byteSize: bytes.length,
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
    mediaKind,
    mimeType,
    byteSize: bytes.length,
    sha256,
    ...(encoding ? { encoding } : {}),
  };
}

function documentDescription(extension, text) {
  if (extension === ".csv") {
    try {
      const rows = parseCsvRows(text);
      const headers = (rows[0] ?? []).map((value) => String(value).trim()).filter(Boolean);
      const dataRows = rows.slice(1).filter((row) => row.some((value) => String(value).trim())).length;
      const columns = headers.slice(0, 12).join(", ");
      const omitted = Math.max(0, headers.length - 12);
      return `CSV with ${dataRows} data ${dataRows === 1 ? "row" : "rows"}${columns ? `. Columns: ${columns}${omitted ? `, and ${omitted} more` : ""}.` : "."}`;
    } catch {
      return "CSV document.";
    }
  }
  if ([".vcf", ".vcard"].includes(extension)) {
    const cards = (text.match(/^BEGIN:VCARD\s*$/gimu) ?? []).length;
    return cards ? `vCard document with ${cards} ${cards === 1 ? "contact" : "contacts"}.` : "vCard document.";
  }
  const lines = text ? text.split(/\r\n|\n|\r/u).length : 0;
  return lines ? `Text document with ${lines} ${lines === 1 ? "line" : "lines"}.` : "Text document.";
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

  const bytes = await requestBytes(request, maximumBytes);
  const { text, encoding } = decodedText(bytes);
  return storeAttachment(bytes, {
    extension, originalFilename, mediaKind: "document", mimeType, encoding,
    title: originalFilename,
    description: documentDescription(extension, text),
    mediaRoot, ledger, now, uuid,
  });
}

export async function receiveRequestAttachment(request, options = {}) {
  const originalFilename = normalizedFilename(options.filename);
  const extension = path.extname(originalFilename).toLowerCase();
  if (allowedExtensions.has(extension)) {
    return receiveTextAttachment(request, {
      filename: originalFilename,
      mediaRoot: options.mediaRoot,
      maximumBytes: options.maximumBytes,
      ledger: options.ledger,
      now: options.now,
      uuid: options.uuid,
    });
  }
  const suppliedMimeType = normalizedMimeType(request.headers?.["content-type"]);
  const allowedMimeTypes = allowedImageExtensions.get(extension);
  if (!allowedMimeTypes || !allowedMimeTypes.has(suppliedMimeType)) {
    throw inputError(supportedRequestAttachmentMessage, 415);
  }
  const mimeType = canonicalImageMimeType(extension);
  const bytes = await requestBytes(request, options.maximumBytes);
  if (!imageSignatureMatches(bytes, mimeType)) {
    throw inputError(`Attachment bytes do not match ${mimeType}`, 415);
  }
  return storeAttachment(bytes, {
    extension,
    originalFilename,
    title: originalFilename,
    description: "Image file.",
    mediaKind: "image",
    mimeType,
    mediaRoot: options.mediaRoot,
    ledger: options.ledger,
    now: options.now ?? new Date(),
    uuid: options.uuid ?? randomUUID,
  });
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

export async function readRequestAttachment({ mediaRoot, file, maximumBytes, maximumTextBytes = maximumBytes }) {
  if (file?.media_kind === "document") {
    return readTextAttachment({ mediaRoot, file, maximumBytes: maximumTextBytes });
  }
  if (!file || file.media_kind !== "image") throw new Error("Request attachment is not a supported document or image");
  const originalFilename = normalizedFilename(file.original_filename);
  const extension = path.extname(originalFilename).toLowerCase();
  const mimeType = normalizedMimeType(file.mime_type);
  if (!allowedImageExtensions.get(extension)?.has(mimeType)) {
    throw new Error("Stored request image is not a supported JPEG, PNG, WebP, or GIF file");
  }
  const bytes = await fsp.readFile(safeMediaPath(mediaRoot, file.storage_path));
  if (bytes.length > maximumBytes) throw new Error("Stored request image exceeds the configured operational safety ceiling");
  if (file.byte_size != null && Number(file.byte_size) !== bytes.length) {
    throw new Error("Stored request image size does not match its file record");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (file.sha256 && file.sha256 !== sha256) {
    throw new Error("Stored request image checksum does not match its file record");
  }
  if (!imageSignatureMatches(bytes, mimeType)) {
    throw new Error(`Stored request image bytes do not match ${mimeType}`);
  }
  return {
    fileId: Number(file.file_id),
    filename: originalFilename,
    mediaKind: "image",
    mimeType,
    byteSize: bytes.length,
    sha256,
    dataBase64: bytes.toString("base64"),
  };
}
