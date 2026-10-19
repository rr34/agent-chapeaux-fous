import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright-core";
import { flatObjectReferences } from "./object-references.mjs";

const PAPER_SIZES = new Set(["letter", "a4"]);
const ORIENTATIONS = new Set(["portrait", "landscape"]);
const PRESENTATIONS = new Set(["table", "list", "checklist"]);
const ALIGNMENTS = new Set(["left", "center", "right"]);
const MAXIMUM_SECTIONS = 20;
const MAXIMUM_COLUMNS = 8;
const MAXIMUM_ROWS_PER_SECTION = 500;
const MAXIMUM_TOTAL_ROWS = 1_000;
const MAXIMUM_SOURCE_REFS_PER_ROW = 20;
const MAXIMUM_TOTAL_CHARACTERS = 500_000;

function inputError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function text(value, label, maximum, { nullable = false, empty = false } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== "string") throw inputError(`${label} must be a string${nullable ? " or null" : ""}`);
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (!normalized && !empty) throw inputError(`${label} is required`);
  if (normalized.length > maximum) throw inputError(`${label} must be at most ${maximum} characters`);
  return normalized;
}

function uniqueStrings(values, label, maximumItems, maximumLength) {
  if (!Array.isArray(values) || values.length > maximumItems) {
    throw inputError(`${label} must be an array of at most ${maximumItems} strings`);
  }
  const normalized = values.map((value, index) => text(
    value, `${label}[${index}]`, maximumLength,
  ));
  if (new Set(normalized).size !== normalized.length) throw inputError(`${label} must not contain duplicates`);
  return normalized;
}

function normalizedSourceCatalog(verifiedObjectReferences) {
  return new Map(flatObjectReferences(verifiedObjectReferences).map((object) => [object.ref, object]));
}

export function normalizePrintableReportInput(input = {}, {
  verifiedObjectReferences = [],
  generatedAt = new Date(),
} = {}) {
  const title = text(input.title, "title", 200);
  const subtitle = text(input.subtitle, "subtitle", 400, { nullable: true });
  const description = text(input.description, "description", 2_000, { nullable: true });
  const paperSize = String(input.paper_size ?? "").trim().toLowerCase();
  if (!PAPER_SIZES.has(paperSize)) throw inputError("paper_size must be letter or a4");
  const orientation = String(input.orientation ?? "").trim().toLowerCase();
  if (!ORIENTATIONS.has(orientation)) throw inputError("orientation must be portrait or landscape");
  if (typeof input.show_source_appendix !== "boolean") {
    throw inputError("show_source_appendix must be a boolean");
  }
  if (!Array.isArray(input.sections) || input.sections.length < 1 || input.sections.length > MAXIMUM_SECTIONS) {
    throw inputError(`sections must contain 1 through ${MAXIMUM_SECTIONS} sections`);
  }

  const sourceCatalog = normalizedSourceCatalog(verifiedObjectReferences);
  const usedSources = new Map();
  let rowCount = 0;
  let sourcedRowCount = 0;
  const sections = input.sections.map((section, sectionIndex) => {
    const label = `sections[${sectionIndex}]`;
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      throw inputError(`${label} must be an object`);
    }
    const presentation = String(section.presentation ?? "").trim().toLowerCase();
    if (!PRESENTATIONS.has(presentation)) {
      throw inputError(`${label}.presentation must be table, list, or checklist`);
    }
    if (!Array.isArray(section.columns) || section.columns.length < 1 || section.columns.length > MAXIMUM_COLUMNS) {
      throw inputError(`${label}.columns must contain 1 through ${MAXIMUM_COLUMNS} columns`);
    }
    const columns = section.columns.map((column, columnIndex) => {
      if (!column || typeof column !== "object" || Array.isArray(column)) {
        throw inputError(`${label}.columns[${columnIndex}] must be an object`);
      }
      const align = String(column.align ?? "").trim().toLowerCase();
      if (!ALIGNMENTS.has(align)) {
        throw inputError(`${label}.columns[${columnIndex}].align must be left, center, or right`);
      }
      return {
        label: text(column.label, `${label}.columns[${columnIndex}].label`, 120),
        align,
      };
    });
    const normalizedLabels = columns.map(({ label: columnLabel }) => columnLabel.toLocaleLowerCase("en-US"));
    if (new Set(normalizedLabels).size !== normalizedLabels.length) {
      throw inputError(`${label}.columns labels must be unique`);
    }
    if (!Array.isArray(section.rows) || section.rows.length > MAXIMUM_ROWS_PER_SECTION) {
      throw inputError(`${label}.rows must be an array of at most ${MAXIMUM_ROWS_PER_SECTION} rows`);
    }
    rowCount += section.rows.length;
    if (rowCount > MAXIMUM_TOTAL_ROWS) {
      throw inputError(`the report may contain at most ${MAXIMUM_TOTAL_ROWS} total rows`);
    }
    const rows = section.rows.map((row, rowIndex) => {
      const rowLabel = `${label}.rows[${rowIndex}]`;
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw inputError(`${rowLabel} must be an object`);
      }
      if (!Array.isArray(row.cells) || row.cells.length !== columns.length) {
        throw inputError(`${rowLabel}.cells must contain exactly ${columns.length} values`);
      }
      const sourceRefs = uniqueStrings(
        row.source_refs, `${rowLabel}.source_refs`, MAXIMUM_SOURCE_REFS_PER_ROW, 1_000,
      );
      const sources = sourceRefs.map((ref) => {
        const source = sourceCatalog.get(ref);
        if (!source) {
          throw inputError(`${rowLabel}.source_refs contains unverified object reference ${JSON.stringify(ref)}`);
        }
        usedSources.set(ref, source);
        return {
          ref: source.ref,
          display: source.display,
          type: source.type,
          source: source.source,
          sourceEventSeqs: source.sourceEventSeqs,
        };
      });
      if (sources.length) sourcedRowCount += 1;
      return {
        cells: row.cells.map((cell, cellIndex) => text(
          cell, `${rowLabel}.cells[${cellIndex}]`, 5_000, { empty: true },
        )),
        note: text(row.note, `${rowLabel}.note`, 2_000, { nullable: true }),
        sourceRefs,
        sources,
      };
    });
    return {
      heading: text(section.heading, `${label}.heading`, 200, { nullable: true }),
      description: text(section.description, `${label}.description`, 2_000, { nullable: true }),
      presentation,
      columns,
      rows,
    };
  });
  const sourceEventSeqs = [...new Set([...usedSources.values()]
    .flatMap(({ sourceEventSeqs = [] }) => sourceEventSeqs))]
    .filter((value) => Number.isSafeInteger(value) && value > 0)
    .sort((left, right) => left - right);
  const contentCharacters = JSON.stringify({
    title, subtitle, description, sections: sections.map((section) => ({
      heading: section.heading,
      description: section.description,
      columns: section.columns,
      rows: section.rows.map(({ cells, note, sourceRefs }) => ({ cells, note, sourceRefs })),
    })),
  }).length;
  if (contentCharacters > MAXIMUM_TOTAL_CHARACTERS) {
    throw inputError(`the report content may contain at most ${MAXIMUM_TOTAL_CHARACTERS} total characters`);
  }
  return {
    protocol: "agent-slayer.printable-report",
    version: 1,
    generatedAtUtc: generatedAt.toISOString(),
    title,
    subtitle,
    description,
    paperSize,
    orientation,
    showSourceAppendix: input.show_source_appendix,
    sections,
    sectionCount: sections.length,
    rowCount,
    sourcedRowCount,
    unsourcedRowCount: rowCount - sourcedRowCount,
    sourceObjectCount: usedSources.size,
    sourceEventSeqs,
    sourceObjects: [...usedSources.values()],
    contentCharacters,
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function sourceMarkers(row) {
  if (!row.sources.length) return "";
  const labels = row.sources.map(({ display }) => display).join(" · ");
  return `<small class="sources">Sources: ${escapeHtml(labels)}</small>`;
}

function tableSection(section) {
  const headings = section.columns.map(({ label, align }) => (
    `<th class="align-${align}" scope="col">${escapeHtml(label)}</th>`
  )).join("");
  const rows = section.rows.map((row) => `<tr>${row.cells.map((cell, index) => (
    `<td class="align-${section.columns[index].align}"><div>${escapeHtml(cell)}</div>${
      index === 0 && row.note ? `<p>${escapeHtml(row.note)}</p>` : ""
    }${index === 0 ? sourceMarkers(row) : ""}</td>`
  )).join("")}</tr>`).join("");
  return `<table><thead><tr>${headings}</tr></thead><tbody>${rows || `<tr><td class="empty" colspan="${section.columns.length}">No items.</td></tr>`}</tbody></table>`;
}

function listSection(section) {
  if (!section.rows.length) return "<p class=\"empty\">No items.</p>";
  const checklist = section.presentation === "checklist";
  const tag = checklist ? "ul" : "ol";
  return `<${tag} class="report-list ${checklist ? "checklist" : "numbered-list"}">${section.rows.map((row) => {
    const metadata = row.cells.slice(1).map((cell, index) => (
      `<span><strong>${escapeHtml(section.columns[index + 1].label)}</strong>${escapeHtml(cell)}</span>`
    )).join("");
    return `<li>${checklist ? "<span class=\"checkbox\" aria-hidden=\"true\"></span>" : ""}<div class="list-content"><strong>${escapeHtml(row.cells[0])}</strong>${metadata ? `<div class="metadata">${metadata}</div>` : ""}${row.note ? `<p>${escapeHtml(row.note)}</p>` : ""}${sourceMarkers(row)}</div></li>`;
  }).join("")}</${tag}>`;
}

function sourceAppendix(model) {
  if (!model.showSourceAppendix || !model.sourceObjects.length) return "";
  const sources = [...model.sourceObjects]
    .sort((left, right) => left.display.localeCompare(right.display) || left.ref.localeCompare(right.ref));
  return `<section class="report-section source-appendix"><h2>Source objects</h2><p>Stable references used by sourced report rows.</p><ol>${sources.map((source) => `<li><strong>${escapeHtml(source.display)}</strong><span>${escapeHtml(source.type)} · ${escapeHtml(source.source)}</span><code>${escapeHtml(source.ref)}</code></li>`).join("")}</ol></section>`;
}

export function renderPrintableReportHtml(model) {
  const generated = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "UTC", timeZoneName: "short",
  }).format(new Date(model.generatedAtUtc));
  const sections = model.sections.map((section) => `<section class="report-section">${
    section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ""
  }${section.description ? `<p class="section-description">${escapeHtml(section.description)}</p>` : ""}${
    section.presentation === "table" ? tableSection(section) : listSection(section)
  }</section>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(model.title)}</title><style>
    @page { margin: .55in .5in .6in; }
    * { box-sizing: border-box; }
    html { color: #20251e; background: white; font-family: Arial, sans-serif; font-size: 10pt; }
    body { margin: 0; }
    header { margin-bottom: .25in; padding-bottom: .14in; border-bottom: 2px solid #68745a; }
    .eyebrow { margin: 0 0 .045in; color: #68745a; font-size: 7pt; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 0; font: 700 24pt/1.07 Georgia, serif; overflow-wrap: anywhere; }
    .subtitle { margin: .07in 0 0; color: #4a5145; font: 700 11pt/1.3 Georgia, serif; white-space: pre-wrap; }
    .description { max-width: 8.5in; margin: .09in 0 0; color: #555d51; font-size: 8.5pt; line-height: 1.45; white-space: pre-wrap; }
    .generated { margin-top: .08in; color: #747a70; font-size: 7pt; }
    .report-section { margin: 0 0 .25in; }
    h2 { margin: 0 0 .09in; padding-bottom: .045in; border-bottom: 1px solid #cbd0c6; font: 700 15pt/1.15 Georgia, serif; break-after: avoid; }
    .section-description { margin: -.025in 0 .1in; color: #62695f; font-size: 8pt; line-height: 1.4; white-space: pre-wrap; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; }
    th { padding: .06in .07in; border: 1px solid #aeb6a8; color: white; background: #56624c; font-size: 7.2pt; letter-spacing: .045em; text-transform: uppercase; }
    td { padding: .07in; border: 1px solid #d1d6cd; vertical-align: top; line-height: 1.32; overflow-wrap: anywhere; white-space: pre-wrap; }
    tbody tr:nth-child(even) td { background: #f5f6f2; }
    td p { margin: .035in 0 0; color: #646b61; font-size: 7.4pt; white-space: pre-wrap; }
    .align-left { text-align: left; } .align-center { text-align: center; } .align-right { text-align: right; }
    .empty { padding: .12in; color: #747a70; font-style: italic; text-align: left; }
    .report-list { display: grid; gap: .065in; margin: 0; padding: 0; }
    .report-list > li { min-height: .34in; break-inside: avoid; padding: .07in .09in; border: 1px solid #d1d6cd; border-radius: .055in; }
    .checklist { list-style: none; }
    .checklist > li { display: grid; grid-template-columns: .17in minmax(0, 1fr); gap: .08in; }
    .numbered-list { padding-left: .28in; }
    .numbered-list > li { padding-left: .05in; }
    .checkbox { width: .16in; height: .16in; margin-top: .025in; border: 1.5px solid #68745a; border-radius: .025in; }
    .list-content { min-width: 0; }
    .list-content > strong { display: block; font: 700 10pt/1.25 Georgia, serif; overflow-wrap: anywhere; white-space: pre-wrap; }
    .list-content > p { margin: .04in 0 0; color: #5e665a; font-size: 8pt; line-height: 1.35; white-space: pre-wrap; }
    .metadata { display: flex; flex-wrap: wrap; gap: .04in .16in; margin-top: .045in; }
    .metadata span { color: #343b31; font-size: 7.6pt; }
    .metadata strong { margin-right: .035in; color: #68745a; font-size: 6.7pt; letter-spacing: .04em; text-transform: uppercase; }
    .sources { display: block; margin-top: .04in; color: #777d74; font-size: 6.5pt; line-height: 1.3; }
    .source-appendix { break-before: page; }
    .source-appendix > p { color: #62695f; font-size: 8pt; }
    .source-appendix ol { display: grid; gap: .06in; padding-left: .25in; }
    .source-appendix li { break-inside: avoid; }
    .source-appendix li strong, .source-appendix li span, .source-appendix li code { display: block; }
    .source-appendix li span { color: #62695f; font-size: 7pt; }
    .source-appendix li code { margin-top: .015in; color: #4b5347; font-size: 6.5pt; overflow-wrap: anywhere; }
  </style></head><body><header><p class="eyebrow">Printable report</p><h1>${escapeHtml(model.title)}</h1>${model.subtitle ? `<p class="subtitle">${escapeHtml(model.subtitle)}</p>` : ""}${model.description ? `<p class="description">${escapeHtml(model.description)}</p>` : ""}<div class="generated">Generated ${escapeHtml(generated)} · ${model.rowCount} ${model.rowCount === 1 ? "item" : "items"}</div></header>${sections}${sourceAppendix(model)}</body></html>`;
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

async function defaultRenderPdf({ html, filename, paperSize, orientation, browserExecutable }) {
  const browser = await chromium.launch({
    headless: true,
    ...(browserExecutable ? { executablePath: browserExecutable } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle", timeout: 60_000 });
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: filename,
      format: paperSize === "a4" ? "A4" : "Letter",
      landscape: orientation === "landscape",
      printBackground: true,
      tagged: true,
      outline: true,
    });
  } finally {
    await browser.close();
  }
}

function filenameSlug(value) {
  return String(value).normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 60) || "report";
}

export class PrintableReportService {
  constructor({
    ledger,
    mediaRoot,
    browserExecutable = null,
    maximumBytes = 50 * 1024 * 1024,
    renderPdf = defaultRenderPdf,
  }) {
    this.ledger = ledger;
    this.mediaRoot = path.resolve(mediaRoot);
    this.browserExecutable = browserExecutable;
    this.maximumBytes = maximumBytes;
    this.renderPdf = renderPdf;
  }

  async generate(input = {}, context = {}) {
    const now = new Date();
    const model = normalizePrintableReportInput(input, {
      verifiedObjectReferences: context.verifiedObjectReferences,
      generatedAt: now,
    });
    const relativeDirectory = path.join(
      String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"),
    );
    const directory = path.join(this.mediaRoot, relativeDirectory);
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    const storedName = `${randomUUID()}.pdf`;
    const filename = path.join(directory, storedName);
    try {
      await this.renderPdf({
        html: renderPrintableReportHtml(model),
        filename,
        paperSize: model.paperSize,
        orientation: model.orientation,
        browserExecutable: this.browserExecutable,
      });
      const bytes = await fsp.readFile(filename);
      if (!bytes.length || bytes.length > this.maximumBytes) {
        throw Object.assign(new Error(
          bytes.length
            ? `The rendered printable report exceeds the ${this.maximumBytes}-byte generated-file ceiling.`
            : "The printable report renderer returned an empty document.",
        ), { statusCode: bytes.length ? 413 : 502 });
      }
      let pageCount;
      try {
        pageCount = (await PDFDocument.load(bytes)).getPageCount();
      } catch (error) {
        throw Object.assign(new Error("The printable report renderer did not return a readable PDF."), {
          statusCode: 502,
          cause: error,
        });
      }
      if (pageCount < 1) throw Object.assign(new Error("The printable report PDF has no pages."), { statusCode: 502 });
      const storagePath = path.posix.join("media", ...relativeDirectory.split(path.sep), storedName);
      const originalFilename = `printable-${filenameSlug(model.title)}-${now.toISOString().slice(0, 10)}.pdf`;
      const file = this.ledger.registerFile({
        storagePath,
        originalFilename,
        title: model.title,
        description: `Printable ${model.sectionCount}-section report containing ${model.rowCount} items.`,
        mediaKind: "document",
        mimeType: "application/pdf",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteSize: bytes.length,
      });
      if (file.duplicate && file.storagePath !== storagePath) await fsp.unlink(filename).catch(() => {});
      const eventId = this.ledger.append({
        type: "printable-report.generated",
        status: "complete",
        actorType: context.actorType || "tool",
        actorName: context.actorName || "printable_report_generate",
        channel: context.channel || "web",
        turnId: context.requestId || null,
        operationId: context.callId || null,
        name: model.title,
        primaryFileId: file.fileId,
        subjectType: "file",
        subjectId: String(file.fileId),
        payload: {
          protocol: model.protocol,
          version: model.version,
          paperSize: model.paperSize,
          orientation: model.orientation,
          sectionCount: model.sectionCount,
          rowCount: model.rowCount,
          sourcedRowCount: model.sourcedRowCount,
          unsourcedRowCount: model.unsourcedRowCount,
          sourceObjectCount: model.sourceObjectCount,
          sourceEventSeqs: model.sourceEventSeqs,
          contentCharacters: model.contentCharacters,
          pageCount,
          showSourceAppendix: model.showSourceAppendix,
        },
      });
      return {
        model,
        pageCount,
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
