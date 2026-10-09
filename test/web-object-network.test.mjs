import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("first-class object controls expose one lazy visual network without editing-form fields", () => {
  const component = fs.readFileSync(path.join(root, "web/src/components/ObjectNetworkButton.tsx"), "utf8");
  const references = fs.readFileSync(path.join(root, "web/src/components/ObjectSelectionControls.tsx"), "utf8");
  const editor = fs.readFileSync(path.join(root, "web/src/components/EditableItems.tsx"), "utf8");
  const dispatcher = fs.readFileSync(path.join(root, "web/src/components/object-cards/ObjectCard.tsx"), "utf8");
  const buttons = fs.readFileSync(path.join(root, "web/src/components/object-cards/ObjectCardButtons.tsx"), "utf8");
  const icons = fs.readFileSync(path.join(root, "web/src/components/object-cards/ObjectCardIcons.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(root, "web/src/styles.css"), "utf8");

  assert.match(references, /<ObjectNetworkButton identity=\{identity\} subject=\{subject\}/u);
  assert.match(references, /<ObjectCardSelectionCheckbox/u);
  assert.match(buttons, /className="object-network-button"/u);
  assert.match(icons, /<circle cx="12" cy="12"/u);
  assert.match(component, /\/api\/object-network\?/u);
  assert.match(component, /\/api\/object-network\/connections/u);
  assert.match(component, /className="network-rail"/u);
  assert.match(component, /<NetworkCard\s+object=\{graph\.focus\}\s+focus/u);
  assert.doesNotMatch(component, /<h2>Object network<\/h2>/u);
  assert.match(component, /<ObjectCard/u);
  assert.match(component, /NetworkObjectControls/u);
  assert.match(component, /selection\.toggleSelection/u);
  assert.match(component, /<ObjectCardNetworkButton/u);
  assert.doesNotMatch(component, /network-object-open|network-card-action/u);
  assert.match(component, /Open network for \$\{object\.display\}/u);
  assert.match(dispatcher, /case "todos\.personal_task": return <TodoCard/u);
  assert.match(dispatcher, /case "contacts\.contact": return <ContactCard/u);
  assert.match(component, /<ContactEditor contactId=\{object\.id\}/u);
  assert.match(component, /<TodoEditor todoId=\{object\.id\}/u);
  assert.match(component, /await toggleTodoCompletion\(object\.id\)/u);
  assert.match(component, /onOpen=\{\(\) => openObject\(object\)\}/u);
  assert.match(component, /parameters\.append\("domainType", domainType\)/u);
  assert.doesNotMatch(component, /relationshipKind|relationship label|Linked to/u);
  assert.match(styles, /\.network-rail::before/u);
  assert.match(styles, /\.network-heading-object \.network-object-slot/u);
  assert.match(styles, /\.compact-object-card/u);
  assert.doesNotMatch(styles, /\.network-object-open|\.network-card-action/u);
  assert.doesNotMatch(editor, /ObjectNetworkButton|relatedContactId[^\n]*<select/u);
});

test("the HTTP adapter keeps object graph reads and exact connection mutations separate", () => {
  const server = fs.readFileSync(path.join(root, "src/server.mjs"), "utf8");
  assert.match(server, /request\.method === "GET" && url\.pathname === "\/api\/object-network"/u);
  assert.match(server, /request\.method === "POST" && url\.pathname === "\/api\/object-network\/connections"/u);
  assert.match(server, /objectNetwork\.setConnection\(await readJson\(request\)/u);
  assert.match(server, /url\.searchParams\.getAll\("domainType"\)/u);
});
