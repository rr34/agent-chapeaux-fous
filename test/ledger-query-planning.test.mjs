import assert from "node:assert/strict";
import test from "node:test";
import { InteractionGuides } from "../src/interaction-guides.mjs";
import { Ledger } from "../src/ledger.mjs";

function requestRow(id, sequence) {
  return {
    event_seq: sequence,
    event_id: `event-${id}`,
    occurred_at_ms: 1_700_000_000_000 + sequence,
    occurred_at_utc: "2023-11-14T22:13:20.000Z",
    event_type: "request.received",
    event_phase: "point",
    status: "queued",
    actor_type: "user",
    actor_name: "User",
    source: "web_client",
    channel: "web",
    session_id: "main",
    turn_id: id,
    trace_id: id,
    operation_id: null,
    name: "User request",
    content_text: `Request ${id}`,
    payload_json: "{}",
    primary_file_id: null,
    subject_type: null,
    subject_id: null,
    error_text: null,
  };
}

test("recent request loading uses bounded indexes and reuses one video scan", () => {
  const requests = [requestRow("turn-2", 2), requestRow("turn-1", 1)];
  const calls = [];
  const database = {
    prepare(sql) {
      return {
        all(...parameters) {
          calls.push({ sql, parameters });
          if (/event_type = 'request\.received'/u.test(sql) && /LIMIT 1000/u.test(sql)) return [];
          if (/event_type IN/u.test(sql) && /ORDER BY event_seq DESC LIMIT \?/u.test(sql)) {
            return requests;
          }
          if (/FORCE INDEX \(activity_events_turn\)/u.test(sql)) {
            return [requests.find(({ turn_id: id }) => id === parameters[0])];
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };
  const ledger = new Ledger({ requireReady: () => database });

  const result = ledger.recentRequests(2);

  assert.equal(result.length, 2);
  assert.equal(calls.filter(({ sql }) => /LIMIT 1000/u.test(sql)).length, 1);
  assert.equal(calls.filter(({ sql }) => /FORCE INDEX \(activity_events_type\)/u.test(sql)).length, 2);
  assert.equal(calls.filter(({ sql }) => /FORCE INDEX \(activity_events_turn\)/u.test(sql)).length, 2);
  const videoScan = calls.find(({ sql }) => /event_type = 'request\.received'/u.test(sql));
  assert.match(videoScan.sql, /SELECT turn_id, payload_json/u);
  assert.doesNotMatch(videoScan.sql, /SELECT \*/u);
});

test("AI usage avoids the reserved usage alias and uses selective indexes", () => {
  const calls = [];
  const database = {
    prepare(sql) {
      return {
        all(...parameters) {
          calls.push({ sql, parameters });
          return [];
        },
      };
    },
  };
  const ledger = new Ledger({ requireReady: () => database });

  assert.deepEqual(ledger.modelUsage({ limit: 10 }), []);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].sql, /\busage\.\*/u);
  assert.match(calls[0].sql, /usage_event\.\*/u);
  assert.match(calls[0].sql, /usage_event FORCE INDEX \(activity_events_type\)/u);
  assert.match(calls[0].sql, /response FORCE INDEX \(activity_events_operation\)/u);
  assert.deepEqual(calls[0].parameters, [10]);
});

test("briefing summaries constrain activity lookups to event and subject indexes", () => {
  const calls = [];
  const guide = {
    interaction_guide_id: 7,
    name: "Daily briefing",
    status: "active",
    version: 1,
    created_at_utc: "2023-11-14T22:13:20.000Z",
    updated_at_utc: null,
  };
  const database = {
    prepare(sql) {
      return {
        all(...parameters) {
          calls.push({ mode: "all", sql, parameters });
          return /FROM interaction_guides/u.test(sql) ? [guide] : [];
        },
        get(...parameters) {
          calls.push({ mode: "get", sql, parameters });
          return undefined;
        },
      };
    },
  };
  const guides = new InteractionGuides({
    store: { requireReady: () => database },
    ledger: {},
  });

  assert.equal(guides.list({ status: "active", limit: 10 }).count, 1);
  const activeRun = calls.find(({ sql }) => /interaction_guide\.run_started/u.test(sql));
  assert.ok(activeRun);
  assert.match(activeRun.sql, /started FORCE INDEX \(activity_events_type\)/u);
  assert.match(activeRun.sql, /terminal FORCE INDEX \(activity_events_subject\)/u);
});
