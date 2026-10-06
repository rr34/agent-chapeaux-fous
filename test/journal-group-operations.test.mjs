import assert from "node:assert/strict";
import test from "node:test";
import {
  JournalGroupOperationError,
  renameJournalGroup,
} from "../src/journal-group-operations.mjs";
import { registerNativeCapabilities } from "../src/native-capabilities.mjs";
import { registerJournalTools } from "../src/tools/journal-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

function databaseFor(group, { conflict = null } = {}) {
  const updates = [];
  return {
    updates,
    prepare(sql) {
      if (sql.includes("SELECT * FROM journal1_groups")) {
        return { get: () => group };
      }
      if (sql.includes("SELECT journal_group_id FROM journal1_groups")) {
        return { get: () => conflict };
      }
      if (sql.includes("UPDATE journal1_groups SET name")) {
        return { run: (...values) => { updates.push(values); return { changes: 1 }; } };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test("journal groups rename by stable id and return the old and new display names", () => {
  const database = databaseFor({ journal_group_id: 12, name: "Health", archived_at_utc: null });
  const result = renameJournalGroup(database, { groupId: 12, newName: "  Wellbeing  " });

  assert.equal(result.renamed, true);
  assert.equal(result.group.id, 12);
  assert.equal(result.group.previousName, "Health");
  assert.equal(result.group.name, "Wellbeing");
  assert.equal(database.updates.length, 1);
  assert.equal(database.updates[0][0], "Wellbeing");
  assert.equal(database.updates[0][2], 12);
});

test("journal group rename preserves the permanent catchall and unique names", () => {
  assert.throws(
    () => renameJournalGroup(
      databaseFor({ journal_group_id: 1, name: "General", archived_at_utc: null }),
      { groupId: 1, newName: "Other" },
    ),
    (error) => error instanceof JournalGroupOperationError && error.statusCode === 409,
  );
  assert.throws(
    () => renameJournalGroup(
      databaseFor({ journal_group_id: 12, name: "Health", archived_at_utc: null }, { conflict: { journal_group_id: 13 } }),
      { groupId: 12, newName: "Fitness" },
    ),
    (error) => error instanceof JournalGroupOperationError && error.statusCode === 409,
  );
});

test("the journal capability publishes group rename as a stable-ID mutation", () => {
  const registry = registerNativeCapabilities(new ToolRegistry());
  registerJournalTools(registry, {}, {});
  const definition = registry.toolDefinitions()
    .find(({ name }) => name === "journal_group_rename");

  assert.deepEqual(definition.inputSchema.required, ["journal_group_id", "name"]);
  assert.equal(definition.annotations.readOnlyHint, false);
  assert.equal(definition.annotations.idempotentHint, true);
  assert.deepEqual(
    definition.metadata["agent-slayer/object-input-bindings"].bindings,
    [{ path: "/journal_group_id", objectType: "journal.group", role: "subject", value: "id" }],
  );
});
