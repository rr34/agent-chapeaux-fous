const factStatuses = ["active", "archived"];

function publicFact(row) {
  if (!row) return null;
  return {
    id: Number(row.profile_fact_id),
    key: row.fact_key,
    value: row.value_text,
    status: row.fact_status,
    sourceEventId: row.source_event_id,
    archivedByEventId: row.archived_by_event_id,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    archivedAtUtc: row.archived_at_utc,
  };
}

function normalizedKey(value) {
  const key = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,199}$/.test(key)) {
    throw new Error("Profile fact keys must use lowercase letters, numbers, and underscores and start with a letter");
  }
  return key;
}

export class ProfileFacts {
  constructor({ store, ledger }) {
    this.store = store;
    this.ledger = ledger;
  }

  list({ status = "active", keys = null, limit = 500 } = {}) {
    const database = this.store.requireReady();
    if (status !== "all" && !factStatuses.includes(status)) throw new Error(`Unknown profile fact status: ${status}`);
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)) {
      throw new Error("Profile fact list limit must be null or an integer from 1 through 500");
    }
    const selectedKeys = Array.isArray(keys) && keys.length
      ? [...new Set(keys.map(normalizedKey))]
      : null;
    const conditions = [];
    const values = [];
    if (status !== "all") {
      conditions.push("fact_status = ?");
      values.push(status);
    }
    if (selectedKeys) {
      conditions.push(`fact_key IN (${selectedKeys.map(() => "?").join(", ")})`);
      values.push(...selectedKeys);
    }
    const rows = database.prepare(`
      SELECT * FROM profile_facts
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY fact_key, profile_fact_id DESC
      ${limit === null ? "" : "LIMIT ?"}
    `).all(...values, ...(limit === null ? [] : [limit])).map(publicFact);
    return { status, count: rows.length, facts: rows };
  }

  set({ key, value }, context = {}) {
    const factKey = normalizedKey(key);
    const valueText = String(value ?? "").trim();
    if (!valueText) throw new Error("Profile fact values cannot be empty");
    if (valueText.length > 10000) throw new Error("Profile fact values cannot exceed 10000 characters");
    const database = this.store.requireReady();
    const now = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      const before = database.prepare(`
        SELECT * FROM profile_facts
        WHERE fact_key = ? AND fact_status = 'active'
      `).get(factKey);
      if (before?.value_text === valueText) {
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
          fact_key, value_text, fact_status, source_event_id, updated_at_utc
        ) VALUES (?, ?, 'active', ?, ?)
        RETURNING *
      `).get(factKey, valueText, context.requestEventId || null, now);
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
        content: `${factKey}: ${valueText}`, payload: result,
        subjectType: "profile_fact", subjectId: factKey,
      });
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  archive({ key }, context = {}) {
    const factKey = normalizedKey(key);
    const database = this.store.requireReady();
    const before = database.prepare(`
      SELECT * FROM profile_facts
      WHERE fact_key = ? AND fact_status = 'active'
    `).get(factKey);
    if (!before) {
      const archived = database.prepare(`
        SELECT * FROM profile_facts
        WHERE fact_key = ? AND fact_status = 'archived'
        ORDER BY profile_fact_id DESC
      `).get(factKey);
      if (archived) return { archived: false, alreadyArchived: true, fact: publicFact(archived) };
      throw new Error(`Profile fact ${factKey} does not exist`);
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
      `).get(context.requestEventId || null, now, now, before.profile_fact_id);
      const result = { archived: true, alreadyArchived: false, fact: publicFact(row) };
      this.ledger.append({
        type: "profile_fact.archived", status: "complete", actorType: "tool",
        actorName: "profile_fact_delete", turnId: context.requestId,
        operationId: context.callId, name: "Profile fact archived",
        content: factKey, payload: result,
        subjectType: "profile_fact", subjectId: factKey,
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
  if (!facts.length) return "No active profile facts are stored.";
  return facts.map((fact) => {
    const value = String(fact.value).replaceAll("\r\n", "\n").replaceAll("\n", "\n  ");
    return `- ${fact.key}: ${value}`;
  }).join("\n");
}
