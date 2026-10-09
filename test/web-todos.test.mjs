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
  assert.match(appSource, /<SectionFilter[^>]*controls=\{<>[\s\S]*className="todo-completed-filter"/);
  assert.match(styles, /\.todo-completed-filter input \{[^}]*width: 24px;[^}]*height: 24px;/);
});

test("completed to-dos sort ahead of open work with the newest completion first", () => {
  assert.match(appSource, /const todos = showCompleted \? \[\.\.\.filteredTodos\]\.sort\(compareTodoDisplayOrder\) : filteredTodos/);
  assert.match(appSource, /if \(leftComplete !== rightComplete\) return leftComplete \? -1 : 1/);
  assert.match(appSource, /rightCompletedAt > leftCompletedAt \? 1 : -1/);
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
  assert.match(appSource, /<SectionFilter[^>]*controls=\{<>\s*<SectionSelectFilter label="Group"/);
  assert.match(styles, /\.section-filter-controls/);
});

test("to-do cards use the workspace-wide Agent selection instead of a section-only batch bar", () => {
  assert.doesNotMatch(appSource, /Select all visible|Reference selected in Agent/);
  assert.match(appSource, /<TodoItem[\s\S]*?todo=\{todo\}[\s\S]*?onChanged=\{reload\}/);
  assert.match(appSource, /<ObjectSelectionProvider selections=\{agentObjectSelections\}/);
  assert.match(styles, /\.object-selection-checkbox \{[^}]*width: 17px;[^}]*height: 17px;/);
  assert.doesNotMatch(styles, /\.todo-selection-bar/);
});

test("the React to-do page pins group containers rather than individual tasks", () => {
  assert.match(appSource, /\/api\/todo-groups\/\$\{groupId\}\/daily-paper-pin/);
  assert.match(appSource, /JSON\.stringify\(\{ dailyPaperPinned \}\)/);
  assert.match(appSource, /group\.dailyPaperPinned \? "Pinned to paper" : "Pin to paper"/);
  assert.match(appSource, /for \(const group of groupData\?\.groups \|\| \[\]\)/);
  assert.match(styles, /\.todo-group-pin\.is-pinned/);
});

test("each React to-do card moves that item within its group by one step or to either end", () => {
  assert.match(appSource, /type TodoPriorityMovement = "top" \| "up" \| "down" \| "bottom"/);
  assert.match(appSource, /label: "to top priority"/);
  assert.match(appSource, /label: "up one priority"/);
  assert.match(appSource, /label: "down one priority"/);
  assert.match(appSource, /label: "to bottom priority"/);
  assert.match(appSource, /currentIndex \+ \(movement === "up" \? -1 : 1\)/);
  assert.match(appSource, /nextTodoIds\.splice\(currentIndex, 1\)/);
  assert.match(appSource, /nextTodoIds\.splice\(targetIndex, 0, todoId\)/);
  assert.match(appSource, /api\(`\/api\/todo-groups\/\$\{groupId\}\/reorder`/);
  assert.match(appSource, /JSON\.stringify\(\{ orderedTodoIds: nextTodoIds \}\)/);
  assert.match(appSource, /<TodoItem[\s\S]*cardControls=\{group\.groupId != null \? <TodoPriorityControls/);
  assert.doesNotMatch(appSource, /<TodoGroupCard[\s\S]*details=\{<div className="todo-group-management"><TodoPriorityControls/);
  assert.match(styles, /\.todo-priority-controls/);
  assert.match(styles, /\.todo-priority-button/);
});
