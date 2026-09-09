import { createHash } from "node:crypto";
import { currentLoggingPeriod, previewRoutineOccurrenceStarts } from "./organizer-store.mjs";
import { localDateUtcBounds } from "./todo-schedule-operations.mjs";
import { buildRecurrenceRule, validateTimeZone } from "./todo-recurrence.mjs";

const maximumSources = 2000;
const terminalTasks = new Set(["complete", "ignore", "archive"]);
function publicQuestion(row) {
  if (!row) return row;
  const result = { ...row };
  for (const field of ["question_id", "personal_task_id", "calendar_event_id", "tracker_id", "version"]) {
    if (result[field] !== null) {
      result[field] = Number(result[field]);
      if (!Number.isSafeInteger(result[field])) throw new Error(`${field} exceeds the supported integer range`);
    }
  }
  return result;
}
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bounded = (rows, label) => {
  if (rows.length > maximumSources) throw new Error(`${label} exceeds ${maximumSources} records; narrow the catch-up date range.`);
  return rows;
};
export function catchUpInstant(value, label = "time") {
  if (typeof value !== "string" || !/(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp with an explicit time zone`);
  }
  return new Date(value).toISOString();
}
function question(source, occurrence, version, text, due, satisfied = false) {
  return { personal_task_id: null, calendar_event_id: null, tracker_id: null, ...source,
    occurrence_key: occurrence, source_version: digest(version), question_text: text.length > 2000 ? `${text.slice(0, 1999)}…` : text,
    due_at_utc: due, satisfied };
}

// Native domain service. It derives attention from source records, never chats.
// Refresh owns only catch_up_questions; ordinary mutations stay in their domains.
export class CatchUpService {
  constructor(store, organizer, ledger, { now = () => new Date().toISOString() } = {}) {
    this.store = store;
    this.organizer = organizer;
    this.ledger = ledger;
    this.now = now;
  }
  get database() { return this.store.requireReady(); }
  transaction(work) {
    const db = this.database;
    db.exec("START TRANSACTION");
    try { const result = work(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  record(type, result, context = {}) {
    this.ledger.append({ type: `catch_up.${type}`, status: "complete", actorType: "tool",
      actorName: `catch_up_${type}`, turnId: context.requestId, operationId: context.callId,
      name: `Catch-up ${type}`, payload: result });
    return result;
  }
  task(id) {
    id = Number(id);
    const row = this.database.prepare("SELECT * FROM todo_personal WHERE personal_task_id = ?").get(id);
    if (!row) return null;
    const due = row.scheduled_at_utc ?? row.due_at_utc;
    if (!due) return null;
    return question({ personal_task_id: id }, "task",
      [row.text, row.status, row.scheduled_at_utc, row.due_at_utc, row.planning_prompt_text],
      row.planning_prompt_text || `What happened with #${id} — ${row.text}?`, due, terminalTasks.has(row.status));
  }
  event(id, occurrenceKey) {
    id = Number(id);
    const row = this.database.prepare("SELECT * FROM calendar_events WHERE calendar_event_id = ?").get(id);
    if (!row) return null;
    let starts = row.starts_at_utc;
    let ends = row.ends_at_utc;
    if (occurrenceKey !== "event") {
      if (!row.recurrence_rule || row.status === "cancelled") return null;
      const instance = this.organizer.getCalendarOccurrence(id, occurrenceKey);
      if (!instance) return null;
      starts = instance.startsAtUtc;
      ends = instance.endsAtUtc;
    } else if (row.recurrence_rule) return null;
    return question({ calendar_event_id: id }, occurrenceKey,
      [row.title, row.status, starts, ends, row.planning_prompt_text],
      row.planning_prompt_text || `How did “${row.title}” go?`, starts,
      row.status === "cancelled");
  }
  tracker(id, at) {
    id = Number(id);
    const row = this.database.prepare(`SELECT tracker.*, journal_group.archived_at_utc AS group_archived
      FROM trackers AS tracker JOIN journal_groups AS journal_group USING (journal_group_id)
      WHERE tracker_id = ?`).get(id);
    if (!row || row.archived_at_utc || row.group_archived || !row.asking_recurrence_rule) return null;
    const period = currentLoggingPeriod({ startsAtUtc: row.asking_starts_at_utc,
      timeZone: row.asking_time_zone, recurrenceRule: row.asking_recurrence_rule }, at);
    if (!period) return null;
    const entry = this.database.prepare(`SELECT journal_entry_id FROM journal_entries
      WHERE tracker_id = ? AND occurred_at_utc >= ? AND occurred_at_utc < ? LIMIT 1`)
      .get(id, period.startsAtUtc, period.endsAtUtc);
    const periodLabel = new Intl.DateTimeFormat("en-US", { timeZone: row.asking_time_zone,
      month: "short", day: "numeric", year: "numeric" }).format(new Date(period.startsAtUtc));
    return question({ tracker_id: id }, period.startsAtUtc,
      [row.name, row.unit, row.asking_recurrence_rule, row.asking_time_zone, period, Boolean(entry)],
      `What would you like to log for ${row.name} (${row.unit}) since ${periodLabel}?`,
      period.startsAtUtc, Boolean(entry));
  }
  source(row, at) {
    if (row.personal_task_id) return this.task(row.personal_task_id);
    if (row.calendar_event_id) return this.event(row.calendar_event_id, row.occurrence_key);
    const current = this.tracker(row.tracker_id, at);
    return current?.occurrence_key === row.occurrence_key ? current : null;
  }
  reconcile(row, source, at) {
    if (!source) {
      if (!row.resolved_at) this.database.prepare(`UPDATE catch_up_questions
        SET resolved_at = ?, source_version = ?, version = version + 1 WHERE question_id = ?`).run(at, digest(["unavailable", row.source_version]), row.question_id);
      return;
    }
    if (row.source_version !== source.source_version) {
      this.database.prepare(`UPDATE catch_up_questions SET source_version = ?, question_text = ?,
        due_at_utc = ?, ask_after = NULL, resolved_at = ?, version = version + 1 WHERE question_id = ?`)
        .run(source.source_version, source.question_text, source.due_at_utc, source.satisfied ? at : null, row.question_id);
    } else if (source.satisfied && !row.resolved_at) {
      this.database.prepare(`UPDATE catch_up_questions SET resolved_at = ?, version = version + 1
        WHERE question_id = ?`).run(at, row.question_id);
    }
  }
  upsert(source, at) {
    const field = source.personal_task_id ? "personal_task_id" : source.calendar_event_id ? "calendar_event_id" : "tracker_id";
    this.database.prepare(`INSERT INTO catch_up_questions
      (personal_task_id, calendar_event_id, tracker_id, occurrence_key, source_version, question_text, due_at_utc, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE question_id = question_id`)
      .run(source.personal_task_id, source.calendar_event_id, source.tracker_id, source.occurrence_key,
        source.source_version, source.question_text, source.due_at_utc, source.satisfied ? at : null);
    const row = this.database.prepare(`SELECT * FROM catch_up_questions WHERE ${field} = ? AND occurrence_key = ? FOR UPDATE`)
      .get(source[field], source.occurrence_key);
    this.reconcile(row, source, at);
  }
  refresh({ local_date, time_zone, lookback_days = 7 }, context = {}) {
    const at = this.now();
    const bounds = localDateUtcBounds({ localDate: local_date, timeZone: time_zone });
    if (!Number.isInteger(lookback_days) || lookback_days < 0 || lookback_days > 31) throw new Error("lookback_days must be 0 through 31");
    const firstDate = new Date(Date.parse(`${local_date}T12:00:00Z`) - lookback_days * 86400000).toISOString().slice(0, 10);
    const from = localDateUtcBounds({ localDate: firstDate, timeZone: time_zone }).startsAtUtc;
    return this.transaction(() => {
      // Reconcile outstanding rows even when their source moved outside this range.
      const existing = bounded(this.database.prepare(`SELECT * FROM catch_up_questions
        WHERE resolved_at IS NULL ORDER BY question_id LIMIT 2001 FOR UPDATE`).all(), "Outstanding questions");
      for (const row of existing) this.reconcile(row, this.source(row, at), at);
      const tasks = bounded(this.database.prepare(`SELECT personal_task_id FROM todo_personal
        WHERE COALESCE(scheduled_at_utc, due_at_utc) < ?
        AND status IN ('todo', 'unplanned') ORDER BY personal_task_id LIMIT 2001`).all(bounds.endsAtUtc), "Scheduled tasks");
      for (const row of tasks) this.upsert(this.task(row.personal_task_id), at);
      const events = this.organizer.listCalendar({ from, to: bounds.endsAtUtc, strictBounds: true, includeBirthdays: false });
      if (events.length > 2000) throw new Error("Calendar exceeded its 2000-occurrence bound; narrow the catch-up date range.");
      for (const event of events) {
        if (event.contactId) continue;
        const source = this.event(Number(event.seriesId ?? event.id), event.isGeneratedOccurrence ? event.startsAtUtc : "event");
        if (source) this.upsert(source, at);
      }
      const trackers = bounded(this.database.prepare(`SELECT tracker_id FROM trackers
        WHERE archived_at_utc IS NULL AND asking_recurrence_rule IS NOT NULL
        ORDER BY tracker_id LIMIT 2001`).all(), "Scheduled trackers");
      for (const row of trackers) {
        const source = this.tracker(row.tracker_id, at);
        if (source) this.upsert(source, at);
      }
      return this.record("refreshed", { refreshed: true, local_date, time_zone,
        calendar_from_utc: from, through_utc: bounds.endsAtUtc,
        tasks_checked: tasks.length, calendar_occurrences_checked: events.length, trackers_checked: trackers.length,
        due_count: Number(this.database.prepare(`SELECT COUNT(*) AS count FROM catch_up_questions
          WHERE resolved_at IS NULL AND due_at_utc <= ? AND (ask_after IS NULL OR ask_after <= ?)`)
          .get(at, at).count) }, context);
    });
  }
  list({ limit = 10, after_id = 0, question_id = null } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("limit must be 1 through 50");
    const at = this.now();
    if (question_id !== null) {
      const row = this.database.prepare("SELECT * FROM catch_up_questions WHERE question_id = ?").get(question_id);
      const source = row ? this.source(row, at) : null;
      return { questions: row ? [publicQuestion(row)] : [], count: row ? 1 : 0, next_after_id: null,
        refresh_required: Boolean(row && (!source || source.source_version !== row.source_version)) };
    }
    const rows = this.database.prepare(`SELECT * FROM catch_up_questions
      WHERE question_id > ? AND resolved_at IS NULL AND due_at_utc <= ? AND (ask_after IS NULL OR ask_after <= ?)
      ORDER BY question_id LIMIT ?`).all(after_id, at, at, limit + 1);
    const page = rows.slice(0, limit);
    let stale = 0;
    const questions = page.filter(row => {
      const source = this.source(row, at);
      const current = source && !source.satisfied && source.source_version === row.source_version;
      if (!current) stale++;
      return current;
    });
    return { questions: questions.map(publicQuestion), count: questions.length, refresh_required: stale > 0,
      next_after_id: rows.length > limit ? Number(page.at(-1).question_id) : null };
  }
  update({ question_id, expected_version, action, ask_after, comment }, context = {}) {
    const at = this.now();
    if (!["resolve", "defer", "reopen", "comment"].includes(action)) throw new Error("Invalid question action");
    if (action === "defer") {
      ask_after = catchUpInstant(ask_after, "ask_after");
      if (ask_after <= at) throw new Error("ask_after must be in the future");
    } else if (ask_after != null) throw new Error("ask_after is only valid for deferral");
    if (comment !== null && (typeof comment !== "string" || comment.length > 10000)) throw new Error("comment must be null or at most 10000 characters");
    return this.transaction(() => {
      const row = this.database.prepare("SELECT * FROM catch_up_questions WHERE question_id = ? FOR UPDATE").get(question_id);
      if (!row) throw new Error("Question not found");
      if (Number(row.version) !== expected_version) throw new Error("Question changed; refresh and read it again before answering");
      const source = this.source(row, at);
      if (action !== "comment" && (!source || source.source_version !== row.source_version)) {
        throw new Error("Source data changed; refresh and read the question again before answering");
      }
      if (["reopen", "defer"].includes(action) && source.satisfied) throw new Error("The source already satisfies this question");
      const resolved = action === "resolve" ? at : action === "comment" ? row.resolved_at : null;
      const deferred = action === "defer" ? ask_after : action === "comment" ? row.ask_after : null;
      this.database.prepare(`UPDATE catch_up_questions SET resolved_at = ?, ask_after = ?, comment = ?,
        version = version + 1 WHERE question_id = ?`).run(resolved, deferred, comment ?? row.comment, question_id);
      return this.record("updated", { question: publicQuestion(this.database.prepare("SELECT * FROM catch_up_questions WHERE question_id = ?").get(question_id)) }, context);
    });
  }
  setTrackerSchedule({ tracker_id, starts_at_utc, recurrence }, context = {}) {
    let start = null, rule = null, zone = null;
    if (recurrence) {
      start = catchUpInstant(starts_at_utc, "starts_at_utc");
      zone = validateTimeZone(recurrence.time_zone);
      rule = buildRecurrenceRule(recurrence);
      if (!previewRoutineOccurrenceStarts({ startsAtUtc: start, timeZone: zone, recurrenceRule: rule, limit: 1 }).length) {
        throw new Error("The asking schedule has no occurrences");
      }
    } else if (starts_at_utc !== null) throw new Error("Disabling questions requires null starts_at_utc and recurrence");
    return this.transaction(() => {
      const before = this.database.prepare("SELECT * FROM trackers WHERE tracker_id = ? FOR UPDATE").get(tracker_id);
      if (!before || before.archived_at_utc) throw new Error("Active tracker not found");
      this.database.prepare(`UPDATE trackers SET asking_starts_at_utc = ?, asking_recurrence_rule = ?,
        asking_time_zone = ?, updated_at_utc = ? WHERE tracker_id = ?`).run(start, rule, zone, this.now(), tracker_id);
      return this.record("tracker_schedule_updated", { tracker_id, asking_starts_at_utc: start,
        asking_recurrence_rule: rule, asking_time_zone: zone }, context);
    });
  }
}
