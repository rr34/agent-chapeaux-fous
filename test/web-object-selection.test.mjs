import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const controls = fs.readFileSync(new URL("../web/src/components/ObjectSelectionControls.tsx", import.meta.url), "utf8");
const context = fs.readFileSync(new URL("../web/src/components/ObjectSelectionContext.tsx", import.meta.url), "utf8");
const buttons = fs.readFileSync(new URL("../web/src/components/object-cards/ObjectCardButtons.tsx", import.meta.url), "utf8");
const network = fs.readFileSync(new URL("../web/src/components/ObjectNetworkButton.tsx", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");

test("every card selection stages one exact object in the shared Agent request state", () => {
  assert.match(buttons, /className="object-selection-checkbox"/);
  assert.match(buttons, /type="checkbox"/);
  assert.match(controls, /useObjectSelection\(\)/);
  assert.match(controls, /selection\.toggleSelection\(identity\)/);
  assert.match(network, /selection\.toggleSelection/);
  assert.match(context, /ObjectSelectionContext\.Provider/);
  assert.match(app, /<ObjectSelectionProvider selections=\{agentObjectSelections\} toggleSelection=\{toggleObjectSelection\}>/);
  assert.match(app, /selectionOrigin: "card"/);
  assert.doesNotMatch(app, /insertObjectMentions/);
});

test("the composer shows only the selected count and does not duplicate selected cards", () => {
  const start = app.indexOf('className="composer-selection-summary"');
  const end = app.indexOf("</div>", start);
  const summary = app.slice(start, end);
  assert.notEqual(start, -1);
  assert.match(summary, /selections\.length/);
  assert.match(summary, />Clear<\/button>/);
  assert.doesNotMatch(summary, /selections\.map|<ObjectCard|\.display|\.label/);
});

test("explicit card selections preserve exact request text while the server validates their identity tuples", () => {
  assert.match(app, /selectedObjectCandidates/);
  assert.match(app, /selectionOrigin: _selectionOrigin/);
  assert.match(server, /normalizeSelectedObjectCandidates\(body\.selectedObjectCandidates\)/);
  assert.doesNotMatch(server, /selectedObjectMentionsAreVisible/);
});
