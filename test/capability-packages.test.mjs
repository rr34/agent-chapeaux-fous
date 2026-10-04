import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  defaultCapabilityPackagesRoot,
  loadCapabilityPackages,
  validateRegisteredCapabilities,
} from "../src/capability-packages.mjs";
import { registerNativeCapabilities } from "../src/native-capabilities.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerWebPageTools } from "../src/tools/web-page-tools.mjs";

const ids = [
  "calendar", "catch-up", "contacts", "daily-paper", "database", "database-write",
  "email", "files", "history", "interaction-guides", "journal", "profile", "search",
  "self", "todos", "video", "web",
];

async function temporaryPackage(context, transform = value => value) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-slayer-capability-"));
  context.after(() => fsp.rm(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, "example");
  await fsp.mkdir(packageRoot);
  const manifest = transform({
    $schema: "../../protocol-schemas/capability-manifest.v1.schema.json",
    protocol: "agent-slayer.capability",
    version: 1,
    id: "example",
    title: "Example capability",
    summary: "A fixture capability.",
    aliases: ["example"],
    guidance: "guidance.md",
  });
  await fsp.writeFile(path.join(packageRoot, "capability.json"), `${JSON.stringify(manifest)}\n`);
  await fsp.writeFile(path.join(packageRoot, "guidance.md"), "Use the example tool.\n");
  return { root, packageRoot };
}

test("native capability packages are the complete schema-validated runtime catalog", async () => {
  const manifests = loadCapabilityPackages();
  assert.deepEqual(manifests.map(({ id }) => id), ids);
  for (const manifest of manifests) {
    assert.equal(manifest.protocol, "agent-slayer.capability");
    assert.equal(manifest.version, 1);
    assert.equal(manifest.guidanceFile, "guidance.md");
    assert.ok(manifest.guidance.length > 0);
    assert.equal(manifest.instructionFile, undefined);
    const entries = (await fsp.readdir(path.join(defaultCapabilityPackagesRoot, manifest.id))).sort();
    assert.deepEqual(entries, ["capability.json", "guidance.md"]);
  }
});

test("capability package validation rejects schema, identity, and filesystem drift", async context => {
  const invalidId = await temporaryPackage(context, manifest => ({ ...manifest, id: "different" }));
  assert.throws(() => loadCapabilityPackages({ capabilityRoot: invalidId.root }), /directory example must match manifest ID different/);

  const extra = await temporaryPackage(context);
  await fsp.writeFile(path.join(extra.packageRoot, "parallel-guidance.md"), "drift\n");
  assert.throws(() => loadCapabilityPackages({ capabilityRoot: extra.root }), /unexpected entry: parallel-guidance\.md/);

  const duplicateAlias = await temporaryPackage(context, manifest => ({ ...manifest, aliases: ["Example", "example"] }));
  assert.throws(() => loadCapabilityPackages({ capabilityRoot: duplicateAlias.root }), /case-insensitively unique/);
});

test("registered native tools must use declared capabilities and agree with read-only expectations", () => {
  const manifests = loadCapabilityPackages();
  assert.throws(() => validateRegisteredCapabilities(manifests, [{
    name: "orphan_tool", source: "local", capabilityId: "orphan", annotations: { readOnlyHint: true },
  }]), /undeclared native capability orphan/);
  assert.throws(() => validateRegisteredCapabilities(manifests, [{
    name: "web_page_read", source: "local", capabilityId: "web", annotations: { readOnlyHint: false },
  }]), /web\.readOnlyTools conflicts with web_page_read annotations/);
  assert.throws(() => validateRegisteredCapabilities(manifests, [{
    name: "calendar_event_update", source: "local", capabilityId: "catch-up",
  }]), /catch-up\.dependentTools names same-capability tool calendar_event_update/);
});

test("package guidance and filenames never leak into model-visible tool definitions", () => {
  const registry = registerNativeCapabilities(new ToolRegistry());
  registerWebPageTools(registry, { read: async () => ({}) });
  const definition = registry.toolDefinitions().find(({ name }) => name === "web_page_read");
  assert.equal(definition.capability.id, "web");
  assert.equal(definition.capability.guidance, undefined);
  assert.equal(definition.capability.guidanceFile, undefined);
  assert.match(definition.metadata["agent-slayer/selection"].summary, /user-supplied/);
});
