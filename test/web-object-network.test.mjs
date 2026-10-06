import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("first-class object controls expose one lazy visual network without editing-form fields", () => {
  const component = fs.readFileSync(path.join(root, "web/src/components/ObjectNetworkButton.tsx"), "utf8");
  const references = fs.readFileSync(path.join(root, "web/src/components/AgentReferenceButton.tsx"), "utf8");
  const editor = fs.readFileSync(path.join(root, "web/src/components/EditableItems.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");

  assert.match(references, /<ObjectNetworkButton identity=\{identity\} subject=\{subject\}/u);
  assert.match(component, /className="object-network-button"/u);
  assert.match(component, /<circle cx="12" cy="12"/u);
  assert.match(component, /\/api\/object-network\?/u);
  assert.match(component, /\/api\/object-network\/connections/u);
  assert.match(component, /className="network-rail"/u);
  assert.match(component, /onOpen=\{\(\) => openObject\(object\)\}/u);
  assert.doesNotMatch(component, /relationshipKind|relationship label|Linked to/u);
  assert.match(styles, /\.network-rail::before/u);
  assert.doesNotMatch(editor, /ObjectNetworkButton|relatedContactId[^\n]*<select/u);
});

test("the HTTP adapter keeps object graph reads and exact connection mutations separate", () => {
  const server = fs.readFileSync(path.join(root, "src/server.mjs"), "utf8");
  assert.match(server, /request\.method === "GET" && url\.pathname === "\/api\/object-network"/u);
  assert.match(server, /request\.method === "POST" && url\.pathname === "\/api\/object-network\/connections"/u);
  assert.match(server, /objectNetwork\.setConnection\(await readJson\(request\)/u);
});

