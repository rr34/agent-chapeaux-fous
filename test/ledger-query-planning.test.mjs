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

test("recent request loading reuses one video scan and forces the turn trace index", () => {
  const requests = [requestRow("turn-2", 2), requestRow("turn-1", 1)];
  const calls = [];
  const database = {
    prepare(sql) {
      return {
        all(...parameters) {
          calls.push({ sql, parameters });
          if (/LIMIT 1000/u.test(sql)) return [];
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
  assert.equal(calls.filter(({ sql }) => /FORCE INDEX \(activity_events_turn\)/u.test(sql)).length, 2);
});
