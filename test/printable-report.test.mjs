import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  normalizePrintableReportInput,
  PrintableReportService,
  renderPrintableReportHtml,
} from "../src/printable-report.mjs";

const verifiedObjectReferences = [{
  mention: "unfinished Watch Jobs",
  role: "subject",
  type: "todos.personal_task",
  source: "native:todos",
  objects: [{
    id: 41,
    ref: "agent-slayer://todos/41",
    display: "Replace battery in blue watch",
  }],
  sourceEventSeqs: [42691],
}, {
  mention: "connected contacts",
  role: "related_contact",
  type: "contacts.contact",
  source: "native:contacts",
  objects: [{
    id: 662,
    ref: "agent-slayer://contacts/662",
    display: "Alice Watch Owner",
  }],
  sourceEventSeqs: [42745],
}];

function reportInput(overrides = {}) {
  return {
    title: "Unfinished Watch Jobs",
    subtitle: "Jobs alongside their connected contacts",
    description: "Current unfinished work. <script>alert('not HTML')</script>",
    paper_size: "letter",
    orientation: "landscape",
    show_source_appendix: true,
    sections: [{
      heading: "Watch Jobs",
      description: null,
      presentation: "table",
      columns: [
        { label: "Job", align: "left" },
        { label: "Contact", align: "left" },
      ],
      rows: [{
        cells: ["Replace battery in blue watch", "Alice Watch Owner"],
        note: "Waiting for a 371 cell.",
        source_refs: ["agent-slayer://todos/41", "agent-slayer://contacts/662"],
      }, {
        cells: ["Unassigned bench cleanup", ""],
        note: null,
        source_refs: [],
      }],
    }],
    ...overrides,
  };
}

test("printable report normalizes a general sourced table and renders only safe structured text", () => {
  const generatedAt = new Date("2026-10-19T18:30:00.000Z");
  const model = normalizePrintableReportInput(reportInput(), {
    verifiedObjectReferences,
    generatedAt,
  });
  assert.equal(model.protocol, "agent-slayer.printable-report");
  assert.equal(model.sectionCount, 1);
  assert.equal(model.rowCount, 2);
  assert.equal(model.sourcedRowCount, 1);
  assert.equal(model.unsourcedRowCount, 1);
  assert.equal(model.sourceObjectCount, 2);
  assert.deepEqual(model.sourceEventSeqs, [42691, 42745]);
  assert.ok(model.contentCharacters > 0);
  assert.deepEqual(model.sections[0].rows[0].sources.map(({ display }) => display), [
    "Replace battery in blue watch", "Alice Watch Owner",
  ]);

  const html = renderPrintableReportHtml(model);
  assert.match(html, /Unfinished Watch Jobs/);
  assert.match(html, /Alice Watch Owner/);
  assert.match(html, /Source objects/);
  assert.match(html, /agent-slayer:\/\/todos\/41/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
});

test("printable report rejects mismatched rows, excessive totals, and unverified source references", () => {
  assert.throws(
    () => normalizePrintableReportInput(reportInput({
      sections: [{
        heading: null, description: null, presentation: "table",
        columns: [{ label: "Job", align: "left" }, { label: "Contact", align: "left" }],
        rows: [{ cells: ["Only one cell"], note: null, source_refs: [] }],
      }],
    })),
    /exactly 2 values/,
  );
  assert.throws(
    () => normalizePrintableReportInput(reportInput(), { verifiedObjectReferences: [] }),
    /unverified object reference/,
  );
  const rows = Array.from({ length: 501 }, (_, index) => ({
    cells: [`Row ${index}`], note: null, source_refs: [],
  }));
  assert.throws(
    () => normalizePrintableReportInput(reportInput({
      sections: [{
        heading: null, description: null, presentation: "list",
        columns: [{ label: "Item", align: "left" }], rows,
      }],
    })),
    /at most 500 rows/,
  );
  const oversizedSections = ["First", "Second"].map((heading) => ({
    heading, description: null, presentation: "list",
    columns: [{ label: "Item", align: "left" }],
    rows: Array.from({ length: 500 }, () => ({
      cells: ["x".repeat(600)], note: null, source_refs: [],
    })),
  }));
  assert.throws(
    () => normalizePrintableReportInput(reportInput({ sections: oversizedSections })),
    /at most 500000 total characters/,
  );
});

test("printable report generation verifies, registers, and receipts the durable PDF", async (context) => {
  const mediaRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-slayer-printable-report-"));
  context.after(() => fsp.rm(mediaRoot, { recursive: true, force: true }));
  const registrations = [];
  const activity = [];
  const ledger = {
    registerFile(input) {
      registrations.push(input);
      return {
        fileId: 91,
        title: input.title,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        storagePath: input.storagePath,
        duplicate: false,
      };
    },
    append(input) { activity.push(input); return "printable-report-event"; },
    eventSequence(eventId) {
      assert.equal(eventId, "printable-report-event");
      return 42820;
    },
  };
  let renderInput;
  const service = new PrintableReportService({
    ledger,
    mediaRoot,
    maximumBytes: 1024 * 1024,
    renderPdf: async (input) => {
      renderInput = input;
      const document = await PDFDocument.create();
      document.addPage([612, 792]);
      await fsp.writeFile(input.filename, await document.save());
    },
  });

  const result = await service.generate(reportInput(), {
    requestId: "request-1",
    callId: "call-1",
    verifiedObjectReferences,
  });
  assert.equal(renderInput.paperSize, "letter");
  assert.equal(renderInput.orientation, "landscape");
  assert.match(renderInput.html, /Jobs alongside their connected contacts/);
  assert.equal(result.pageCount, 1);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].mimeType, "application/pdf");
  assert.match(registrations[0].originalFilename, /^printable-unfinished-watch-jobs-\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.equal(registrations[0].sha256.length, 64);
  assert.equal(activity[0].type, "printable-report.generated");
  assert.equal(activity[0].primaryFileId, 91);
  assert.equal(activity[0].payload.rowCount, 2);
  assert.equal(activity[0].payload.sourcedRowCount, 1);
  assert.ok(activity[0].payload.contentCharacters > 0);
  assert.deepEqual(activity[0].payload.sourceEventSeqs, [42691, 42745]);
  assert.equal(activity[0].payload.pageCount, 1);
  assert.equal(result.file.ref, "agent-slayer://files/91");
  assert.equal(result.file.downloadUrl, "/api/files/91/download");
  assert.deepEqual(result.file.sourceEventSeqs, [42820]);
});

test("printable report removes an unreadable rendered PDF and reports failure", async (context) => {
  const mediaRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-slayer-printable-report-invalid-"));
  context.after(() => fsp.rm(mediaRoot, { recursive: true, force: true }));
  const service = new PrintableReportService({
    ledger: {},
    mediaRoot,
    renderPdf: async ({ filename }) => fsp.writeFile(filename, "not a PDF"),
  });
  await assert.rejects(
    service.generate(reportInput({
      sections: [{
        heading: null, description: null, presentation: "checklist",
        columns: [{ label: "Item", align: "left" }],
        rows: [{ cells: ["One item"], note: null, source_refs: [] }],
      }],
    })),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /readable PDF/);
      return true;
    },
  );
  const entries = await fsp.readdir(mediaRoot, { recursive: true });
  assert.equal(entries.some((entry) => String(entry).endsWith(".pdf")), false);
});
