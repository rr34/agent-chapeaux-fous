import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

test("the React to-do page starts with open tasks and opts into completed tasks", () => {
  assert.match(appSource, /const \[showCompleted, setShowCompleted\] = useState\(false\)/);
  assert.match(appSource, /const scope = showCompleted \? "all" : "active"/);
  assert.match(appSource, /todo\.status === "todo" \|\| todo\.status === "ai_suggested" \|\| \(showCompleted && todo\.status === "complete"\)/);
  assert.match(appSource, />Show completed<\/label>/);
});

test("the React to-do page renders tasks in their stored groups", () => {
  assert.match(appSource, /const grouped = new Map/);
  assert.match(appSource, /readKey\(todo, "groupId"\)/);
  assert.match(appSource, /groups\.map\(\(group\) => <section className="todo-group"/);
  assert.match(appSource, /\{group\.name\}<\/h2>/);
  assert.match(styles, /\.todo-group-heading/);
  assert.match(styles, /\.todo-group-items/);
});
