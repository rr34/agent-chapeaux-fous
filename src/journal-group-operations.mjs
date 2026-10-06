export class JournalGroupOperationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "JournalGroupOperationError";
    this.statusCode = statusCode;
  }
}

export function renameJournalGroup(database, { groupId, newName } = {}) {
  const id = Number(groupId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new JournalGroupOperationError("Journal group id must be a positive integer.");
  }
  const group = database.prepare(`
    SELECT * FROM journal1_groups
    WHERE journal_group_id = ? AND archived_at_utc IS NULL
  `).get(id);
  if (!group) throw new JournalGroupOperationError("Journal group not found.", 404);
  if (group.name.toLowerCase() === "general") {
    throw new JournalGroupOperationError("General is the permanent catchall and cannot be renamed.", 409);
  }

  const name = typeof newName === "string" ? newName.trim() : "";
  if (!name) throw new JournalGroupOperationError("A new group name is required.");
  if (name.length > 200) throw new JournalGroupOperationError("A group name cannot exceed 200 characters.");
  const conflict = database.prepare(`
    SELECT journal_group_id FROM journal1_groups
    WHERE name = ? AND journal_group_id <> ?
  `).get(name, id);
  if (conflict) throw new JournalGroupOperationError("A journal group with that name already exists.", 409);

  const updatedAtUtc = new Date().toISOString();
  const renamed = database.prepare(`
    UPDATE journal1_groups SET name = ?, updated_at_utc = ?
    WHERE journal_group_id = ? AND archived_at_utc IS NULL
  `).run(name, updatedAtUtc, id);
  if (renamed.changes !== 1) {
    throw new JournalGroupOperationError("Journal group could not be renamed.", 409);
  }
  return {
    renamed: true,
    group: {
      id,
      name,
      previousName: group.name,
      archivedAtUtc: null,
      updatedAtUtc,
    },
  };
}
