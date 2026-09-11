import assert from "node:assert/strict";
import test from "node:test";
import { ToolRegistry, schemaProblem } from "../src/tools/registry.mjs";
import { registerTodoTools } from "../src/tools/todo-tools.mjs";
import { ResultFilterBoundary } from "../src/search/result-filter.mjs";

const query = overrides => ({ query_id: "tasks", group: null, status: null, limit: 2, ...overrides });
const day = date => ({ start_date: date, end_date: date });
const task = (id, overrides = {}) => ({
  personal_task_id: id, todo_group_id: 1, group_name: "Inbox", status: "todo",
  sequence: null, sort_position: 100, text: `Task ${id}`, ...overrides,
});

function fixture(pages = []) {
  const reads = [];
  const database = { prepare(sql) {
    return { all(...parameters) { reads.push({ sql, parameters }); return pages.shift() ?? []; } };
  } };
  const registry = new ToolRegistry();
  registerTodoTools(registry, { requireReady: () => database }, {});
  return { registry, reads, execute: queries => registry.execute("todo_list", { queries }) };
}

test("todo_list accepts only bounded query batches and validates the full batch before reading", async () => {
  const { registry, execute, reads } = fixture();
  await assert.rejects(registry.execute("todo_list", { group: null, status: null, limit: 2 }), /queries is required/);
  await assert.rejects(execute([]), /too few/);
  await assert.rejects(execute(Array.from({ length: 21 }, (_, i) => query({ query_id: String(i) }))), /too many/);
  await assert.rejects(execute([query({}), query({})]), /unique query_id/);
  await assert.rejects(execute([query({ personal_task_ids: [65, 65] })]), /unique items/);
  await assert.rejects(execute([query({ limit: 201 })]), /at most 200/);
  for (const invalid of [
    { scheduled_date_range: day("2026-02-30"), time_zone: "America/New_York" },
    { scheduled_date_range: { start_date: "2026-09-20", end_date: "2026-09-14" }, time_zone: "America/New_York" },
    { completed_date_range: day("2026-09-14"), time_zone: null },
    { completed_date_range: day("2026-09-14"), time_zone: "not-a-zone" },
    { cursor: "not-a-cursor" },
  ]) {
    await assert.rejects(execute([query({ query_id: "valid" }), query(invalid)]));
  }
  assert.equal(reads.length, 0);
});

test("batched local ranges use inclusive dates and exclusive UTC ends across DST", async () => {
  const { execute, reads } = fixture();
  const result = await execute([
    query({ query_id: "spring", scheduled_date_range: { start_date: "2026-03-07", end_date: "2026-03-09" }, time_zone: "America/New_York" }),
    query({ query_id: "fall", completed_date_range: day("2026-11-01"), time_zone: "America/New_York" }),
  ]);
  assert.deepEqual(reads[0].parameters, ["2026-03-07T05:00:00.000Z", "2026-03-10T04:00:00.000Z", 3]);
  assert.deepEqual(reads[1].parameters, ["2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z", 3]);
  assert.match(reads[0].sql, /task.scheduled_at_utc >= \? AND task.scheduled_at_utc < \?/);
  assert.match(reads[0].sql, /status NOT IN/);
  assert.doesNotMatch(reads[1].sql, /status NOT IN/);
  assert.deepEqual(result.results.map(page => [page.query_id, page.count, page.has_more, page.next_cursor]), [
    ["spring", 0, false, null], ["fall", 0, false, null],
  ]);
  assert.equal(result.has_more, false);
});

test("ID lookups include terminal records and combine explicit filters before paging", async () => {
  const { execute, reads } = fixture([[task(65, { status: "archive" })]]);
  const result = await execute([query({ personal_task_ids: [65] })]);
  assert.equal(result.results[0].tasks[0].personal_task_id, 65);
  assert.equal(result.results[0].tasks[0].status, "archive");
  assert.match(reads[0].sql, /task.personal_task_id IN \(\?\)/);
  assert.doesNotMatch(reads[0].sql, /status NOT IN/);
  assert.deepEqual(reads[0].parameters, [65, 3]);
  await execute([query({ group: " Development ", status: "complete", personal_task_ids: [70, 65] })]);
  assert.deepEqual(reads[1].parameters, ["Development", "complete", 65, 70, 3]);
});

test("each page retains whole records and resumes after its last returned sort key", async () => {
  const { execute, reads, registry } = fixture([
    [task(1), task(2), task(3)], [task(3), task(4)],
  ]);
  const first = await execute([query({})]);
  const page = first.results[0];
  assert.deepEqual(page.tasks.map(task => task.personal_task_id), [1, 2]);
  assert.equal(first.has_more, true);
  assert.equal(page.has_more, true);
  const cursor = JSON.parse(Buffer.from(page.next_cursor, "base64url"));
  assert.deepEqual(cursor.keys, ["Inbox", 1, 0, 100, 2]);
  const second = await execute([query({ cursor: page.next_cursor })]);
  assert.deepEqual(second.results[0].tasks.map(task => task.personal_task_id), [3, 4]);
  assert.equal(second.has_more, false);
  assert.equal(second.results[0].next_cursor, null);
  assert.match(reads[1].sql, /COALESCE\(task.sequence, 0\) < \?/);
  assert.match(reads[1].sql, /task.personal_task_id > \?/);
  assert.doesNotMatch(reads[1].sql, /OFFSET/);
  assert.equal(schemaProblem(first, registry.get("todo_list").outputSchema), null);
  await assert.rejects(execute([query({ cursor: page.next_cursor, group: "Development" })]), /Invalid cursor/);
  assert.equal(reads.length, 2);
});

test("completion and scheduled pages preserve timestamp tie-breakers in both directions", async () => {
  for (const [range, column, operator] of [
    ["completed_date_range", "completed_at_utc", "<"],
    ["scheduled_date_range", "scheduled_at_utc", ">"],
  ]) {
    const timestamp = "2026-09-14T17:00:00.000Z";
    const { execute, reads } = fixture([[task(65, { [column]: timestamp }), task(66, { [column]: timestamp })]]);
    const selected = query({ limit: 1, [range]: day("2026-09-14"), time_zone: "America/New_York" });
    const first = await execute([selected]);
    await execute([{ ...selected, cursor: first.results[0].next_cursor }]);
    assert.ok(reads[1].sql.includes(`task.${column} ${operator} ?`));
    assert.ok(reads[1].sql.includes(`task.personal_task_id ${operator} ?`));
    assert.deepEqual(reads[1].parameters.slice(-4), [timestamp, timestamp, 65, 2]);
  }
});

test("oversized query pages use the existing exact receipt pager instead of truncating records", async () => {
  const { execute } = fixture([[task(65, { text: "Full task text ".repeat(200) }), task(66)]]);
  const result = await execute([query({ limit: 1 })]);
  const filtered = new ResultFilterBoundary().filterReadResult(result, {
    tool: "todo_list", requestId: "test", interactionId: "read", receiptEventSeq: 42,
    filterRequest: { collection_path: null, query: null, match_mode: "all_terms",
      include_fields: [], exclude_fields: [], max_items: 20, max_characters: 1000 },
  });
  assert.equal(filtered.ok, true);
  assert.equal(filtered.paged, true);
  assert.equal(filtered.deliveredResult.receipt_event_seq, 42);
  assert.equal(filtered.deliveredResult.full_result_stored_in_receipt, true);
  assert.equal(result.results[0].tasks[0].text, "Full task text ".repeat(200));
  assert.ok(result.results[0].next_cursor);
});
