import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

test("the React library renders content as grouped list rows", () => {
  const start = appSource.indexOf("function LibraryScreen");
  const end = appSource.indexOf("\nfunction GenericScreen", start);
  const librarySource = appSource.slice(start, end);

  assert.notEqual(start, -1, "LibraryScreen exists");
  assert.match(librarySource, /useApi<\{ groups: Entity\[\] \}>\("\/api\/content-groups"\)/);
  assert.match(librarySource, /readKey\(item, "groupId"\)/);
  assert.match(librarySource, /<ul className="library-list">/);
  assert.match(librarySource, /<li className="library-row"/);
  assert.match(appSource, /view === "content"\) screen = <LibraryScreen/);
  assert.match(styles, /\.library-groups/);
  assert.match(styles, /\.library-row/);
});
