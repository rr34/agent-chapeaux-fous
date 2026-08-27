import { readTextAttachment } from "../request-attachments.mjs";

function requireFile(ledger, fileId) {
  const file = ledger.fileDetails(fileId);
  if (!file) throw Object.assign(new Error(`File ${fileId} was not found`), { statusCode: 404 });
  return file;
}

export function registerFileTools(registry, {
  ledger, searchCoordinator, mediaRoot, maximumTextBytes,
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
