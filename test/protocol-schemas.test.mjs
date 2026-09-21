import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const retrySchemaPath = new URL(
  "../config/protocol-schemas/retry-descriptor.v1.schema.json",
  import.meta.url,
);
const toolDescriptionSchemaPath = new URL(
  "../config/protocol-schemas/tool-description.v1.schema.json",
  import.meta.url,
);
const objectDescriptionSchemaPath = new URL(
  "../config/protocol-schemas/object-description.v1.schema.json",
  import.meta.url,
);
const firstClassObjectBindingSchemaPath = new URL(
  "../config/protocol-schemas/first-class-object-binding.v1.schema.json",
  import.meta.url,
);
const objectInputBindingsSchemaPath = new URL(
  "../config/protocol-schemas/object-input-bindings.v1.schema.json",
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

test("the manifesto publishes one authoritative layered Tool Description contract", () => {
  const schema = JSON.parse(fs.readFileSync(toolDescriptionSchemaPath, "utf8"));
  const manifesto = fs.readFileSync(manifestoPath, "utf8");

  assert.deepEqual(schema.properties.protocol.enum, ["agent-slayer.tool-description"]);
  assert.deepEqual(schema.properties.version.enum, [1]);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(new Set(schema.required), new Set([
    "protocol", "version", "summary", "actionClasses", "effectClassifications",
  ]));
  assert.equal(schema.properties.operations.properties.exhaustive.type, "boolean");
  assert.equal(schema.properties.operations.properties.entries.maxItems, 40);
  assert.match(manifesto, /3A\. The Tool Description contract/);
  assert.match(manifesto, /config\/protocol-schemas\/tool-description\.v1\.schema\.json/);
  assert.match(manifesto, /_meta\["agent-slayer\/selection"\]/);
  assert.match(manifesto, /`operations\.exhaustive=true`/);
});

test("the manifesto publishes a versioned remote Object Description and provider test obligation", () => {
  const schema = JSON.parse(fs.readFileSync(objectDescriptionSchemaPath, "utf8"));
  const manifesto = fs.readFileSync(manifestoPath, "utf8");
  assert.equal(schema.properties.protocol.const, "agent-slayer.object-description");
  assert.equal(schema.properties.version.const, 1);
  assert.deepEqual(new Set(schema.required), new Set(["protocol", "version", "types"]));
  assert.equal(schema.properties.types.items.required.includes("identity"), true);
  assert.equal(schema.additionalProperties, false);
  assert.match(manifesto, /config\/protocol-schemas\/object-description\.v1\.schema\.json/);
  assert.match(manifesto, /_meta\["agent-slayer\/objects"\]/);
  assert.match(manifesto, /Each owned provider keeps contract tests beside its implementation/);
  assert.match(manifesto, /provider-native identity fields/);
});

test("the identity protocol centers producer and consumer contracts on one canonical runtime binding", () => {
  const binding = JSON.parse(fs.readFileSync(firstClassObjectBindingSchemaPath, "utf8"));
  const producer = JSON.parse(fs.readFileSync(objectDescriptionSchemaPath, "utf8"));
  const consumer = JSON.parse(fs.readFileSync(objectInputBindingsSchemaPath, "utf8"));
  const manifesto = fs.readFileSync(manifestoPath, "utf8");

  assert.equal(
    binding.$id,
    "https://agent-slayer.local/schemas/first-class-object-binding.v1.schema.json",
  );
  assert.deepEqual(new Set(binding.required), new Set([
    "mention", "type", "source", "objects", "sourceEventSeqs",
  ]));
  assert.deepEqual(
    new Set(binding.$defs.objectIdentity.required),
    new Set(["id", "ref", "display"]),
  );
  assert.equal(binding.properties.objects.minItems, 1);
  assert.equal(binding.properties.sourceEventSeqs.minItems, 1);
  assert.match(producer.description, /first-class-object-binding\.v1\.schema\.json/);
  assert.match(consumer.description, /first-class-object-binding\.v1\.schema\.json/);
  assert.match(manifesto, /producer, instance, and\s+consumer shapes/);
  assert.match(
    manifesto,
    /config\/protocol-schemas\/first-class-object-binding\.v1\.schema\.json/,
  );
});

test("the manifesto publishes provider-owned first-class object input bindings", () => {
  const schema = JSON.parse(fs.readFileSync(objectInputBindingsSchemaPath, "utf8"));
  const manifesto = fs.readFileSync(manifestoPath, "utf8");
  assert.equal(schema.properties.protocol.const, "agent-slayer.object-input-bindings");
  assert.equal(schema.properties.version.const, 1);
  assert.deepEqual(new Set(schema.required), new Set(["protocol", "version", "bindings"]));
  assert.deepEqual(schema.properties.bindings.items.properties.value.enum, ["id", "ref"]);
  assert.match(manifesto, /2A\.2\. Object-input binding contract/);
  assert.match(manifesto, /never guesses it from names such as/);
  assert.match(manifesto, /cannot reach the tool/);
});
