import { currentLoggingPeriod, previewRoutineOccurrenceStarts } from "./organizer-store.mjs";
import { localDateUtcBounds } from "./temporal-consistency.mjs";
import { buildRecurrenceRule, validateTimeZone } from "./todo-recurrence.mjs";

function instant(value, label) {
  if (typeof value !== "string" || !/(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp with an explicit time zone`);
  }
  return new Date(value).toISOString();
}

function cadence(recurrenceRule) {
  const parts = Object.fromEntries(String(recurrenceRule).replace(/^RRULE:/i, "").split(";")
    .map((part) => part.split("=", 2)).filter(([key, value]) => key && value));
  const frequency = String(parts.FREQ || "").toLowerCase();
  const interval = Number(parts.INTERVAL || 1);
  return {
    frequency: ["daily", "weekly", "monthly", "yearly"].includes(frequency) ? frequency : "scheduled",
    interval: Number.isInteger(interval) && interval > 0 ? interval : 1,
  };
}

export class JournalScheduleService {
  constructor(store, ledger, { now = () => new Date().toISOString() } = {}) {
    this.store = store;
    this.ledger = ledger;
    this.now = now;
  }

  get database() { return this.store.requireReady(); }

  scheduledTrackersForDay({ localDate, timeZone }) {
    const zone = validateTimeZone(timeZone);
    const bounds = localDateUtcBounds({ localDate, timeZone: zone });
    const at = new Date((Date.parse(bounds.startsAtUtc) + Date.parse(bounds.endsAtUtc)) / 2).toISOString();
    const rows = this.database.prepare(`SELECT tracker.tracker_id, tracker.name, tracker.unit,
        tracker.asking_starts_at_utc, tracker.asking_recurrence_rule, tracker.asking_time_zone,
        journal_group.name AS group_name
      FROM journal2_trackers AS tracker
      JOIN journal1_groups AS journal_group USING (journal_group_id)
      WHERE tracker.archived_at_utc IS NULL AND journal_group.archived_at_utc IS NULL
        AND tracker.asking_recurrence_rule IS NOT NULL
      ORDER BY journal_group.name, tracker.name, tracker.tracker_id LIMIT 2001`).all();
    if (rows.length > 2000) throw new Error("Scheduled trackers exceed 2000 records");
    return rows.flatMap((row) => {
      const trackerZone = row.asking_time_zone || zone;
      const period = currentLoggingPeriod({
        startsAtUtc: row.asking_starts_at_utc,
        timeZone: trackerZone,
        recurrenceRule: row.asking_recurrence_rule,
      }, at);
      if (!period) return [];
      const logged = Boolean(this.database.prepare(`SELECT journal_entry_id FROM journal3_entries
        WHERE tracker_id = ? AND occurred_at_utc >= ? AND occurred_at_utc < ? LIMIT 1`)
        .get(row.tracker_id, period.startsAtUtc, period.endsAtUtc));
      const trackerId = Number(row.tracker_id);
      return [{
        trackerId,
        ref: `agent-slayer://journal-trackers/${trackerId}`,
        name: row.name,
        groupName: row.group_name,
        unit: row.unit,
        ...cadence(row.asking_recurrence_rule),
        periodStartsAtUtc: period.startsAtUtc,
        periodEndsAtUtc: period.endsAtUtc,
        logged,
      }];
    });
  }

  setTrackerSchedule({ tracker_id, starts_at_utc, recurrence }, context = {}) {
    let start = null;
    let rule = null;
    let zone = null;
    if (recurrence) {
      start = instant(starts_at_utc, "starts_at_utc");
      zone = validateTimeZone(recurrence.time_zone);
      rule = buildRecurrenceRule(recurrence);
      if (!previewRoutineOccurrenceStarts({ startsAtUtc: start, timeZone: zone, recurrenceRule: rule, limit: 1 }).length) {
        throw new Error("The journal schedule has no occurrences");
      }
    } else if (starts_at_utc !== null) {
      throw new Error("Disabling a journal schedule requires null starts_at_utc and recurrence");
    }
    const db = this.database;
    db.exec("START TRANSACTION");
    try {
      const before = db.prepare("SELECT * FROM journal2_trackers WHERE tracker_id = ? FOR UPDATE").get(tracker_id);
      if (!before || before.archived_at_utc) throw new Error("Active tracker not found");
      db.prepare(`UPDATE journal2_trackers SET asking_starts_at_utc = ?, asking_recurrence_rule = ?,
        asking_time_zone = ?, updated_at_utc = ? WHERE tracker_id = ?`)
        .run(start, rule, zone, this.now(), tracker_id);
      const result = { tracker_id, asking_starts_at_utc: start, asking_recurrence_rule: rule, asking_time_zone: zone };
      this.ledger.append({
        type: "journal.tracker_schedule_updated", status: "complete", actorType: "tool",
        actorName: "tracker_asking_schedule_set", turnId: context.requestId,
        operationId: context.callId, name: "Journal tracker schedule updated", payload: result,
      });
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
