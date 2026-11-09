import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const MAXIMUM_GROUPS = 1_000;
const MAXIMUM_TODOS = 1_000;
const STATUSES = new Set(["todo", "ai_suggested", "complete"]);

function inputError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function text(value, label, maximum, { required = true } = {}) {
  const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (required && !normalized) throw inputError(`${label} is required`);
  if (normalized.length > maximum) throw inputError(`${label} must be at most ${maximum} characters`);
  return normalized || null;
}

function positiveInteger(value, label) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw inputError(`${label} must be a positive integer`);
  return parsed;
}

function optionalSequence(value, label) {
  if (value == null || value === "") return null;
  return positiveInteger(value, label);
}

function optionalMoney(amountValue, currencyValue, label) {
  if (amountValue == null && currencyValue == null) return null;
  const amountMinor = positiveInteger(amountValue, `${label} billable amount`);
  const currency = String(currencyValue ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) throw inputError(`${label} billable currency must be a three-letter code`);
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency }).format(0);
  } catch {
    throw inputError(`${label} billable currency is not supported`);
  }
  return { amountMinor, currency };
}

export function normalizeTodoPdfInput(input = {}) {
  if (!Array.isArray(input.groups) || input.groups.length > MAXIMUM_GROUPS) {
    throw inputError(`groups must be an array of at most ${MAXIMUM_GROUPS} visible groups`);
  }
  const filterInput = input.filters && typeof input.filters === "object" && !Array.isArray(input.filters)
    ? input.filters : {};
  const completion = text(filterInput.completion || "Open", "filters.completion", 40);
  if (!["Open", "Open and completed"].includes(completion)) {
    throw inputError("filters.completion must be Open or Open and completed");
  }
  const filters = {
    group: text(filterInput.group || "All groups", "filters.group", 500),
    completion,
    search: text(filterInput.search, "filters.search", 500, { required: false }),
  };
  const observedIds = new Set();
  let todoCount = 0;
  const groups = input.groups.map((group, groupIndex) => {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      throw inputError(`groups[${groupIndex}] must be an object`);
    }
    if (!Array.isArray(group.todos)) throw inputError(`groups[${groupIndex}].todos must be an array`);
    todoCount += group.todos.length;
    if (todoCount > MAXIMUM_TODOS) throw inputError(`the visible checklist may contain at most ${MAXIMUM_TODOS} to-dos`);
    return {
      name: text(group.name, `groups[${groupIndex}].name`, 500),
      todos: group.todos.map((todo, todoIndex) => {
        const label = `groups[${groupIndex}].todos[${todoIndex}]`;
        if (!todo || typeof todo !== "object" || Array.isArray(todo)) throw inputError(`${label} must be an object`);
        const id = positiveInteger(todo.id, `${label}.id`);
        if (observedIds.has(id)) throw inputError(`to-do ${id} appears more than once in the visible checklist`);
        observedIds.add(id);
        const status = String(todo.status ?? "").trim();
        if (!STATUSES.has(status)) throw inputError(`${label}.status is invalid`);
        if (completion === "Open" && status === "complete") {
          throw inputError("completed to-dos are not allowed when the visible completion filter is Open");
        }
        return {
          id,
          text: text(todo.text, `${label}.text`, 5_000),
          status,
          sequence: optionalSequence(todo.sequence, `${label}.sequence`),
          billable: optionalMoney(todo.billableAmountMinor, todo.billableCurrency, label),
        };
      }),
    };
  });
  return { protocol: "agent-slayer.todo-checklist", version: 1, filters, groups, todoCount };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function money({ amountMinor, currency }) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100);
}

function todoMeta(todo) {
  const values = [];
  if (todo.status === "ai_suggested") values.push("AI suggested");
  if (todo.status === "complete") values.push("Completed");
  if (todo.billable) values.push(`Billable ${money(todo.billable)}`);
  return values.length ? `<small>${escapeHtml(values.join(" · "))}</small>` : "";
}

export function renderTodoChecklistHtml(model, generatedAt = new Date()) {
  const filters = [
    `<span><strong>Group</strong>${escapeHtml(model.filters.group)}</span>`,
    `<span><strong>Items</strong>${escapeHtml(model.filters.completion)}</span>`,
    ...(model.filters.search ? [`<span><strong>Search</strong>${escapeHtml(model.filters.search)}</span>`] : []),
  ].join("");
  const groups = model.groups.map((group) => `<section class="todo-group">
    <h2>${escapeHtml(group.name)} <span>${group.todos.length} ${group.todos.length === 1 ? "item" : "items"}</span></h2>
    ${group.todos.length ? `<ul>${group.todos.map((todo) => `<li class="${todo.status === "complete" ? "is-complete" : ""}">
      <span class="sequence">${todo.sequence == null ? "" : escapeHtml(todo.sequence)}</span>
      <span class="checkbox" aria-hidden="true">${todo.status === "complete" ? "✓" : ""}</span>
      <div><strong>${escapeHtml(todo.text)}</strong>${todoMeta(todo)}</div>
    </li>`).join("")}</ul>` : "<p class=\"empty\">No visible to-do items in this group.</p>"}
  </section>`).join("");
  const generated = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeStyle: "short" }).format(generatedAt);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>To-do checklist</title><style>
    @page { size: Letter; margin: .72in .5in .5in; }
    @page :first { margin-top: .5in; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #20251e; background: white; font-family: Arial, sans-serif; font-size: 10pt; }
    header { margin-bottom: .22in; padding-bottom: .14in; border-bottom: 2px solid #68745a; }
    header p { margin: 0 0 .035in; color: #68745a; font-size: 7pt; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; }
    h1 { margin: 0; font: 700 24pt/1.05 Georgia, serif; }
    .generated { margin-top: .06in; color: #71766d; font-size: 7pt; }
    .filters { display: flex; flex-wrap: wrap; gap: .07in .18in; margin: 0 0 .22in; padding: .09in .12in; border: 1px solid #cbd0c6; border-radius: .08in; background: #f4f6f1; }
    .filters span { display: flex; gap: .05in; color: #41483c; font-size: 7.5pt; }
    .filters strong { color: #68745a; text-transform: uppercase; letter-spacing: .05em; }
    .todo-group { margin: 0 0 .2in; page-break-inside: avoid; break-inside: avoid-page; }
    h2 { margin: 0 0 .07in; padding-bottom: .04in; border-bottom: 1px solid #cbd0c6; font: 700 14pt/1.15 Georgia, serif; break-after: avoid; }
    h2 span { margin-left: .05in; color: #71766d; font: 700 7pt Arial, sans-serif; letter-spacing: .05em; text-transform: uppercase; }
    ul { display: grid; gap: .055in; margin: 0; padding: 0; list-style: none; }
    li { min-height: .34in; display: grid; grid-template-columns: max-content .18in minmax(0, 1fr); align-items: start; gap: .07in; padding: .055in .07in; border: 1px solid #d7dbd2; border-radius: .055in; break-inside: avoid; }
    li > div { min-width: 0; padding-top: .015in; }
    li > div > strong { display: block; font: 700 9.5pt/1.25 Georgia, serif; overflow-wrap: anywhere; white-space: pre-wrap; }
    li small { display: block; margin-top: .025in; color: #71766d; font-size: 6.7pt; }
    .sequence { min-width: .32in; min-height: .27in; width: max-content; display: grid; place-items: center; padding: .025in; border-radius: .055in; color: white; background: #3b4634; font: 700 11pt/1 Georgia, serif; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .sequence:empty { background: transparent; }
    .checkbox { width: .16in; height: .16in; display: grid; place-items: center; margin-top: .045in; border: 1.5px solid #68745a; border-radius: .025in; color: #3b4634; font-size: 7pt; font-weight: 800; }
    .is-complete > div > strong { color: #71766d; text-decoration: line-through; }
    .empty { margin: 0; padding: .09in; border: 1px dashed #cbd0c6; border-radius: .055in; color: #71766d; font-style: italic; }
  </style></head><body><header><p>Visible to-do view</p><h1>To-do checklist</h1><div class="generated">Generated ${escapeHtml(generated)} · ${model.todoCount} ${model.todoCount === 1 ? "item" : "items"}</div></header><div class="filters">${filters}</div>${groups || "<p class=\"empty\">No visible to-do groups.</p>"}</body></html>`;
}

function normalizedPdfRenderError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/executable doesn't exist|browserType\.launch|failed to launch (?:the )?(?:browser|chromium)/iu.test(message)) {
    return Object.assign(new Error(
      "The PDF browser is unavailable on the server. Run `npm run install:pdf-browser` "
      + "in the deployed checkout, then restart the service. Alternatively configure "
      + "SLAYER_PDF_BROWSER_EXECUTABLE with an installed Chromium executable.",
    ), { statusCode: 503, cause: error });
  }
  return error;
}

async function defaultRenderPdf({ html, filename, browserExecutable }) {
  const browser = await chromium.launch({
    headless: true,
    ...(browserExecutable ? { executablePath: browserExecutable } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle", timeout: 60_000 });
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: filename, format: "Letter", printBackground: true, tagged: true, outline: true });
  } finally {
    await browser.close();
  }
}

export class TodoPdfService {
  constructor({ ledger, mediaRoot, browserExecutable = null, renderPdf = defaultRenderPdf }) {
    this.ledger = ledger;
    this.mediaRoot = path.resolve(mediaRoot);
    this.browserExecutable = browserExecutable;
    this.renderPdf = renderPdf;
  }

  async generate(input = {}, context = {}) {
    const model = normalizeTodoPdfInput(input);
    const now = new Date();
    const relativeDirectory = path.join(
      String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"),
    );
    const directory = path.join(this.mediaRoot, relativeDirectory);
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    const storedName = `${randomUUID()}.pdf`;
    const filename = path.join(directory, storedName);
    try {
      await this.renderPdf({
        html: renderTodoChecklistHtml(model, now), filename, browserExecutable: this.browserExecutable,
      });
      const bytes = await fsp.readFile(filename);
      const storagePath = path.posix.join("media", ...relativeDirectory.split(path.sep), storedName);
      const file = this.ledger.registerFile({
        storagePath,
        originalFilename: `todo-checklist-${now.toISOString().slice(0, 10)}.pdf`,
        title: "To-do checklist",
        description: `Printable checklist of ${model.todoCount} to-do items visible in the selected To Do view.`,
        mediaKind: "document",
        mimeType: "application/pdf",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteSize: bytes.length,
      });
      if (file.duplicate && file.storagePath !== storagePath) await fsp.unlink(filename).catch(() => {});
      const eventId = this.ledger.append({
        type: "todo-checklist.generated",
        status: "complete",
        actorType: context.actorType || "user",
        actorName: context.actorName || "todo_checklist_web",
        channel: context.channel || "web",
        name: "To-do checklist",
        primaryFileId: file.fileId,
        subjectType: "file",
        subjectId: String(file.fileId),
        payload: {
          groupCount: model.groups.length,
          todoCount: model.todoCount,
          filters: model.filters,
        },
      });
      return {
        model,
        file: {
          ...file,
          ref: `agent-slayer://files/${file.fileId}`,
          sourceEventSeqs: [this.ledger.eventSequence(eventId)].filter(Number.isSafeInteger),
          downloadUrl: `/api/files/${file.fileId}/download`,
        },
      };
    } catch (error) {
      await fsp.unlink(filename).catch(() => {});
      throw normalizedPdfRenderError(error);
    }
  }
}
