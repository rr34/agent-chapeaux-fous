import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { RE2JS } from "re2js";
import { createFileArtifactSource } from "../artifact-source.mjs";
import { inspectTextStructure } from "../file-structure-inspect.mjs";
import { readTextAttachment } from "../request-attachments.mjs";
import { inspectDelimitedText, readDelimitedRecords, transformDelimitedText } from "../tabular-transform.mjs";

const scalarSchema = { type: ["string", "number", "boolean", "null"] };
const transformOperationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    op: {
      type: "string",
      enum: ["trim", "lowercase", "uppercase", "split", "join", "replace", "default", "date", "timestamp", "decimal", "decimal_ratio_units", "regex_extract", "regex_replace", "boolean"],
    },
    delimiter: { type: "string", minLength: 1, maxLength: 20 },
    index: { type: "integer", minimum: -1000, maximum: 1000 },
    values: { type: "object", additionalProperties: scalarSchema },
    value: scalarSchema,
    input_formats: {
      type: "array", minItems: 1, maxItems: 4, uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 80,
        description: "Date/time template using YYYY, MM, DD, HH, mm, ss, and optional S for fractional seconds. Other characters are literal; use [text] for a literal block containing token letters. Examples: DD/MM/YYYY or YYYY-MM-DD HH:mm:ss [UTC]." },
    },
    assume_utc: { type: "boolean", description: "Explicitly treat a timestamp with no UTC or Z marker as UTC." },
    from_scale: { type: "integer", minimum: 0, maximum: 30 },
    to_scale: { type: "integer", minimum: 0, maximum: 30 },
    side: { type: "string", enum: ["from_units", "to_units"] },
    pattern: { type: "string", minLength: 1, maxLength: 256,
      description: "RE2 regular expression. Match a literal period with \\. (a backslash followed by a period). Backreferences and lookaround are unsupported." },
    group: { type: ["integer", "string"], minimum: 0, maximum: 50, minLength: 1, maxLength: 80,
      description: "Capture group number (0 is the whole match) or named group for regex_extract." },
    replacement: { type: "string", maxLength: 1000,
      description: "Replacement for regex_replace. Supports $& for the whole match and $1, $2, etc. for capture groups." },
    replace_all: { type: "boolean", description: "Replace every match when true; otherwise only the first." },
    multiline: { type: "boolean", description: "Make ^ and $ match line boundaries within the value." },
    decimal_separator: { type: "string", enum: [".", ","] },
    grouping_separator: { type: ["string", "null"], minLength: 1, maxLength: 1 },
    currency_symbols: {
      type: "array", maxItems: 20, uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 20 },
    },
    parentheses_negative: { type: "boolean" },
    true_values: {
      type: "array", minItems: 1, maxItems: 20, uniqueItems: true,
      items: { type: "string", maxLength: 100 },
    },
    false_values: {
      type: "array", minItems: 1, maxItems: 20, uniqueItems: true,
      items: { type: "string", maxLength: 100 },
    },
    case_sensitive: { type: "boolean" },
  },
  required: ["op"],
};
const mappingFieldSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    output_field: { type: "string", minLength: 1, maxLength: 200 },
    source_column: { type: "string", minLength: 1, maxLength: 500 },
    source_columns: {
      type: "array", minItems: 1, maxItems: 20, uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    source_mode: { type: "string", enum: ["first_nonblank", "array"] },
    source_record_number: { type: "boolean", const: true },
    constant: scalarSchema,
    transforms: { type: "array", maxItems: 20, items: transformOperationSchema },
    empty_value: { type: "string", enum: ["keep", "null", "omit"] },
  },
  required: ["output_field"],
};
const tableInputProperties = {
  file_id: { type: "integer", minimum: 1 },
  delimiter: {
    type: "string", minLength: 1, maxLength: 20,
    description: "Use auto, comma, tab, semicolon, pipe, or one literal delimiter character.",
  },
  header_row: { type: "boolean", description: "Whether the first record contains column names." },
};
const headerAdjustmentsSchema = {
  type: "array",
  items: {
    type: "object", additionalProperties: false,
    properties: {
      columnNumber: { type: "integer", minimum: 1 },
      sourceHeader: { type: "string" },
      effectiveHeader: { type: "string", minLength: 1 },
      reason: { type: "string", enum: ["blank", "duplicate"] },
    },
    required: ["columnNumber", "sourceHeader", "effectiveHeader", "reason"],
  },
};
const tableTransformParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    ...tableInputProperties,
    mapping: {
      type: "object",
      additionalProperties: false,
      properties: {
        fields: { type: "array", minItems: 1, maxItems: 500, items: mappingFieldSchema },
      },
      required: ["fields"],
    },
    target_schema: {
      anyOf: [{ type: "object" }, { type: "null" }],
      description: "Optional authoritative JSON Schema for each transformed output object.",
    },
  },
  required: ["file_id", "delimiter", "header_row", "mapping", "target_schema"],
};

function jsonLines(values) {
  return values.length ? `${values.map((value) => JSON.stringify(value)).join("\n")}\n` : "";
}

async function storeGeneratedJsonLines({
  ledger, mediaRoot, contents, originalFilename, title, description, maximumBytes,
}) {
  const bytes = Buffer.from(contents, "utf8");
  if (bytes.length > maximumBytes) {
    throw new Error(`Transformed JSON exceeds the ${maximumBytes}-byte generated-file ceiling`);
  }
  const now = new Date();
  const relativeDirectory = path.join(
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
  );
  const directory = path.join(mediaRoot, relativeDirectory);
  await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
  const storedName = `${randomUUID()}.jsonl`;
  const absoluteFilename = path.join(directory, storedName);
  await fsp.writeFile(absoluteFilename, bytes, { flag: "wx", mode: 0o600 });
  const storagePath = path.posix.join("media", ...relativeDirectory.split(path.sep), storedName);
  let file;
  try {
    file = ledger.registerFile({
      storagePath,
      originalFilename,
      title,
      description,
      mediaKind: "document",
      mimeType: "application/x-ndjson",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.length,
    });
  } catch (error) {
    await fsp.unlink(absoluteFilename).catch(() => {});
    throw error;
  }
  if (file.duplicate && file.storagePath !== storagePath) await fsp.unlink(absoluteFilename).catch(() => {});
  return file;
}

function requireFile(ledger, fileId) {
  const file = ledger.fileDetails(fileId);
  if (!file) throw Object.assign(new Error(`File ${fileId} was not found`), { statusCode: 404 });
  return file;
}

function partitionJsonLines(bytes, { recordsPerFile, startPart, maxParts }) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const records = [];
  for (const [index, rawLine] of text.split("\n").entries()) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim()) continue;
    let parsed;
    try { parsed = JSON.parse(line); }
    catch { throw new Error(`JSON Lines source contains invalid JSON on line ${index + 1}`); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`JSON Lines source line ${index + 1} is not an object`);
    }
    records.push(line);
  }
  if (!records.length) throw new Error("JSON Lines source contains no records");
  const totalParts = Math.ceil(records.length / recordsPerFile);
  if (startPart > totalParts) throw new Error(`start_part exceeds the ${totalParts} available parts`);
  const lastPart = Math.min(totalParts, startPart + maxParts - 1);
  const parts = [];
  for (let partNumber = startPart; partNumber <= lastPart; partNumber += 1) {
    const start = (partNumber - 1) * recordsPerFile;
    const end = Math.min(records.length, start + recordsPerFile);
    parts.push({
      partNumber,
      firstRecord: start + 1,
      lastRecord: end,
      recordCount: end - start,
      contents: `${records.slice(start, end).join("\n")}\n`,
    });
  }
  return { recordCount: records.length, totalParts, parts, nextPart: lastPart < totalParts ? lastPart + 1 : null };
}

export function registerFileTools(registry, {
  ledger, searchCoordinator, mediaRoot, maximumTextBytes, maximumGeneratedBytes = 50 * 1024 * 1024,
}) {
  registry = registry.withCapability?.("files") ?? registry;
  registry.register({
    name: "file_get",
    description: "Get authoritative metadata for one durably stored upload by its stable file ID, including title, description, original filename, integrity metadata, and originating requests. This does not return file contents; use file_read for verified text contents.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { file_id: { type: "integer", minimum: 1 } },
      required: ["file_id"],
    },
    async execute({ file_id: fileId }) {
      return { file: requireFile(ledger, fileId) };
    },
  });

  registry.register({
    name: "file_structure_inspect",
    description: "Verify and inspect the complete contents of one stored text attachment before choosing a format-specific tool. Reports the declared format and bounded structure for CSV, TSV, JSON, JSON Lines, vCard, or plain text, including parse issues and source counts. A needs_review status describes an issue to investigate with file_read or file_table_read_rows; it does not require the user to repair the upload.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { file_id: { type: "integer", minimum: 1 } }, required: ["file_id"],
    },
    outputSchema: {
      type: "object",
      properties: {
        file: { type: "object" }, verified: { type: "boolean", const: true },
        encoding: { type: "string" },
        declaredFormat: { type: "string" }, format: { type: "string" },
        status: { type: "string", enum: ["parsed", "needs_review"] },
        issues: { type: "array", items: { type: "object" } },
        issueCount: { type: "integer", minimum: 0 },
        issuesTruncated: { type: "boolean" },
        structure: { type: "object" },
      },
      required: ["file", "verified", "encoding", "declaredFormat", "format", "status",
        "issues", "issueCount", "issuesTruncated", "structure"],
    },
    async execute({ file_id: fileId }) {
      const stored = ledger.file(fileId);
      if (!stored) throw Object.assign(new Error(`File ${fileId} was not found`), { statusCode: 404 });
      const verified = await readTextAttachment({ mediaRoot, file: stored, maximumBytes: maximumGeneratedBytes });
      return {
        file: requireFile(ledger, fileId), verified: true, encoding: verified.encoding,
        ...inspectTextStructure(verified.text, verified.filename),
      };
    },
  });

  registry.register({
    name: "file_read",
    description: "Read a verified character range from one durably stored CSV, text, or vCard upload by stable file ID. The server rechecks the stored byte size and SHA-256 checksum before returning contents. For imports and other completeness-sensitive work, use a result_filter with no query or field projection and limits large enough to preserve the requested source page. Continue with next_offset while has_more is true, and do not submit a completeness-sensitive operation until every page has been read. Images cannot be read with this text tool.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        file_id: { type: "integer", minimum: 1 },
        offset: { type: "integer", minimum: 0, maximum: 100000000 },
        max_characters: { type: "integer", minimum: 1, maximum: 100000 },
      },
      required: ["file_id", "offset", "max_characters"],
    },
    async execute({ file_id: fileId, offset, max_characters: maxCharacters }) {
      const stored = ledger.file(fileId);
      if (!stored) throw Object.assign(new Error(`File ${fileId} was not found`), { statusCode: 404 });
      const verified = await readTextAttachment({
        mediaRoot,
        file: stored,
        maximumBytes: maximumTextBytes,
      });
      if (offset > verified.text.length) {
        throw Object.assign(new Error(`offset exceeds file ${fileId}'s ${verified.text.length} characters`), { statusCode: 400 });
      }
      const content = verified.text.slice(offset, offset + maxCharacters);
      const nextOffset = offset + content.length;
      return {
        file: requireFile(ledger, fileId),
        verified: true,
        encoding: verified.encoding,
        total_characters: verified.text.length,
        offset,
        content,
        has_more: nextOffset < verified.text.length,
        next_offset: nextOffset < verified.text.length ? nextOffset : null,
      };
    },
  });

  registry.register({
    name: "file_text_search",
    description: "Search the complete, checksum-verified text of one stored CSV, TSV, JSON Lines, or other text file by literal string or linear-time RE2 regex. Returns exact matching physical-line count and bounded snippets with line numbers. Use file_search to discover a file ID first; use this tool to find content within that file without paging all its text through the model. A physical line is not necessarily a CSV record when a quoted field contains newlines.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        file_id: { type: "integer", minimum: 1 },
        query: { type: "string", minLength: 1, maxLength: 256 },
        match_mode: { type: "string", enum: ["literal", "regex"] },
        case_sensitive: { type: "boolean" },
        start_line: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["file_id", "query", "match_mode", "case_sensitive", "limit"],
    },
    outputSchema: {
      type: "object",
      properties: {
        file: { type: "object" }, verified: { type: "boolean", const: true },
        encoding: { type: "string" }, lineCount: { type: "integer", minimum: 0 },
        matchingLineCount: { type: "integer", minimum: 0 },
        matches: { type: "array", items: { type: "object", properties: {
          lineNumber: { type: "integer", minimum: 1 },
          column: { type: "integer", minimum: 1 },
          snippet: { type: "string" },
          snippetTruncated: { type: "boolean" },
        }, required: ["lineNumber", "column", "snippet", "snippetTruncated"] } },
        hasMore: { type: "boolean" }, nextLine: { type: ["integer", "null"], minimum: 1 },
      },
      required: ["file", "verified", "encoding", "lineCount", "matchingLineCount", "matches", "hasMore", "nextLine"],
    },
    async execute({ file_id: fileId, query, match_mode: matchMode, case_sensitive: caseSensitive,
      start_line: startLine = 1, limit }) {
      const stored = ledger.file(fileId);
      if (!stored) throw Object.assign(new Error(`File ${fileId} was not found`), { statusCode: 404 });
      const verified = await readTextAttachment({ mediaRoot, file: stored, maximumBytes: maximumGeneratedBytes });
      let regex = null;
      if (matchMode === "regex") {
        try { regex = RE2JS.compile(query, caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE); }
        catch (error) { throw Object.assign(new Error(`Invalid RE2 search pattern: ${error.message}`), { statusCode: 400 }); }
      }
      const normalizedQuery = caseSensitive ? query : query.toLocaleLowerCase();
      const lines = verified.text.split(/\r\n|\n|\r/u);
      if (lines.at(-1) === "" && lines.length > 1) lines.pop();
      const matches = [];
      let matchingLineCount = 0;
      let hasMore = false;
      for (const [index, line] of lines.entries()) {
        const position = regex
          ? (() => { const matcher = regex.matcher(line); return matcher.find() ? matcher.start() : -1; })()
          : (caseSensitive ? line : line.toLocaleLowerCase()).indexOf(normalizedQuery);
        if (position < 0) continue;
        matchingLineCount += 1;
        if (index + 1 < startLine) continue;
        if (matches.length >= limit) { hasMore = true; continue; }
        const snippetStart = Math.max(0, position - 60);
        const snippetEnd = Math.min(line.length, position + 140);
        matches.push({
          lineNumber: index + 1, column: position + 1,
          snippet: line.slice(snippetStart, snippetEnd),
          snippetTruncated: snippetStart > 0 || snippetEnd < line.length,
        });
      }
      return {
        file: requireFile(ledger, fileId), verified: true, encoding: verified.encoding,
        lineCount: lines.length, matchingLineCount, matches, hasMore,
        nextLine: hasMore ? matches.at(-1).lineNumber + 1 : null,
      };
    },
  });

  registry.register({
    name: "file_table_inspect",
    description: "Inspect one complete verified delimited-text upload as a table without asking the model to read every record. Supports comma, tab, semicolon, pipe, or one explicit literal delimiter; auto detects the common choices. Blank and repeated header cells receive distinct positional names shared with the transform tools; headerAdjustments reports each change. Returns exact record counts, headers, bounded samples, column profiles including decimal precision, and inconsistent-width record numbers so the model can design one safe declarative mapping for the whole file.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...tableInputProperties,
        sample_size: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["file_id", "delimiter", "header_row", "sample_size"],
    },
    outputSchema: {
      type: "object",
      properties: {
        file: { type: "object" },
        verified: { type: "boolean", const: true },
        encoding: { type: "string" },
        delimiter: { type: "string", minLength: 1 },
        delimiterName: { type: "string" },
        headers: { type: "array", items: { type: "string" } },
        headerAdjustments: headerAdjustmentsSchema,
        sourceRecordCount: { type: "integer", minimum: 0 },
        blankRecordCount: { type: "integer", minimum: 0 },
        inconsistentRecordCount: { type: "integer", minimum: 0 },
        inconsistentRecordNumbers: { type: "array", items: { type: "integer", minimum: 1 } },
        columns: { type: "array", items: { type: "object" } },
        sampleRecords: { type: "array", items: { type: "object" } },
      },
      required: [
        "file", "verified", "encoding", "delimiter", "delimiterName", "headers", "headerAdjustments",
        "sourceRecordCount", "blankRecordCount", "inconsistentRecordCount",
        "inconsistentRecordNumbers", "columns", "sampleRecords",
      ],
    },
    async execute({ file_id: fileId, delimiter, header_row: headerRow, sample_size: sampleSize }) {
      const stored = ledger.file(fileId);
      if (!stored) throw Object.assign(new Error(`File ${fileId} was not found`), { statusCode: 404 });
      const verified = await readTextAttachment({ mediaRoot, file: stored, maximumBytes: maximumGeneratedBytes });
      return {
        file: requireFile(ledger, fileId),
        verified: true,
        encoding: verified.encoding,
        ...inspectDelimitedText(verified.text, { delimiter, headerRow, sampleSize }),
      };
    },
  });

  registry.register({
    name: "file_table_read_rows",
    description: "Read an exact bounded page of parsed CSV or TSV records by source record number after inspection. Returns every cell in source order, the effective unique headers, and blank or duplicate header adjustments. Use this to inspect irregular rows or ambiguous columns without asking the user to edit the source file. The source file is verified again and is not changed.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        ...tableInputProperties,
        start_record: { type: "integer", minimum: 1 },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["file_id", "delimiter", "header_row", "start_record", "limit"],
    },
    outputSchema: {
      type: "object",
      properties: {
        file: { type: "object" }, verified: { type: "boolean", const: true },
        encoding: { type: "string" }, delimiter: { type: "string", minLength: 1 },
        headers: { type: "array", items: { type: "string" } },
        headerAdjustments: headerAdjustmentsSchema,
        totalRecordCount: { type: "integer", minimum: 0 },
        records: { type: "array", items: { type: "object", properties: {
          sourceRecordNumber: { type: "integer", minimum: 1 },
          cells: { type: "array", items: { type: "string" } },
          values: { type: "object" },
          matchesHeaderWidth: { type: "boolean" },
        }, required: ["sourceRecordNumber", "cells", "values", "matchesHeaderWidth"] } },
        hasMore: { type: "boolean" },
        nextRecord: { type: ["integer", "null"], minimum: 1 },
      },
      required: ["file", "verified", "encoding", "delimiter", "headers", "headerAdjustments",
        "totalRecordCount", "records", "hasMore", "nextRecord"],
    },
    async execute({ file_id: fileId, delimiter, header_row: headerRow,
      start_record: startRecord, limit }) {
      const stored = ledger.file(fileId);
      if (!stored) throw Object.assign(new Error(`File ${fileId} was not found`), { statusCode: 404 });
      const verified = await readTextAttachment({ mediaRoot, file: stored, maximumBytes: maximumGeneratedBytes });
      return {
        file: requireFile(ledger, fileId), verified: true, encoding: verified.encoding,
        ...readDelimitedRecords(verified.text, { delimiter, headerRow, startRecord, limit }),
      };
    },
  });

  registry.register({
    name: "file_table_transform_preview",
    description: "Run a complete verified table through one declarative mapping, including RE2 regex extraction/replacement, without saving artifacts or changing data. Return exact transformed and exception counts plus bounded output and exception samples. Use the same mapping and target_schema with file_table_transform after reviewing this preview; matching mappingHash proves the same mapping was used.",
    parameters: tableTransformParameters,
    outputSchema: {
      type: "object",
      properties: {
        sourceFile: { type: "object" },
        sourceSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        verified: { type: "boolean", const: true },
        delimiter: { type: "string", minLength: 1 },
        headers: { type: "array", items: { type: "string" } },
        headerAdjustments: headerAdjustmentsSchema,
        mappingHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
        sourceRecordCount: { type: "integer", minimum: 0 },
        blankRecordCount: { type: "integer", minimum: 0 },
        transformedRecordCount: { type: "integer", minimum: 0 },
        exceptionRecordCount: { type: "integer", minimum: 0 },
        accountedRecordCount: { type: "integer", minimum: 0 },
        complete: { type: "boolean" },
        outputPreview: { type: "array", items: { type: "object" } },
        outputPreviewTruncated: { type: "boolean" },
        exceptionPreview: { type: "array", items: { type: "object" } },
        exceptionPreviewTruncated: { type: "boolean" },
      },
      required: [
        "sourceFile", "sourceSha256", "verified", "delimiter", "headers", "headerAdjustments", "mappingHash",
        "sourceRecordCount", "blankRecordCount", "transformedRecordCount", "exceptionRecordCount",
        "accountedRecordCount", "complete", "outputPreview", "outputPreviewTruncated",
        "exceptionPreview", "exceptionPreviewTruncated",
      ],
    },
    async execute({ file_id: fileId, delimiter, header_row: headerRow, mapping, target_schema: targetSchema }) {
      const stored = ledger.file(fileId);
      if (!stored) throw Object.assign(new Error(`File ${fileId} was not found`), { statusCode: 404 });
      const verified = await readTextAttachment({ mediaRoot, file: stored, maximumBytes: maximumGeneratedBytes });
      const transformed = transformDelimitedText(verified.text, {
        delimiter, headerRow, mapping, targetSchema,
      });
      return {
        sourceFile: requireFile(ledger, fileId),
        sourceSha256: verified.sha256,
        verified: true,
        delimiter: transformed.delimiter,
        headers: transformed.headers,
        headerAdjustments: transformed.headerAdjustments,
        mappingHash: transformed.mappingHash,
        sourceRecordCount: transformed.sourceRecordCount,
        blankRecordCount: transformed.blankRecordCount,
        transformedRecordCount: transformed.transformedRecordCount,
        exceptionRecordCount: transformed.exceptionRecordCount,
        accountedRecordCount: transformed.transformedRecordCount + transformed.exceptionRecordCount,
        complete: transformed.transformedRecordCount + transformed.exceptionRecordCount === transformed.sourceRecordCount,
        outputPreview: transformed.records.slice(0, 20).map(({ sourceRecordNumber, record }) => ({
          source_record_number: sourceRecordNumber, record,
        })),
        outputPreviewTruncated: transformed.records.length > 20,
        exceptionPreview: transformed.exceptions.slice(0, 20),
        exceptionPreviewTruncated: transformed.exceptions.length > 20,
      };
    },
  });

  registry.register({
    name: "file_table_transform",
    description: "Apply one declarative mapping to every record in a complete verified delimited-text upload and save successful canonical objects as durable JSON Lines. Supports columns, constants, source record numbers, literal and RE2 regex extraction/replacement, declared date/time templates, exact decimal normalization and native-unit ratios, and boolean values. The model selects a regex pattern from inspected source evidence; the application compiles it once with a linear-time engine, then applies it to every bounded field. A literal period in a pattern is \\.. For decimal_ratio_units, map the same source column twice using side from_units and to_units with both currency scales; the ratio is reduced exactly without rounding. When target_schema is supplied, every output object is validated against it. Bad records become separate exceptions with source record numbers and original values. No arbitrary code executes.",
    parameters: tableTransformParameters,
    outputSchema: {
      type: "object",
      properties: {
        sourceFile: { type: "object" },
        sourceSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        delimiter: { type: "string", minLength: 1 },
        headers: { type: "array", items: { type: "string" } },
        headerAdjustments: headerAdjustmentsSchema,
        mappingHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
        sourceRecordCount: { type: "integer", minimum: 0 },
        blankRecordCount: { type: "integer", minimum: 0 },
        transformedRecordCount: { type: "integer", minimum: 0 },
        exceptionRecordCount: { type: "integer", minimum: 0 },
        accountedRecordCount: { type: "integer", minimum: 0 },
        complete: { type: "boolean" },
        outputFile: { type: ["object", "null"] },
        exceptionFile: { type: ["object", "null"] },
        exceptionPreview: { type: "array", items: { type: "object" } },
        exceptionPreviewTruncated: { type: "boolean" },
      },
      required: [
        "sourceFile", "sourceSha256", "delimiter", "headers", "headerAdjustments", "mappingHash",
        "sourceRecordCount", "blankRecordCount", "transformedRecordCount",
        "exceptionRecordCount", "accountedRecordCount", "complete", "outputFile",
        "exceptionFile", "exceptionPreview", "exceptionPreviewTruncated",
      ],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute({ file_id: fileId, delimiter, header_row: headerRow, mapping, target_schema: targetSchema }, context = {}) {
      const stored = ledger.file(fileId);
      if (!stored) throw Object.assign(new Error(`File ${fileId} was not found`), { statusCode: 404 });
      const verified = await readTextAttachment({ mediaRoot, file: stored, maximumBytes: maximumGeneratedBytes });
      const transformed = transformDelimitedText(verified.text, {
        delimiter, headerRow, mapping, targetSchema,
      });
      const sourceName = path.parse(verified.filename).name;
      const outputContents = jsonLines(transformed.records.map(({ record }) => record));
      const exceptionContents = jsonLines(transformed.exceptions);
      for (const [kind, contents] of [["output", outputContents], ["exception", exceptionContents]]) {
        const byteSize = Buffer.byteLength(contents);
        if (byteSize > maximumGeneratedBytes) {
          throw new Error(`Transformed ${kind} JSON exceeds the ${maximumGeneratedBytes}-byte generated-file ceiling`);
        }
      }
      const outputFile = transformed.records.length
        ? await storeGeneratedJsonLines({
            ledger,
            mediaRoot,
            contents: outputContents,
            originalFilename: `${sourceName}-transformed.jsonl`,
            title: `${sourceName} transformed records`,
            description: `${transformed.transformedRecordCount} canonical JSON records transformed from file ${fileId} using mapping ${transformed.mappingHash}.`,
            maximumBytes: maximumGeneratedBytes,
          })
        : null;
      const exceptionFile = transformed.exceptions.length
        ? await storeGeneratedJsonLines({
            ledger,
            mediaRoot,
            contents: exceptionContents,
            originalFilename: `${sourceName}-exceptions.jsonl`,
            title: `${sourceName} transformation exceptions`,
            description: `${transformed.exceptionRecordCount} records from file ${fileId} could not be transformed or did not match the target schema.`,
            maximumBytes: maximumGeneratedBytes,
          })
        : null;
      const result = {
        sourceFile: requireFile(ledger, fileId),
        sourceSha256: verified.sha256,
        delimiter: transformed.delimiter,
        headers: transformed.headers,
        headerAdjustments: transformed.headerAdjustments,
        mappingHash: transformed.mappingHash,
        sourceRecordCount: transformed.sourceRecordCount,
        blankRecordCount: transformed.blankRecordCount,
        transformedRecordCount: transformed.transformedRecordCount,
        exceptionRecordCount: transformed.exceptionRecordCount,
        accountedRecordCount: transformed.transformedRecordCount + transformed.exceptionRecordCount,
        complete: transformed.transformedRecordCount + transformed.exceptionRecordCount === transformed.sourceRecordCount,
        outputFile,
        exceptionFile,
        exceptionPreview: transformed.exceptions.slice(0, 20),
        exceptionPreviewTruncated: transformed.exceptions.length > 20,
      };
      ledger.append?.({
        type: "file.table.transformed",
        status: "complete",
        actorType: "tool",
        actorName: "file_table_transform",
        channel: context.channel,
        turnId: context.requestId,
        operationId: context.callId,
        name: `Transformed file #${fileId} into canonical JSON records`,
        subjectType: "file",
        subjectId: String(fileId),
        primaryFileId: outputFile?.fileId ?? exceptionFile?.fileId ?? null,
        payload: {
          sourceFileId: fileId,
          sourceSha256: verified.sha256,
          mappingHash: transformed.mappingHash,
          sourceRecordCount: transformed.sourceRecordCount,
          transformedRecordCount: transformed.transformedRecordCount,
          exceptionRecordCount: transformed.exceptionRecordCount,
          outputFileId: outputFile?.fileId ?? null,
          exceptionFileId: exceptionFile?.fileId ?? null,
        },
      });
      return result;
    },
  });

  registry.register({
    name: "file_jsonl_partition",
    description: "Split a complete, checksum-verified JSON Lines file into ordered durable part files with at most records_per_file objects each. Use the destination's published batch limit as records_per_file before artifact transfer. Returns every part's stable file ID, exact record range and count, plus paging for very many parts. No rows pass through model arguments. Repeated calls reuse identical part files. This prepares data only; use the destination's own tools to transfer and process every part and check each receipt.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        file_id: { type: "integer", minimum: 1 },
        records_per_file: { type: "integer", minimum: 1, maximum: 100000,
          description: "Maximum JSON objects per output part, taken from the destination's published batch limit." },
        start_part: { type: "integer", minimum: 1, maximum: 1000000,
          description: "One-based part number to begin returning; omit for the first part." },
        max_parts: { type: "integer", minimum: 1, maximum: 50,
          description: "Maximum part files returned in this call; omit for 50." },
      },
      required: ["file_id", "records_per_file"],
    },
    outputSchema: {
      type: "object",
      properties: {
        sourceFile: { type: "object" },
        sourceSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        verified: { type: "boolean", const: true },
        sourceRecordCount: { type: "integer", minimum: 1 },
        recordsPerFile: { type: "integer", minimum: 1 },
        totalPartCount: { type: "integer", minimum: 1 },
        parts: { type: "array", items: { type: "object", properties: {
          partNumber: { type: "integer", minimum: 1 },
          firstRecord: { type: "integer", minimum: 1 },
          lastRecord: { type: "integer", minimum: 1 },
          recordCount: { type: "integer", minimum: 1 },
          file: { type: "object" },
        }, required: ["partNumber", "firstRecord", "lastRecord", "recordCount", "file"] } },
        hasMore: { type: "boolean" },
        nextPart: { type: ["integer", "null"], minimum: 1 },
      },
      required: ["sourceFile", "sourceSha256", "verified", "sourceRecordCount", "recordsPerFile", "totalPartCount", "parts", "hasMore", "nextPart"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute({ file_id: fileId, records_per_file: recordsPerFile, start_part: startPart = 1, max_parts: maxParts = 50 }, context = {}) {
      const source = await createFileArtifactSource({ ledger, mediaRoot }).open(fileId);
      try {
        const { descriptor } = source;
        if (descriptor.mimeType !== "application/x-ndjson"
          && path.extname(descriptor.filename).toLowerCase() !== ".jsonl") {
          throw new Error(`File ${fileId} must be a JSON Lines artifact`);
        }
        if (descriptor.byteSize > maximumGeneratedBytes) {
          throw new Error(`JSON Lines source exceeds the ${maximumGeneratedBytes}-byte generated-file ceiling`);
        }
        const bytes = await source.read(0, descriptor.byteSize);
        if (createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256) {
          throw new Error(`Stored artifact ${fileId} changed during partitioning`);
        }
        const partitioned = partitionJsonLines(bytes, { recordsPerFile, startPart, maxParts });
        if (descriptor.jsonLineRecordCount !== null
          && partitioned.recordCount !== descriptor.jsonLineRecordCount) {
          throw new Error(`Stored artifact ${fileId} changed during partitioning`);
        }
        for (const part of partitioned.parts) {
          if (Buffer.byteLength(part.contents) > maximumGeneratedBytes) {
            throw new Error(`Part ${part.partNumber} exceeds the ${maximumGeneratedBytes}-byte generated-file ceiling`);
          }
        }
        const sourceName = path.parse(descriptor.filename).name;
        const parts = [];
        for (const part of partitioned.parts) {
          const file = partitioned.totalParts === 1
            ? requireFile(ledger, fileId)
            : await storeGeneratedJsonLines({
                ledger, mediaRoot, contents: part.contents,
                originalFilename: `${sourceName}-part-${String(part.partNumber).padStart(4, "0")}.jsonl`,
                title: `${sourceName} part ${part.partNumber} of ${partitioned.totalParts}`,
                description: `Records ${part.firstRecord}–${part.lastRecord} of file ${fileId}, SHA-256 ${descriptor.sha256}, partitioned at ${recordsPerFile} records per part.`,
                maximumBytes: maximumGeneratedBytes,
              });
          parts.push({
            partNumber: part.partNumber,
            firstRecord: part.firstRecord,
            lastRecord: part.lastRecord,
            recordCount: part.recordCount,
            file,
          });
        }
        const result = {
          sourceFile: requireFile(ledger, fileId),
          sourceSha256: descriptor.sha256,
          verified: true,
          sourceRecordCount: partitioned.recordCount,
          recordsPerFile,
          totalPartCount: partitioned.totalParts,
          parts,
          hasMore: partitioned.nextPart !== null,
          nextPart: partitioned.nextPart,
        };
        ledger.append?.({
          type: "file.jsonl.partitioned", status: "complete", actorType: "tool", actorName: "file_jsonl_partition",
          channel: context.channel, turnId: context.requestId, operationId: context.callId,
          name: `Partitioned file #${fileId} into ${partitioned.totalParts} ordered parts`,
          subjectType: "file", subjectId: String(fileId), primaryFileId: parts[0]?.file?.fileId ?? null,
          payload: {
            sourceFileId: fileId, sourceSha256: descriptor.sha256,
            sourceRecordCount: partitioned.recordCount, recordsPerFile,
            totalPartCount: partitioned.totalParts,
            returnedParts: parts.map(({ partNumber, file, recordCount }) => ({ partNumber, fileId: file.fileId, recordCount })),
            nextPart: partitioned.nextPart,
          },
        });
        return result;
      } finally {
        await source.close();
      }
    },
  });

  registry.register({
    name: "file_search",
    description: "Search durably stored uploads by title, description, original filename, and the text of the request that originally used the file. Returns stable file IDs for exact retrieval with file_get or file_read.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1, maxLength: 500 },
        match_mode: { type: "string", enum: ["terms", "phrase", "near"] },
        max_distance: { type: "integer", minimum: 1, maximum: 50 },
        context_tokens: { type: "integer", minimum: 5, maximum: 64 },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["query", "match_mode", "max_distance", "context_tokens", "limit"],
    },
    async execute({
      query, match_mode: mode, max_distance: maxDistance, context_tokens: contextTokens, limit,
    }) {
      return searchCoordinator.searchScope("files", {
        query, mode, maxDistance, contextTokens, limit,
      });
    },
  });

  registry.register({
    name: "file_update",
    description: "Assign an AI-generated title and plain-language description to a newly uploaded file. This cannot overwrite a user-edited title. Use it once after inspecting a new file whose title_source is original_filename; do not repeatedly retitle historical files.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        file_id: { type: "integer", minimum: 1 },
        title: { type: "string", minLength: 1, maxLength: 200 },
        description: { type: ["string", "null"], minLength: 1, maxLength: 5000 },
      },
      required: ["file_id", "title", "description"],
    },
    async execute({ file_id: fileId, title, description }, context) {
      const file = ledger.updateFile(fileId, { title, description, titleSource: "ai" });
      ledger.append({
        type: "file.metadata.updated",
        status: "complete",
        actorType: "tool",
        actorName: "file_update",
        turnId: context.requestId,
        operationId: context.callId,
        name: `Updated file #${fileId} metadata`,
        subjectType: "file",
        subjectId: String(fileId),
        payload: { fileId, titleSource: file.titleSource },
      });
      return { file };
    },
  });
}
