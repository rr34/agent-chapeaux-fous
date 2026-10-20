import { createHash } from "node:crypto";
import { readTextAttachment } from "./request-attachments.mjs";
import { detectDelimiter, parseDelimitedRows } from "./tabular-transform.mjs";

const monthNumbers = new Map([
  ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["may", 5], ["jun", 6],
  ["jul", 7], ["aug", 8], ["sep", 9], ["oct", 10], ["nov", 11], ["dec", 12],
]);

function normalizedDate(value, label) {
  const selected = String(value ?? "").trim();
  if (!selected) throw new Error(`${label} is blank`);
  const named = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/u.exec(selected);
  if (named) {
    const month = monthNumbers.get(named[2].toLowerCase());
    if (!month) throw new Error(`${label} has an unknown month`);
    const shortYear = Number(named[3]);
    const year = named[3].length === 2 ? (shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear) : shortYear;
    const iso = `${year.toString().padStart(4, "0")}-${String(month).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
    const date = new Date(`${iso}T00:00:00.000Z`);
    if (date.toISOString().slice(0, 10) !== iso) throw new Error(`${label} is not a real date`);
    return date.toISOString();
  }
  const date = new Date(selected.length === 10 && /^\d{4}-\d{2}-\d{2}$/u.test(selected)
    ? `${selected}T00:00:00.000Z` : selected);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is not a supported date or instant`);
  return date.toISOString();
}

export function canonicalContentSource(rawUrl, declaredHost = null) {
  const selected = String(rawUrl ?? "").trim();
  let parsed;
  try { parsed = new URL(selected); }
  catch { throw new Error(`Invalid content source URL: ${selected || "(blank)"}`); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Content source URL must use HTTP(S)");
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./u, "");
  const youtube = declaredHost === "youtube"
    || ["youtube.com", "m.youtube.com", "youtu.be"].includes(hostname);
  if (youtube) {
    let videoId = hostname === "youtu.be" ? parsed.pathname.split("/").filter(Boolean)[0] : parsed.searchParams.get("v");
    if (!videoId) {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (["shorts", "embed", "live"].includes(parts[0])) videoId = parts[1];
    }
    if (!videoId || !/^[A-Za-z0-9_-]{6,32}$/u.test(videoId)) {
      throw new Error(`YouTube URL does not contain a stable video ID: ${selected}`);
    }
    return {
      key: `youtube:${videoId}`,
      host: "youtube",
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    };
  }
  parsed.hash = "";
  const identityHost = declaredHost && declaredHost !== "none" ? declaredHost : hostname;
  return {
    key: `${identityHost}:${parsed.href}`,
    host: declaredHost ?? "none",
    canonicalUrl: parsed.href,
  };
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function headerMap(headers) {
  const normalized = headers.map((header) => String(header).trim());
  if (normalized.some((header) => !header)) throw new Error("Source file has a blank header");
  if (new Set(normalized).size !== normalized.length) throw new Error("Source file has duplicate headers");
  return new Map(normalized.map((header, index) => [header, index]));
}

function publicAction(action) {
  return {
    sourceRecordNumber: action.sourceRecordNumber,
    sourceIdentity: action.sourceIdentity,
    action: action.action,
    contentId: action.contentId ?? null,
    sequence: action.sequence,
    title: action.title,
    publishedAtUtc: action.publishedAtUtc,
    contentUrl: action.contentUrl,
    changedFields: action.changedFields,
  };
}

export class VideoContentReconciler {
  constructor({ ledger, mediaRoot, maximumBytes, videoContent }) {
    this.ledger = ledger;
    this.mediaRoot = mediaRoot;
    this.maximumBytes = maximumBytes;
    this.videoContent = videoContent;
  }

  async #plan(input) {
    const stored = this.ledger.file(input.file_id);
    if (!stored) throw Object.assign(new Error(`File ${input.file_id} was not found`), { statusCode: 404 });
    const verified = await readTextAttachment({
      mediaRoot: this.mediaRoot,
      file: stored,
      maximumBytes: this.maximumBytes,
    });
    const delimiter = input.delimiter === "auto"
      ? detectDelimiter(verified.text)
      : new Map([["comma", ","], ["tab", "\t"], ["semicolon", ";"], ["pipe", "|"]]).get(input.delimiter);
    const rows = parseDelimitedRows(verified.text, delimiter);
    if (rows.length < 2) throw new Error("Source file must contain a header and at least one data row");
    const headers = headerMap(rows[0]);
    const requiredColumns = [input.source_url_column, input.title_column, input.published_at_column];
    const missing = requiredColumns.filter((column) => !headers.has(column));
    if (missing.length) throw new Error(`Source file is missing mapped columns: ${missing.join(", ")}`);
    const desired = rows.slice(1).flatMap((row, index) => {
      if (row.every((cell) => !String(cell ?? "").trim())) return [];
      const sourceRecordNumber = index + 1;
      const source = canonicalContentSource(row[headers.get(input.source_url_column)], input.content_host);
      const title = String(row[headers.get(input.title_column)] ?? "").trim();
      if (!title) throw new Error(`Source record ${sourceRecordNumber} has a blank title`);
      return [{
        sourceRecordNumber,
        sourceIdentity: source.key,
        sequence: input.first_sequence + sourceRecordNumber - 1,
        title,
        publishedAtUtc: normalizedDate(
          row[headers.get(input.published_at_column)],
          `Source record ${sourceRecordNumber} publication time`,
        ),
        contentHost: source.host,
        contentUrl: source.canonicalUrl,
      }];
    });
    if (!desired.length) throw new Error("Source file contains no nonblank data records");
    if (desired.length > 500) throw new Error("Content reconciliation is limited to 500 source records");

    const duplicateDesired = desired.find((item, index) => (
      desired.findIndex(({ sourceIdentity }) => sourceIdentity === item.sourceIdentity) !== index
    ));
    const conflicts = [];
    if (duplicateDesired) conflicts.push({
      code: "DUPLICATE_SOURCE_IDENTITY",
      sourceRecordNumber: duplicateDesired.sourceRecordNumber,
      message: `Source identity ${duplicateDesired.sourceIdentity} occurs more than once in the file.`,
    });

    const existing = [];
    let afterSequence = 0;
    do {
      const page = this.videoContent.list({
        groupId: input.groupId,
        afterSequence,
        limit: 20,
        textCharactersPerField: 250,
        textFields: ["description"],
      });
      existing.push(...page.items);
      if (!page.hasMore) break;
      afterSequence = page.nextAfterSequence;
    } while (true);

    const existingByIdentity = new Map();
    for (const item of existing) {
      if (!item.contentUrl) continue;
      let identity;
      try { identity = canonicalContentSource(item.contentUrl, item.contentHost).key; }
      catch { continue; }
      const matches = existingByIdentity.get(identity) ?? [];
      matches.push(item);
      existingByIdentity.set(identity, matches);
    }
    for (const [sourceIdentity, matches] of existingByIdentity) {
      if (matches.length > 1 && desired.some((item) => item.sourceIdentity === sourceIdentity)) {
        conflicts.push({
          code: "AMBIGUOUS_EXISTING_SOURCE_IDENTITY",
          sourceIdentity,
          contentIds: matches.map(({ id }) => id),
          message: `More than one existing item has source identity ${sourceIdentity}.`,
        });
      }
    }

    const matchedIds = new Set(desired.flatMap(({ sourceIdentity }) => {
      const matches = existingByIdentity.get(sourceIdentity) ?? [];
      return matches.length === 1 ? [matches[0].id] : [];
    }));
    const bySequence = new Map(existing.map((item) => [item.sequence, item]));
    const actions = desired.map((item) => {
      const matches = existingByIdentity.get(item.sourceIdentity) ?? [];
      if (matches.length === 1) {
        const current = matches[0];
        const changedFields = [
          ["sequence", item.sequence],
          ["title", item.title],
          ["publishedAtUtc", item.publishedAtUtc],
          ["contentHost", item.contentHost],
          ["contentUrl", item.contentUrl],
        ].filter(([field, value]) => current[field] !== value).map(([field]) => field);
        return {
          ...item,
          action: changedFields.length ? "update" : "unchanged",
          contentId: current.id,
          version: current.version,
          changedFields,
        };
      }
      const occupant = bySequence.get(item.sequence);
      if (occupant && !matchedIds.has(occupant.id)) {
        conflicts.push({
          code: "SEQUENCE_OCCUPIED_BY_DIFFERENT_SOURCE",
          sourceRecordNumber: item.sourceRecordNumber,
          sourceIdentity: item.sourceIdentity,
          sequence: item.sequence,
          contentId: occupant.id,
          message: `Sequence ${item.sequence} is occupied by content ${occupant.id} with a different source identity.`,
        });
      }
      return { ...item, action: "create", changedFields: ["create"] };
    });

    const signature = {
      fileId: input.file_id,
      fileSha256: verified.sha256,
      groupId: input.groupId,
      mapping: {
        delimiter: input.delimiter,
        firstSequence: input.first_sequence,
        sourceUrlColumn: input.source_url_column,
        titleColumn: input.title_column,
        publishedAtColumn: input.published_at_column,
        contentHost: input.content_host,
      },
      actions: actions.map(publicAction),
      versions: actions.filter(({ version }) => version).map(({ contentId, version }) => ({ contentId, version })),
      conflicts,
    };
    return {
      ...signature,
      headers: [...headers.keys()],
      sourceRecordCount: desired.length,
      existingNumberedCount: existing.length,
      createCount: actions.filter(({ action }) => action === "create").length,
      updateCount: actions.filter(({ action }) => action === "update").length,
      unchangedCount: actions.filter(({ action }) => action === "unchanged").length,
      canApply: conflicts.length === 0,
      previewDigest: digest(signature),
      actions,
    };
  }

  async preview(input) {
    const plan = await this.#plan(input);
    return {
      fileId: plan.fileId,
      fileSha256: plan.fileSha256,
      groupId: plan.groupId,
      headers: plan.headers,
      sourceRecordCount: plan.sourceRecordCount,
      existingNumberedCount: plan.existingNumberedCount,
      createCount: plan.createCount,
      updateCount: plan.updateCount,
      unchangedCount: plan.unchangedCount,
      canApply: plan.canApply,
      conflicts: plan.conflicts,
      previewDigest: plan.previewDigest,
      actions: plan.actions.map(publicAction),
    };
  }

  async apply(input, context = {}) {
    const plan = await this.#plan(input);
    if (plan.previewDigest !== input.preview_digest) {
      throw Object.assign(new Error("Reconciliation preview is stale; preview the verified source and current group again."), { statusCode: 409 });
    }
    if (!plan.canApply) throw Object.assign(new Error("Reconciliation has unresolved source-identity conflicts."), { statusCode: 409 });
    const mutation = this.videoContent.reconcileItems({
      groupId: input.groupId,
      sourceFileId: input.file_id,
      sourceSha256: plan.fileSha256,
      previewDigest: plan.previewDigest,
      updates: plan.actions.filter(({ action }) => action === "update").map((action) => ({
        content_id: action.contentId,
        version: action.version,
        sequence: action.sequence,
        title: action.title,
        publishedAtUtc: action.publishedAtUtc,
        contentHost: action.contentHost,
        contentUrl: action.contentUrl,
      })),
      creates: plan.actions.filter(({ action }) => action === "create").map((action) => ({
        sourceIdentity: action.sourceIdentity,
        sequence: action.sequence,
        title: action.title,
        publishedAtUtc: action.publishedAtUtc,
        contentHost: action.contentHost,
        contentUrl: action.contentUrl,
      })),
    }, context);
    const createdByIdentity = new Map(mutation.createdItems.map((item) => [
      canonicalContentSource(item.contentUrl, item.contentHost).key,
      item,
    ]));
    const projection = plan.actions.map((action) => {
      const item = action.contentId
        ? this.videoContent.getItem(action.contentId)
        : createdByIdentity.get(action.sourceIdentity);
      return {
        sourceRecordNumber: action.sourceRecordNumber,
        sourceIdentity: action.sourceIdentity,
        action: action.action,
        content_id: item.id,
        content_ref: `agent-slayer://content-items/${item.id}`,
        content_title: item.title,
        sequence: item.sequence,
        publishedAtUtc: item.publishedAtUtc,
        contentHost: item.contentHost,
        contentUrl: item.contentUrl,
        version: item.version,
      };
    });
    return {
      sourceRecordCount: plan.sourceRecordCount,
      verifiedCount: projection.length,
      createdCount: mutation.createdCount,
      updatedCount: mutation.updatedCount,
      unchangedCount: plan.unchangedCount,
      previewDigest: plan.previewDigest,
      items: projection,
    };
  }
}
