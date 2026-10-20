import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const editableItemsSource = fs.readFileSync(new URL("../web/src/components/EditableItems.tsx", import.meta.url), "utf8");
const libraryCardSource = fs.readFileSync(new URL("../web/src/components/object-cards/LibraryItemCard.tsx", import.meta.url), "utf8");
const sequenceOrderSource = fs.readFileSync(new URL("../web/src/sequence-order.ts", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

test("the React library renders content as grouped list rows", () => {
  const start = appSource.indexOf("function LibraryScreen");
  const end = appSource.indexOf("\nfunction GenericScreen", start);
  const librarySource = appSource.slice(start, end);

  assert.notEqual(start, -1, "LibraryScreen exists");
  assert.match(librarySource, /useApi<\{ groups: Entity\[\] \}>\("\/api\/content-groups"\)/);
  assert.match(librarySource, /readKey\(item, "groupId"\)/);
  assert.match(librarySource, /<ul className="library-list">/);
  assert.match(librarySource, /<LibraryItemCard\s+as="li"/);
  assert.match(librarySource, /type: "video\.content_item"/);
  assert.match(appSource, /view === "content"\) screen = <LibraryScreen/);
  assert.match(styles, /\.library-groups/);
  assert.match(styles, /\.library-list/);
  assert.match(styles, /\.object-card-sequence/);
  assert.doesNotMatch(styles, /\.library-row|\.library-sequence/);
  assert.match(styles, /\.first-class-object-card/);
});

test("the React library creates and edits content with the shared modal and card action", () => {
  const start = appSource.indexOf("function LibraryScreen");
  const end = appSource.indexOf("\nfunction VideoScriptsScreen", start);
  const librarySource = appSource.slice(start, end);

  assert.match(librarySource, /onClick=\{\(\) => setAddingContent\(true\)\}>Add content<\/button>/);
  assert.match(librarySource, /onEdit=\{\(\) => setEditingContent\(entity\)\}/);
  assert.match(librarySource, /\{addingContent && <LibraryContentEditor/);
  assert.match(librarySource, /\{editingContent && <LibraryContentEditor content=\{editingContent\}/);
  assert.match(libraryCardSource, /props\.onEdit[\s\S]*label: "Edit"/);
  assert.match(editableItemsSource, /export function LibraryContentEditor/);
  assert.match(editableItemsSource, /creating \? "\/api\/content-items" : `\/api\/content-items\/\$\{Number\(content\.id\)\}`/);
  assert.match(editableItemsSource, /method: creating \? "POST" : "PATCH"/);
  assert.match(editableItemsSource, /version: String\(content\.version \|\| ""\)/);
  assert.match(editableItemsSource, /creating \? "Add content" : "Save content"/);
});

test("to-do and Library groups share descending numbered-item display order", () => {
  assert.match(sequenceOrderSource, /if \(left === null \|\| right === null\)/);
  assert.match(sequenceOrderSource, /return left === null \? 1 : -1/);
  assert.match(sequenceOrderSource, /return right - left/);
  assert.match(appSource, /const todos = \[\.\.\.filteredTodos\]\.sort\(compareTodoDisplayOrder\)/);
  assert.match(appSource, /group\.items\.sort\(\(left, right\) => compareSequenceValuesDescending/);
});
