import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeTodoPdfInput, renderTodoChecklistHtml, TodoPdfService } from "../src/todo-pdf.mjs";

function input() {
  return {
    filters: { group: "House", completion: "Open and completed", search: "paint" },
    groups: [{
      name: "House",
      todos: [
        { id: 7, text: "Paint <entry>", status: "todo", sequence: 123, billableAmountMinor: 4500, billableCurrency: "usd" },
        { id: 8, text: "Finished prep", status: "complete", sequence: null },
      ],
    }],
  };
}

test("to-do PDF normalizes the bounded visible projection and renders a safe checklist", () => {
  const model = normalizeTodoPdfInput(input());
  assert.equal(model.protocol, "agent-slayer.todo-checklist");
  assert.equal(model.todoCount, 2);
  assert.deepEqual(model.filters, { group: "House", completion: "Open and completed", search: "paint" });
  assert.deepEqual(model.groups[0].todos[0].billable, { amountMinor: 4500, currency: "USD" });
  const html = renderTodoChecklistHtml(model, new Date("2026-10-15T15:30:00.000Z"));
  assert.match(html, /To-do checklist/);
  assert.match(html, /Paint &lt;entry&gt;/);
  assert.match(html, /class="sequence">123<\/span>/);
  assert.doesNotMatch(html, /class="sequence">#123/);
  assert.match(html, /grid-template-columns: max-content \.18in minmax\(0, 1fr\)/);
  assert.match(html, /\.sequence \{ min-width: \.32in;[^}]*width: max-content;[^}]*white-space: nowrap;/);
  assert.match(html, /@page \{ size: Letter; margin: \.72in \.5in \.5in; \}/);
  assert.match(html, /@page :first \{ margin-top: \.5in; \}/);
  assert.match(html, /\.todo-group \{[^}]*page-break-inside: avoid;[^}]*break-inside: avoid-page;/);
  assert.match(html, /Search<\/strong>paint/);
  assert.match(html, /Billable \$45\.00/);
});

test("to-do PDF rejects snapshots that contradict the visible completion filter", () => {
  const value = input();
  value.filters.completion = "Open";
  assert.throws(() => normalizeTodoPdfInput(value), /completed to-dos are not allowed/);
});

test("to-do PDF generation registers the rendered visible checklist", async (context) => {
  const mediaRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-slayer-todo-pdf-"));
  context.after(() => fsp.rm(mediaRoot, { recursive: true, force: true }));
  const registrations = [];
  const activity = [];
  const ledger = {
    registerFile(value) {
      registrations.push(value);
      return { fileId: 81, originalFilename: value.originalFilename, mimeType: value.mimeType, byteSize: value.byteSize, storagePath: value.storagePath, duplicate: false };
    },
    append(value) { activity.push(value); return "todo-pdf-event"; },
    eventSequence(id) { assert.equal(id, "todo-pdf-event"); return 515; },
  };
  let renderInput;
  const service = new TodoPdfService({
    ledger,
    mediaRoot,
    renderPdf: async (value) => {
      renderInput = value;
      await fsp.writeFile(value.filename, Buffer.from("%PDF-1.7\nfixture\n%%EOF\n"));
    },
  });
  const result = await service.generate(input());
  assert.match(renderInput.html, /Visible to-do view/);
  assert.equal(registrations[0].mimeType, "application/pdf");
  assert.match(registrations[0].originalFilename, /^todo-checklist-\d{4}-\d{2}-\d{2}\.pdf$/u);
  assert.equal(activity[0].type, "todo-checklist.generated");
  assert.deepEqual(activity[0].payload.filters, result.model.filters);
  assert.equal(result.file.downloadUrl, "/api/files/81/download");
  assert.deepEqual(result.file.sourceEventSeqs, [515]);
});
