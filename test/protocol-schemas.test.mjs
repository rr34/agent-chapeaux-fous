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
const capabilityManifestSchemaPath = new URL(
  "../config/protocol-schemas/capability-manifest.v1.schema.json",
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
const referenceSetSchemaPath = new URL(
  "../config/protocol-schemas/reference-set.v1.schema.json",
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

test("native lifecycle completeness is resource-centric and schema constrained", () => {
  const schema = JSON.parse(fs.readFileSync(capabilityManifestSchemaPath, "utf8"));
  const manifesto = fs.readFileSync(manifestoPath, "utf8");
  const resource = schema.$defs.resource;
  assert.deepEqual(resource.properties.kind.enum, ["object", "relationship"]);
  assert.deepEqual(resource.properties.management.enum, ["user", "system", "provider"]);
  assert.deepEqual(Object.keys(resource.properties.operations.properties), [
    "create", "read", "update", "delete", "link", "unlink",
  ]);
  assert.deepEqual(schema.$defs.resourceBatch.properties.mode.enum, [
    "array", "collection", "singleton",
  ]);
  assert.deepEqual(schema.$defs.resourceOperation.oneOf[1].properties.unavailable.enum, [
    "unsupported", "unimplemented",
  ]);
  assert.match(manifesto, /resource-centric and must remain resource-centric/);
  assert.match(manifesto, /Data operability contract/);
  for (const responsibility of [
    "Discover", "Search", "Identify", "Read", "Create, read, update, and delete or archive",
    "Relate", "Operate in batches", "Preserve correctness", "Explain outcomes",
    "Represent lifecycle semantics", "Work at scale", "Remain auditable",
    "Stay consistent across surfaces", "Describe the contract mechanically",
  ]) {
    assert.match(manifesto, new RegExp(`\\*\\*${responsibility.replaceAll("*", "\\*")}\\*\\*`, "u"));
  }
  assert.match(manifesto, /Agent Slayer-owned MCPs publish the same facts/);
  assert.match(manifesto, /Every physical native join table is declared\s+exactly once/);
  assert.match(manifesto, /every local first-class object type has one global-search provider owner/);
  assert.match(manifesto, /compiled output\s+rather than an independent handwritten\s+inventory/);
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
  assert.equal(binding.properties.role.default, "subject");
  assert.equal(binding.properties.sourceEventSeqs.minItems, 1);
  assert.match(producer.description, /first-class-object-binding\.v1\.schema\.json/);
  assert.match(consumer.description, /first-class-object-binding\.v1\.schema\.json/);
  assert.match(manifesto, /producer, instance, and\s+consumer shapes/);
  assert.match(
    manifesto,
    /config\/protocol-schemas\/first-class-object-binding\.v1\.schema\.json/,
  );
});

test("the manifesto publishes domain-owned first-class object input bindings", () => {
  const schema = JSON.parse(fs.readFileSync(objectInputBindingsSchemaPath, "utf8"));
  const manifesto = fs.readFileSync(manifestoPath, "utf8");
  assert.equal(schema.properties.protocol.const, "agent-slayer.object-input-bindings");
  assert.equal(schema.properties.version.const, 1);
  assert.deepEqual(new Set(schema.required), new Set(["protocol", "version", "bindings"]));
  assert.deepEqual(schema.properties.bindings.items.properties.value.enum, ["id", "ref"]);
  assert.equal(schema.properties.bindings.items.properties.role.default, "subject");
  assert.match(manifesto, /2A\.2\. Object-input binding contract/);
  assert.match(manifesto, /never guesses it at runtime from names such as/);
  assert.match(manifesto, /cannot reach the tool/);
});

test("the manifesto publishes exact object and directed relationship sets", () => {
  const schema = JSON.parse(fs.readFileSync(referenceSetSchemaPath, "utf8"));
  const manifesto = fs.readFileSync(manifestoPath, "utf8");
  assert.equal(schema.oneOf[0].properties.protocol.const, "agent-slayer.reference-set");
  assert.equal(schema.oneOf[0].properties.kind.const, "object_set");
  assert.equal(schema.oneOf[1].properties.kind.const, "relationship_set");
  assert.deepEqual(
    new Set(schema.oneOf[1].properties.edges.items.required),
    new Set(["fromRef", "toRef"]),
  );
  assert.match(manifesto, /2A\.3\. Object and relationship set contract/);
  assert.match(manifesto, /config\/protocol-schemas\/reference-set\.v1\.schema\.json/);
  assert.match(manifesto, /must never be represented as two lists/);
});
