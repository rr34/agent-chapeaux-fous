const protocol = "agent-slayer.search-data";
const protocolVersion = 1;
const protectedField = /(?:^id$|_id$|Id$|^name$|^title$|^status$|^version$|Ref$|_ref$)/u;

export const readResultFilterSchema = {
  type: "object",
  additionalProperties: false,
  description: "Required deterministic filtering applied after this read and before its result enters LLM context. Use a null collection_path for automatic selection when the result has zero or one top-level record array.",
  properties: {
    collection_path: {
      type: ["string", "null"], maxLength: 500,
      description: "RFC 6901 JSON Pointer to the result array to filter, or null for automatic selection.",
    },
    query: {
      type: ["string", "null"], minLength: 1, maxLength: 500,
      description: "Optional text used to filter items in the selected collection before the result is returned.",
    },
    match_mode: {
      type: "string", enum: ["all_terms", "any_term", "phrase"],
      description: "How query text matches scalar values in each collection item.",
    },
    include_fields: {
      type: "array", maxItems: 100, uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 200 },
      description: "Top-level collection-item fields to retain. Stable identity and reference fields are retained automatically. Empty keeps all fields.",
    },
    exclude_fields: {
      type: "array", maxItems: 100, uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 200 },
      description: "Top-level collection-item fields to remove, except protected identity and reference fields.",
    },
    max_items: {
      type: "integer", minimum: 1, maximum: 200,
      description: "Maximum collection items allowed into the next LLM context.",
    },
    max_characters: {
      type: "integer", minimum: 1000, maximum: 32768,
      description: "Maximum serialized result characters allowed inline before receipt paging is used.",
    },
  },
  required: [
    "collection_path", "query", "match_mode", "include_fields", "exclude_fields",
    "max_items", "max_characters",
  ],
};

export function withReadResultFilterSchema(inputSchema, readOnly) {
  if (!readOnly || inputSchema?.type !== "object") return inputSchema;
  if (Object.hasOwn(inputSchema.properties ?? {}, "result_filter")) {
    throw new Error("Tool input schema reserves result_filter for Agent Slayer's read-result boundary");
  }
  return {
    ...inputSchema,
    properties: { ...(inputSchema.properties ?? {}), result_filter: readResultFilterSchema },
    required: [...new Set([...(inputSchema.required ?? []), "result_filter"])],
  };
}

export function splitReadResultFilter(argumentsObject, readOnly) {
  if (!readOnly) return { toolArguments: argumentsObject, filterRequest: null };
  const { result_filter: filterRequest, ...toolArguments } = argumentsObject;
  return { toolArguments, filterRequest };
}

function pointerParts(pointer) {
  if (pointer === "") return [];
  if (typeof pointer !== "string" || !pointer.startsWith("/")) {
    throw new Error("collection_path must be null, an empty JSON Pointer, or begin with /");
  }
  return pointer.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function valueAtPointer(value, pointer) {
  let current = value;
  for (const part of pointerParts(pointer)) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) {
      throw new Error(`collection_path ${pointer || "<root>"} does not exist in the tool result`);
    }
    current = current[part];
  }
  if (!Array.isArray(current)) {
    throw new Error(`collection_path ${pointer || "<root>"} does not identify an array`);
  }
  return current;
}

function replaceAtPointer(value, pointer, replacement) {
  if (pointer === "") return replacement;
  const copy = structuredClone(value);
  const parts = pointerParts(pointer);
  let parent = copy;
  for (const part of parts.slice(0, -1)) parent = parent[part];
  parent[parts.at(-1)] = replacement;
  return copy;
}

function automaticCollectionPointer(value) {
  if (Array.isArray(value)) return "";
  if (!value || typeof value !== "object") return null;
  const candidates = Object.entries(value).filter(([, entry]) => Array.isArray(entry));
  if (candidates.length === 1) return `/${candidates[0][0].replaceAll("~", "~0").replaceAll("/", "~1")}`;
  return null;
}

function scalarText(value, output = []) {
  if (value == null) return output;
  if (["string", "number", "boolean"].includes(typeof value)) {
    output.push(String(value));
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) scalarText(item, output);
    return output;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) scalarText(item, output);
  }
  return output;
}

function normalized(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase().trim().replaceAll(/\s+/gu, " ");
}

function queryMatches(value, query, mode) {
  if (!query) return true;
  const candidate = normalized(scalarText(value).join(" "));
  const selected = normalized(query);
  if (mode === "phrase") return candidate.includes(selected);
  const terms = [...new Set(selected.split(" ").filter(Boolean))];
  return mode === "any_term"
    ? terms.some((term) => candidate.includes(term))
    : terms.every((term) => candidate.includes(term));
}

function projectedItem(value, includeFields, excludeFields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const include = new Set(includeFields);
  const exclude = new Set(excludeFields);
  return Object.fromEntries(Object.entries(value).filter(([field]) => {
    if (protectedField.test(field)) return true;
    if (exclude.has(field)) return false;
    return include.size === 0 || include.has(field);
  }));
}

function protocolReceipt({
  requestId, interactionId, tool, source, filterRequest, status, collectionPath,
  inputCharacters, outputCharacters, candidates, returned, prunedByReason,
  paged = false, error = null,
}) {
  return {
    protocol,
    version: protocolVersion,
    messageId: `${requestId}:${interactionId}:result-filter`,
    requestId,
    interactionId,
    source: { tool, provider: source ?? "local" },
    status,
    filter: filterRequest,
    collectionPath,
    summary: {
      candidates,
      returned,
      pruned: candidates == null || returned == null ? null : Math.max(0, candidates - returned),
      prunedByReason,
      inputCharacters,
      outputCharacters,
      paged,
    },
    ...(error ? { error } : {}),
  };
}

function withReceipt(value, receipt) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...value, result_filter: receipt };
  }
  return { data: value, result_filter: receipt };
}

export class ResultFilterBoundary {
  filterReadResult(result, {
    requestId, interactionId, tool, source, filterRequest, receiptEventSeq = null,
  }) {
    const inputCharacters = JSON.stringify(result ?? null).length;
    let collectionPath = filterRequest.collection_path;
    if (collectionPath === null) collectionPath = automaticCollectionPointer(result);
    const needsCollection = Boolean(
      filterRequest.query
      || filterRequest.include_fields.length
      || filterRequest.exclude_fields.length,
    );
    if (needsCollection && collectionPath === null) {
      const error = "result_filter needs collection_path because this result does not have exactly one top-level array";
      const receipt = protocolReceipt({
        requestId, interactionId, tool, source, filterRequest, status: "error",
        collectionPath: null, inputCharacters, outputCharacters: 0,
        candidates: null, returned: null, prunedByReason: {}, error,
      });
      return { ok: false, error, deliveredResult: { result_filter: receipt }, receipt, paged: false };
    }

    let filtered = structuredClone(result);
    let candidates = null;
    let returned = null;
    const prunedByReason = {};
    try {
      if (collectionPath !== null) {
        const collection = valueAtPointer(filtered, collectionPath);
        candidates = collection.length;
        const matched = collection.filter((item) => queryMatches(
          item, filterRequest.query, filterRequest.match_mode,
        ));
        if (matched.length !== collection.length) prunedByReason.query = collection.length - matched.length;
        const limited = matched.slice(0, filterRequest.max_items);
        if (limited.length !== matched.length) prunedByReason.max_items = matched.length - limited.length;
        const projected = limited.map((item) => projectedItem(
          item, filterRequest.include_fields, filterRequest.exclude_fields,
        ));
        if (filterRequest.include_fields.length || filterRequest.exclude_fields.length) {
          prunedByReason.fields = true;
        }
        returned = projected.length;
        filtered = replaceAtPointer(filtered, collectionPath, projected);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const receipt = protocolReceipt({
        requestId, interactionId, tool, source, filterRequest, status: "error",
        collectionPath, inputCharacters, outputCharacters: 0,
        candidates, returned, prunedByReason, error: message,
      });
      return { ok: false, error: message, deliveredResult: { result_filter: receipt }, receipt, paged: false };
    }

    const provisionalReceipt = protocolReceipt({
      requestId, interactionId, tool, source, filterRequest,
      status: returned === 0 ? "empty" : "complete", collectionPath,
      inputCharacters, outputCharacters: 0, candidates, returned, prunedByReason,
    });
    let deliveredResult = withReceipt(filtered, provisionalReceipt);
    let serialized = JSON.stringify(deliveredResult);
    const overMaximum = serialized.length > filterRequest.max_characters;
    if (overMaximum && !Number.isSafeInteger(receiptEventSeq)) {
      const error = "Filtered result exceeds max_characters and has no durable receipt available for paging";
      const receipt = protocolReceipt({
        requestId, interactionId, tool, source, filterRequest, status: "error", collectionPath,
        inputCharacters, outputCharacters: 0, candidates, returned, prunedByReason, error,
      });
      return {
        ok: false, error, deliveredResult: { result_filter: receipt }, receipt, paged: false,
      };
    }
    const paged = overMaximum;
    const status = paged ? "partial" : provisionalReceipt.status;
    const receipt = protocolReceipt({
      requestId, interactionId, tool, source, filterRequest, status, collectionPath,
      inputCharacters, outputCharacters: paged ? filterRequest.max_characters : serialized.length,
      candidates, returned, prunedByReason, paged,
    });
    deliveredResult = withReceipt(filtered, receipt);
    serialized = JSON.stringify(deliveredResult);
    if (paged) {
      deliveredResult = {
        full_result_stored_in_receipt: true,
        receipt_event_seq: receiptEventSeq,
        tool,
        full_result_characters: serialized.length,
        leading_filtered_result_json: serialized.slice(0, filterRequest.max_characters),
        leading_result_characters: filterRequest.max_characters,
        result_filter: receipt,
        continuation: "Call tool_receipt_read with this receipt_event_seq starting at offset 0 to page the exact unfiltered receipt. Do not repeat the original read.",
      };
    }
    return { ok: true, deliveredResult, receipt, paged };
  }

  filterContext(text, { requestId, interactionId, source, maximumCharacters }) {
    const input = String(text ?? "");
    const selected = input.length <= maximumCharacters
      ? input
      : `${input.slice(0, Math.max(0, maximumCharacters - 20))}\n[context filtered]`;
    return {
      text: selected,
      receipt: {
        protocol,
        version: protocolVersion,
        messageId: `${requestId}:${interactionId}:context-filter`,
        requestId,
        interactionId,
        source,
        status: "complete",
        filter: { max_characters: maximumCharacters },
        summary: {
          inputCharacters: input.length,
          outputCharacters: selected.length,
          prunedCharacters: input.length - selected.length,
        },
      },
    };
  }
}
