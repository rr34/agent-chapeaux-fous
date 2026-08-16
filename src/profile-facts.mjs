const factStatuses = ["active", "archived"];

function publicFact(row) {
  if (!row) return null;
  return {
    id: Number(row.profile_fact_id),
    factType: row.fact_type,
    text: row.fact_text,
    status: row.fact_status,
    sourceEventId: row.source_event_id,
    archivedByEventId: row.archived_by_event_id,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    archivedAtUtc: row.archived_at_utc,
  };
}

function normalizedFactType(value) {
  const factType = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,199}$/.test(factType)) {
    throw new Error("Profile fact types must use lowercase letters, numbers, and underscores and start with a letter");
  }
  return factType;
}

function normalizedFactId(value, label = "Profile fact ID") {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

export class ProfileFacts {
  constructor({ store, ledger }) {
    this.store = store;
    this.ledger = ledger;
  }

  list({ status = "active", factTypes = null, limit = 500 } = {}) {
    const database = this.store.requireReady();
    if (status !== "all" && !factStatuses.includes(status)) throw new Error(`Unknown profile fact status: ${status}`);
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)) {
      throw new Error("Profile fact list limit must be null or an integer from 1 through 500");
    }
    const selectedTypes = Array.isArray(factTypes) && factTypes.length
      ? [...new Set(factTypes.map(normalizedFactType))]
      : null;
    const conditions = [];
    const values = [];
    if (status !== "all") {
      conditions.push("fact_status = ?");
      values.push(status);
    }
    if (selectedTypes) {
      conditions.push(`fact_type IN (${selectedTypes.map(() => "?").join(", ")})`);
      values.push(...selectedTypes);
    }
    const rows = database.prepare(`
      SELECT * FROM profile_facts
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY fact_type, profile_fact_id
      ${limit === null ? "" : "LIMIT ?"}
    `).all(...values, ...(limit === null ? [] : [limit])).map(publicFact);
    return { status, count: rows.length, facts: rows };
  }

  set({ factType, text, replacesFactId = null }, context = {}) {
    const selectedType = normalizedFactType(factType);
    const factText = String(text ?? "").trim();
    if (!factText) throw new Error("Profile fact text cannot be empty");
    if (factText.length > 10000) throw new Error("Profile fact text cannot exceed 10000 characters");
    if (replacesFactId !== null) normalizedFactId(replacesFactId, "Replacement profile fact ID");

    const database = this.store.requireReady();
    const now = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      const before = replacesFactId === null ? null : database.prepare(`
        SELECT * FROM profile_facts
        WHERE profile_fact_id = ? AND fact_status = 'active'
      `).get(replacesFactId);
      if (replacesFactId !== null && !before) {
        throw new Error(`Active profile fact ${replacesFactId} does not exist`);
      }
      if (before?.fact_type === selectedType && before?.fact_text === factText) {
        database.exec("COMMIT");
        return {
          created: false,
          replaced: false,
          unchanged: true,
          previousFact: null,
          fact: publicFact(before),
        };
      }
      const archived = before
        ? database.prepare(`
            UPDATE profile_facts
            SET fact_status = 'archived', archived_by_event_id = ?,
                updated_at_utc = ?, archived_at_utc = ?
            WHERE profile_fact_id = ?
            RETURNING *
          `).get(context.requestEventId || null, now, now, before.profile_fact_id)
        : null;
      const row = database.prepare(`
        INSERT INTO profile_facts (
          fact_type, fact_text, fact_status, source_event_id, updated_at_utc
        ) VALUES (?, ?, 'active', ?, ?)
        RETURNING *
      `).get(selectedType, factText, context.requestEventId || null, now);
      const result = {
        created: !before,
        replaced: Boolean(before),
        unchanged: false,
        previousFact: publicFact(archived),
        fact: publicFact(row),
      };
      this.ledger.append({
        type: before ? "profile_fact.replaced" : "profile_fact.created",
        status: "complete", actorType: "tool", actorName: "profile_fact_set",
        turnId: context.requestId, operationId: context.callId,
        name: before ? "Profile fact replaced" : "Profile fact created",
        content: `${selectedType}: ${factText}`, payload: result,
        subjectType: "profile_fact", subjectId: String(row.profile_fact_id),
      });
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  archive({ factId }, context = {}) {
    const selectedId = normalizedFactId(factId);
    const database = this.store.requireReady();
    const before = database.prepare(`
      SELECT * FROM profile_facts WHERE profile_fact_id = ?
    `).get(selectedId);
    if (!before) throw new Error(`Profile fact ${selectedId} does not exist`);
    if (before.fact_status === "archived") {
      return { archived: false, alreadyArchived: true, fact: publicFact(before) };
    }
    const now = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      const row = database.prepare(`
        UPDATE profile_facts
        SET fact_status = 'archived', archived_by_event_id = ?,
            updated_at_utc = ?, archived_at_utc = ?
        WHERE profile_fact_id = ?
        RETURNING *
      `).get(context.requestEventId || null, now, now, selectedId);
      const result = { archived: true, alreadyArchived: false, fact: publicFact(row) };
      this.ledger.append({
        type: "profile_fact.archived", status: "complete", actorType: "tool",
        actorName: "profile_fact_delete", turnId: context.requestId,
        operationId: context.callId, name: "Profile fact archived",
        content: `${row.fact_type}: ${row.fact_text}`, payload: result,
        subjectType: "profile_fact", subjectId: String(selectedId),
      });
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

export function profileFactsContext(facts) {
  if (!facts.length) return "No active rows are stored for these profile types.";
  return facts.map((fact) => {
    const text = String(fact.text).replaceAll("\r\n", "\n").replaceAll("\n", "\n  ");
    return `- [fact ${fact.id}] ${fact.factType}: ${text}`;
  }).join("\n");
}
