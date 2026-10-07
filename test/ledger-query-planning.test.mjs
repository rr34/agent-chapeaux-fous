import assert from "node:assert/strict";
import test from "node:test";
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

test("incremental request loading skips unchanged request traces", () => {
  const requests = [requestRow("turn-2", 2), requestRow("turn-1", 1)];
  const calls = [];
  const database = {
    prepare(sql) {
      return {
        get(...parameters) {
          calls.push({ mode: "get", sql, parameters });
          if (/MAX\(event_seq\)/u.test(sql)) return { event_seq: 10 };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        all(...parameters) {
          calls.push({ mode: "all", sql, parameters });
          if (/event_seq <= \?/u.test(sql) && /ORDER BY event_seq DESC LIMIT \?/u.test(sql)) {
            return requests;
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };
  const ledger = new Ledger({ requireReady: () => database });

  assert.deepEqual(ledger.recentRequestChanges(2, 10), {
    cursor: 10,
    requestIds: ["turn-2", "turn-1"],
    requests: [],
  });
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls.map(({ sql }) => sql).join("\n"), /activity_events_turn/u);
});

test("initial incremental loading projects only feed fields for recent requests", () => {
  const received = requestRow("turn-1", 1);
  const terminal = {
    ...requestRow("turn-1", 2),
    event_id: "terminal-turn-1",
    event_type: "request.complete",
    event_phase: "end",
    status: "complete",
    actor_type: "service",
    content_text: null,
  };
  const calls = [];
  const database = {
    prepare(sql) {
      return {
        get(...parameters) {
          calls.push({ mode: "get", sql, parameters });
          if (/MAX\(event_seq\)/u.test(sql)) return { event_seq: 2 };
          throw new Error(`Unexpected SQL: ${sql}`);
        },
        all(...parameters) {
          calls.push({ mode: "all", sql, parameters });
          if (/event_seq <= \?/u.test(sql) && /ORDER BY event_seq DESC LIMIT \?/u.test(sql)) {
            return [received];
          }
          if (/CASE\s+WHEN event_type IN/u.test(sql) && /activity_events_turn/u.test(sql)) {
            return [received, terminal];
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
    },
  };
  const ledger = new Ledger({ requireReady: () => database });

  const result = ledger.recentRequestChanges(25, 0);
  assert.equal(result.requests.length, 1);
  assert.equal(result.requests[0].status, "complete");
  assert.equal("steps" in result.requests[0], false);
  assert.equal("objectActivity" in result.requests[0], false);
  assert.equal(calls.length, 3);
  assert.doesNotMatch(calls.map(({ sql }) => sql).join("\n"), /SELECT \* FROM activity_events FORCE INDEX \(activity_events_turn\)/u);
  assert.doesNotMatch(calls.map(({ sql }) => sql).join("\n"), /LIMIT 1000/u);
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
