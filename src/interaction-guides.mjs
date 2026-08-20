const guideStatuses = new Set(["active", "archived"]);

function identifier(value, label = "Interaction guide ID") {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be a positive integer`);
  return result;
}

function requiredText(value, label, maximum) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} cannot be empty`);
  if (result.length > maximum) throw new Error(`${label} cannot exceed ${maximum} characters`);
  return result;
}

function publicGuide(row, { includeText = true } = {}) {
  if (!row) return null;
  return {
    id: Number(row.interaction_guide_id),
    name: row.name,
    ...(includeText ? { guideText: row.guide_text } : {}),
    status: row.status,
    version: Number(row.version),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

function conflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

export class InteractionGuides {
  constructor({ store, ledger }) {
    this.store = store;
    this.ledger = ledger;
  }

  list({ status = "active", limit = 200 } = {}) {
    if (status !== "all" && !guideStatuses.has(status)) {
      throw new Error(`Unknown interaction guide status: ${status}`);
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Interaction guide limit must be an integer from 1 through 500");
    }
    const rows = this.store.requireReady().prepare(`
      SELECT interaction_guide_id, name, status, version, created_at_utc, updated_at_utc
      FROM interaction_guides
      ${status === "all" ? "" : "WHERE status = ?"}
      ORDER BY name COLLATE NOCASE, interaction_guide_id
      LIMIT ?
    `).all(...(status === "all" ? [limit] : [status, limit]));
    return { status, count: rows.length, guides: rows.map((row) => publicGuide(row, { includeText: false })) };
  }

  get({ guideId = null, name = null } = {}) {
    const hasId = guideId !== null && guideId !== undefined;
    const selectedName = name == null ? null : String(name).trim();
    if (hasId === Boolean(selectedName)) {
      throw new Error("Supply exactly one of interaction guide ID or name");
    }
    const row = hasId
      ? this.store.requireReady().prepare(
          "SELECT * FROM interaction_guides WHERE interaction_guide_id = ?",
        ).get(identifier(guideId))
      : this.store.requireReady().prepare(
          "SELECT * FROM interaction_guides WHERE name = ? COLLATE NOCASE",
        ).get(selectedName);
    return publicGuide(row);
  }

  create({ name, guideText }, context = {}) {
    const selectedName = requiredText(name, "Interaction guide name", 200);
    const selectedText = requiredText(guideText, "Interaction guide text", 50_000);
    const database = this.store.requireReady();
    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = database.prepare(
        "SELECT * FROM interaction_guides WHERE name = ? COLLATE NOCASE",
      ).get(selectedName);
      if (existing) throw conflict(`An interaction guide named "${selectedName}" already exists`);
      const row = database.prepare(`
        INSERT INTO interaction_guides (name, guide_text)
        VALUES (?, ?)
        RETURNING *
      `).get(selectedName, selectedText);
      const guide = publicGuide(row);
      this.ledger.append({
        type: "interaction_guide.created", status: "complete", actorType: "tool",
        actorName: "interaction_guide_create", turnId: context.requestId,
        operationId: context.callId, name: "Interaction guide created",
        content: guide.name, payload: { guide }, subjectType: "interaction_guide",
        subjectId: String(guide.id),
      });
      database.exec("COMMIT");
      return { created: true, guide };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  update({ guideId, expectedVersion, name = null, guideText = null }, context = {}) {
    const selectedId = identifier(guideId);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error("Expected interaction guide version must be a positive integer");
    }
    if (name === null && guideText === null) throw new Error("No interaction guide changes were supplied");
    const database = this.store.requireReady();
    database.exec("BEGIN IMMEDIATE");
    try {
      const beforeRow = database.prepare(
        "SELECT * FROM interaction_guides WHERE interaction_guide_id = ?",
      ).get(selectedId);
      if (!beforeRow) throw new Error(`Interaction guide ${selectedId} does not exist`);
      if (Number(beforeRow.version) !== expectedVersion) {
        throw conflict("This interaction guide changed after it was read. Fetch it again before updating it.");
      }
      const selectedName = name === null
        ? beforeRow.name
        : requiredText(name, "Interaction guide name", 200);
      const selectedText = guideText === null
        ? beforeRow.guide_text
        : requiredText(guideText, "Interaction guide text", 50_000);
      if (selectedName === beforeRow.name && selectedText === beforeRow.guide_text) {
        database.exec("COMMIT");
        return { updated: false, unchanged: true, guide: publicGuide(beforeRow) };
      }
      const duplicate = database.prepare(`
        SELECT interaction_guide_id FROM interaction_guides
        WHERE name = ? COLLATE NOCASE AND interaction_guide_id <> ?
      `).get(selectedName, selectedId);
      if (duplicate) throw conflict(`An interaction guide named "${selectedName}" already exists`);
      const row = database.prepare(`
        UPDATE interaction_guides
        SET name = ?, guide_text = ?, version = version + 1,
            updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE interaction_guide_id = ? AND version = ?
        RETURNING *
      `).get(selectedName, selectedText, selectedId, expectedVersion);
      if (!row) throw conflict("This interaction guide changed while it was being updated");
      const before = publicGuide(beforeRow);
      const guide = publicGuide(row);
      this.ledger.append({
        type: "interaction_guide.updated", status: "complete", actorType: "tool",
        actorName: "interaction_guide_update", turnId: context.requestId,
        operationId: context.callId, name: "Interaction guide updated",
        content: guide.name, payload: { before, guide }, subjectType: "interaction_guide",
        subjectId: String(guide.id),
      });
      database.exec("COMMIT");
      return { updated: true, unchanged: false, guide };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  archive({ guideId, expectedVersion }, context = {}) {
    const selectedId = identifier(guideId);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error("Expected interaction guide version must be a positive integer");
    }
    const database = this.store.requireReady();
    database.exec("BEGIN IMMEDIATE");
    try {
      const before = database.prepare(
        "SELECT * FROM interaction_guides WHERE interaction_guide_id = ?",
      ).get(selectedId);
      if (!before) throw new Error(`Interaction guide ${selectedId} does not exist`);
      if (Number(before.version) !== expectedVersion) {
        throw conflict("This interaction guide changed after it was read. Fetch it again before archiving it.");
      }
      if (before.status === "archived") {
        database.exec("COMMIT");
        return { archived: false, alreadyArchived: true, guide: publicGuide(before) };
      }
      const linked = database.prepare(`
        SELECT COUNT(*) AS count FROM todo_routines
        WHERE interaction_guide_id = ? AND disabled_at_utc IS NULL
      `).get(selectedId);
      if (Number(linked.count) > 0) {
        throw conflict("Disable or unlink the active repeating to-dos that use this interaction guide before archiving it");
      }
      const row = database.prepare(`
        UPDATE interaction_guides
        SET status = 'archived', version = version + 1,
            updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE interaction_guide_id = ? AND version = ?
        RETURNING *
      `).get(selectedId, expectedVersion);
      if (!row) throw conflict("This interaction guide changed while it was being archived");
      const guide = publicGuide(row);
      this.ledger.append({
        type: "interaction_guide.archived", status: "complete", actorType: "tool",
        actorName: "interaction_guide_archive", turnId: context.requestId,
        operationId: context.callId, name: "Interaction guide archived",
        content: guide.name, payload: { guide }, subjectType: "interaction_guide",
        subjectId: String(guide.id),
      });
      database.exec("COMMIT");
      return { archived: true, alreadyArchived: false, guide };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
