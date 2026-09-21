import assert from "node:assert/strict";
import test from "node:test";
import { OrganizerStore } from "../src/organizer-store.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("native typing search reads contacts, tags, tasks, and the Journal hierarchy from their rows", (context) => {
  const temporary = temporaryDatabase();
  context.after(temporary.cleanup);
  const organizer = new OrganizerStore(temporary.target);
  context.after(() => organizer.close());
  const database = organizer.database;

  const contactId = Number(database.prepare(`INSERT INTO contacts
    (display_name, given_name, family_name) VALUES ('Lucas Ruffing', 'Lucas', 'Ruffing')`)
    .run().lastInsertRowid);
  const tagId = Number(database.prepare("INSERT INTO tags (slug, label) VALUES ('family', 'Family')")
    .run().lastInsertRowid);
  database.prepare(`INSERT INTO contacts_tags_join (tag_id, record_type, record_id)
    VALUES (?, 'contact', ?)`).run(tagId, String(contactId));
  const todoGroup = database.prepare("SELECT todo_group_id FROM todo_groups WHERE name = 'Watches'").get();
  const todoId = Number(database.prepare(`INSERT INTO todo_personal
    (todo_group_id, related_contact_id, text) VALUES (?, ?, 'Call Lucas about watches')`)
    .run(todoGroup.todo_group_id, contactId).lastInsertRowid);

  const journalGroupId = Number(database.prepare("INSERT INTO journal1_groups (name) VALUES ('Exercise')")
    .run().lastInsertRowid);
  const trackerId = Number(database.prepare(`INSERT INTO journal2_trackers
    (journal_group_id, name, unit) VALUES (?, 'Push-ups', 'reps')`)
    .run(journalGroupId).lastInsertRowid);
  const entryId = Number(database.prepare(`INSERT INTO journal3_entries
    (tracker_id, occurred_at_utc, content_text, number_value)
    VALUES (?, '2026-09-15 12:00:00.000', 'Did 30 push-ups', 30)`)
    .run(trackerId).lastInsertRowid);

  const contacts = organizer.searchNativeObjects({ query: "Lucas Ruffing" }).objects;
  assert.equal(contacts[0].ref, `agent-slayer://contacts/${contactId}`);
  assert.deepEqual(contacts[0].related.map(({ ref }) => ref), [`agent-slayer://todos/${todoId}`]);
  assert.equal(organizer.searchNativeObjects({ query: "Family" }).objects[0].ref, `agent-slayer://contacts/${contactId}`);

  const groups = organizer.searchNativeObjects({ query: "Exercise log items" }).objects;
  assert.equal(groups[0].ref, `journal1_groups:${journalGroupId}`);
  assert.deepEqual(groups[0].related.map(({ ref }) => ref), [`journal2_trackers:${trackerId}`]);
  const trackers = organizer.searchNativeObjects({ query: "Push ups" }).objects;
  assert.equal(trackers[0].ref, `journal2_trackers:${trackerId}`);
  assert.ok(trackers[0].related.some(({ ref }) => ref === `journal3_entries:${entryId}`));
  assert.equal(organizer.searchNativeObjects({ query: "Did 30 push-ups" }).objects[0].ref,
    `journal3_entries:${entryId}`);
});
