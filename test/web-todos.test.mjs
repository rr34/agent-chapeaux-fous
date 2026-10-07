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
  assert.match(appSource, /groups\.map\(\(group\) => \{/);
  assert.match(appSource, /return <section className="todo-group"/);
  assert.match(appSource, /\{group\.name\}<\/h2>/);
  assert.match(styles, /\.todo-group-heading/);
  assert.match(styles, /\.todo-group-items/);
});

test("the React to-do page can filter its visible tasks by group", () => {
  assert.match(appSource, /const \[selectedGroupId, setSelectedGroupId\] = useState\("all"\)/);
  assert.match(appSource, /useApi<\{ groups: Entity\[\] \}>\("\/api\/todo-groups"\)/);
  assert.match(appSource, /selectedGroupId === "all"/);
  assert.match(appSource, /<option value="all">All groups<\/option>/);
  assert.match(appSource, /<SectionFilter[^>]*controls=\{<SectionSelectFilter label="Group"/);
  assert.match(styles, /\.section-filter-controls/);
});

test("the React to-do page pins group containers rather than individual tasks", () => {
  assert.match(appSource, /\/api\/todo-groups\/\$\{groupId\}\/daily-paper-pin/);
  assert.match(appSource, /JSON\.stringify\(\{ dailyPaperPinned \}\)/);
  assert.match(appSource, /group\.dailyPaperPinned \? "Pinned to paper" : "Pin to paper"/);
  assert.match(appSource, /for \(const group of groupData\?\.groups \|\| \[\]\)/);
  assert.match(styles, /\.todo-group-pin\.is-pinned/);
});

test("the React to-do page moves group priority by one step or to either end", () => {
  assert.match(appSource, /type TodoGroupPriorityMovement = "top" \| "up" \| "down" \| "bottom"/);
  assert.match(appSource, /label: "to top priority"/);
  assert.match(appSource, /label: "up one priority"/);
  assert.match(appSource, /label: "down one priority"/);
  assert.match(appSource, /label: "to bottom priority"/);
  assert.match(appSource, /currentIndex \+ \(movement === "up" \? -1 : 1\)/);
  assert.match(appSource, /nextGroupIds\.splice\(currentIndex, 1\)/);
  assert.match(appSource, /nextGroupIds\.splice\(targetIndex, 0, groupId\)/);
  assert.match(appSource, /api\("\/api\/todo-groups\/reorder"/);
  assert.match(appSource, /JSON\.stringify\(\{ orderedGroupIds: nextGroupIds \}\)/);
  assert.match(styles, /\.todo-group-priority-controls/);
  assert.match(styles, /\.todo-group-priority-button/);
});
