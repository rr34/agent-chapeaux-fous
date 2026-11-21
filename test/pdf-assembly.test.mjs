import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { imagesToPdfBytes, mergePdfBytes, orderPdfSources } from "../src/pdf-assembly.mjs";
import { registerFileTools } from "../src/tools/file-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const redPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zf1sAAAAASUVORK5CYII=",
  "base64",
);

async function pdfWithPages(count) {
  const document = await PDFDocument.create();
  for (let index = 0; index < count; index += 1) document.addPage();
  return Buffer.from(await document.save());
}

test("PDF assembly preserves supplied pages and naturally orders numbered filenames", async () => {
  const ordered = orderPdfSources([
    { fileId: 10, filename: "invoice-10.pdf" },
    { fileId: 2, filename: "invoice-2.pdf" },
  ], "filename");
  assert.deepEqual(ordered.map(({ fileId }) => fileId), [2, 10]);

  const merged = await mergePdfBytes([
    { fileId: 2, filename: "first.pdf", bytes: await pdfWithPages(1) },
    { fileId: 10, filename: "second.pdf", bytes: await pdfWithPages(2) },
  ], { title: "Combined invoices" });
  assert.equal(merged.pageCount, 3);
  assert.equal((await PDFDocument.load(merged.bytes)).getPageCount(), 3);
});

test("image assembly creates one page per image plus an internal source appendix", async () => {
  const assembled = await imagesToPdfBytes([
    { fileId: 1, filename: "scan-1.png", mimeType: "image/png", sha256: "a".repeat(64), bytes: transparentPng },
    { fileId: 2, filename: "scan-2.png", mimeType: "image/png", sha256: "b".repeat(64), bytes: redPng },
  ], { title: "Scanned statement" });
  assert.equal(assembled.imagePageCount, 2);
  assert.equal(assembled.pageCount, 3);
  assert.equal((await PDFDocument.load(assembled.bytes)).getPageCount(), 3);
});

test("file PDF tools verify durable sources and return one generated file", async (context) => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-slayer-pdf-assembly-"));
  context.after(() => fs.rmSync(mediaRoot, { recursive: true, force: true }));
  const records = new Map();
  const events = [];
  let nextFileId = 1;
  const details = (row) => ({
    fileId: row.file_id,
    title: row.title,
    description: row.description,
    titleSource: "original_filename",
    originalFilename: row.original_filename,
    mediaKind: row.media_kind,
    mimeType: row.mime_type,
    sha256: row.sha256,
    byteSize: row.byte_size,
    createdAtUtc: row.created_at_utc,
  });
  const ledger = {
    file: (fileId) => records.get(fileId) ?? null,
    fileDetails: (fileId) => records.has(fileId) ? details(records.get(fileId)) : null,
    registerFile(input) {
      const fileId = nextFileId++;
      const row = {
        file_id: fileId,
        storage_path: input.storagePath,
        original_filename: input.originalFilename,
        title: input.title,
        description: input.description ?? null,
        media_kind: input.mediaKind,
        mime_type: input.mimeType,
        sha256: input.sha256,
        byte_size: input.byteSize,
        created_at_utc: `2026-11-21T00:00:0${fileId}.000Z`,
      };
      records.set(fileId, row);
      return { ...details(row), duplicate: false, storagePath: input.storagePath };
    },
    append(event) { events.push(event); return `event-${events.length}`; },
  };

  const register = (filename, bytes, mimeType, mediaKind) => {
    fs.writeFileSync(path.join(mediaRoot, filename), bytes);
    return ledger.registerFile({
      storagePath: `media/${filename}`,
      originalFilename: filename,
      title: filename,
      mediaKind,
      mimeType,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.length,
    });
  };
  const firstPdf = register("invoice-2.pdf", await pdfWithPages(1), "application/pdf", "document");
  const secondPdf = register("invoice-10.pdf", await pdfWithPages(2), "application/pdf", "document");
  const firstImage = register("scan-2.png", transparentPng, "image/png", "image");
  const secondImage = register("scan-10.png", redPng, "image/png", "image");

  const registry = new ToolRegistry();
  registerFileTools(registry, {
    ledger,
    searchCoordinator: { searchScope: () => ({ hits: [] }) },
    mediaRoot,
    maximumTextBytes: 4096,
    maximumGeneratedBytes: 10 * 1024 * 1024,
  });

  const merged = await registry.execute("file_pdf_merge", {
    file_ids: [secondPdf.fileId, firstPdf.fileId],
    order: "filename",
    filename: "combined-invoices.pdf",
    title: "Combined invoices",
  }, { requestId: "merge-request", callId: "merge-call" });
  assert.deepEqual(Object.keys(merged), ["file"]);
  assert.equal(merged.file.mimeType, "application/pdf");
  const mergedBytes = fs.readFileSync(path.join(mediaRoot, merged.file.storagePath.replace(/^media\//u, "")));
  assert.equal((await PDFDocument.load(mergedBytes)).getPageCount(), 3);

  const converted = await registry.execute("file_images_to_pdf", {
    file_ids: [secondImage.fileId, firstImage.fileId],
    order: "filename",
    filename: "statement-scans.pdf",
    title: "Statement scans",
  }, { requestId: "images-request", callId: "images-call" });
  assert.deepEqual(Object.keys(converted), ["file"]);
  const convertedBytes = fs.readFileSync(path.join(mediaRoot, converted.file.storagePath.replace(/^media\//u, "")));
  assert.equal((await PDFDocument.load(convertedBytes)).getPageCount(), 3);

  assert.deepEqual(events.find(({ type }) => type === "file.pdf.merged").payload.sourceFileIds, [firstPdf.fileId, secondPdf.fileId]);
});
