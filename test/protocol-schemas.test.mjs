import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const retrySchemaPath = new URL(
  "../config/protocol-schemas/retry-descriptor.v1.schema.json",
  import.meta.url,
);
const manifestoPath = new URL("../AGENT-TOOL-MANIFESTO.md", import.meta.url);

test("the manifesto references one authoritative versioned retry descriptor", () => {
  const schema = JSON.parse(fs.readFileSync(retrySchemaPath, "utf8"));
  const manifesto = fs.readFileSync(manifestoPath, "utf8");

  assert.deepEqual(schema.properties.protocol.enum, ["agent-slayer.retry-descriptor"]);
  assert.deepEqual(schema.properties.version.enum, [1]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(new Set(schema.required), new Set([
    "protocol",
    "version",
    "retryable",
    "reason_code",
    "requires_new_client_request_id",
    "preserve_complete_original_batch",
    "retry_after_ms",
  ]));
  assert.match(
    schema.properties.requires_new_client_request_id.description,
    /must reuse its existing provider-defined client request or idempotency ID/,
  );
  assert.match(
    schema.properties.requires_new_client_request_id.description,
    /must not be reused/,
  );
  assert.match(
    manifesto,
    /single authoritative, versioned schema at\s+`config\/protocol-schemas\/retry-descriptor\.v1\.schema\.json`/,
  );
  assert.match(manifesto, /[Ii]t\s+never refers to the Agent Slayer request ID/);
  assert.match(manifesto, /a `true`\s+value is unsupported and must not be guessed around/);
});
