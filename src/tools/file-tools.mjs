import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { readTextAttachment } from "../request-attachments.mjs";
import { inspectDelimitedText, transformDelimitedText } from "../tabular-transform.mjs";

const scalarSchema = { type: ["string", "number", "boolean", "null"] };
const transformOperationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    op: {
      type: "string",
      enum: ["trim", "lowercase", "uppercase", "split", "join", "replace", "default", "date", "decimal", "boolean"],
    },
    delimiter: { type: "string", minLength: 1, maxLength: 20 },
    index: { type: "integer", minimum: -1000, maximum: 1000 },
    values: { type: "object", additionalProperties: scalarSchema },
    value: scalarSchema,
    input_formats: {
      type: "array", minItems: 1, maxItems: 4, uniqueItems: true,
      items: { type: "string", enum: ["YYYY-MM-DD", "YYYYMMDD", "MM/DD/YYYY", "DD/MM/YYYY"] },
    },
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
    name: "file_table_inspect",
    description: "Inspect one complete verified delimited-text upload as a table without asking the model to read every record. Supports comma, tab, semicolon, pipe, or one explicit literal delimiter; auto detects the common choices. Returns exact record counts, headers, bounded samples, column profiles, and inconsistent-width record numbers so the model can design one safe declarative mapping for the whole file.",
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
        sourceRecordCount: { type: "integer", minimum: 0 },
        blankRecordCount: { type: "integer", minimum: 0 },
        inconsistentRecordCount: { type: "integer", minimum: 0 },
        inconsistentRecordNumbers: { type: "array", items: { type: "integer", minimum: 1 } },
        columns: { type: "array", items: { type: "object" } },
        sampleRecords: { type: "array", items: { type: "object" } },
      },
      required: [
        "file", "verified", "encoding", "delimiter", "delimiterName", "headers",
        "sourceRecordCount", "blankRecordCount", "inconsistentRecordCount",
        "inconsistentRecordNumbers", "columns", "sampleRecords",
      ],
    },
    async execute({ file_id: fileId, delimiter, header_row: headerRow, sample_size: sampleSize }) {
      const stored = ledger.file(fileId);
      if (!stored) throw Object.assign(new Error(`File ${fileId} was not found`), { statusCode: 404 });
      const verified = await readTextAttachment({ mediaRoot, file: stored, maximumBytes: maximumTextBytes });
      return {
        file: requireFile(ledger, fileId),
        verified: true,
        encoding: verified.encoding,
        ...inspectDelimitedText(verified.text, { delimiter, headerRow, sampleSize }),
      };
    },
  });

  registry.register({
    name: "file_table_transform",
    description: "Apply one safe declarative mapping to every record in a complete verified delimited-text upload and save the successful canonical objects as a durable JSON Lines file. This function, not the model, processes every record. It supports column selection, coalescing, constants, source record numbers, trimming, case changes, literal split/join, exact replacements, defaults, declared date and decimal parsing, and declared boolean values. It executes no code and accepts no regular expressions. When target_schema is supplied, every output object is validated against it. Bad records do not discard good ones: all exceptions are saved separately with source record numbers and original values.",
    parameters: {
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
    },
    outputSchema: {
      type: "object",
      properties: {
        sourceFile: { type: "object" },
        sourceSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        delimiter: { type: "string", minLength: 1 },
        headers: { type: "array", items: { type: "string" } },
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
        "sourceFile", "sourceSha256", "delimiter", "headers", "mappingHash",
        "sourceRecordCount", "blankRecordCount", "transformedRecordCount",
        "exceptionRecordCount", "accountedRecordCount", "complete", "outputFile",
        "exceptionFile", "exceptionPreview", "exceptionPreviewTruncated",
      ],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute({ file_id: fileId, delimiter, header_row: headerRow, mapping, target_schema: targetSchema }, context = {}) {
      const stored = ledger.file(fileId);
      if (!stored) throw Object.assign(new Error(`File ${fileId} was not found`), { statusCode: 404 });
      const verified = await readTextAttachment({ mediaRoot, file: stored, maximumBytes: maximumTextBytes });
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
