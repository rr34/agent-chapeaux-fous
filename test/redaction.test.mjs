import assert from "node:assert/strict";
import test from "node:test";
import { redactValue, safeJson } from "../src/redaction.mjs";

test("trace redaction preserves shared references and marks only actual cycles", () => {
  const shared = { type: "string", apiKey: "secret" };
  const value = { first: shared, second: shared };
  value.self = value;

  assert.deepEqual(redactValue(value), {
    first: { type: "string", apiKey: "[REDACTED]" },
    second: { type: "string", apiKey: "[REDACTED]" },
    self: "[CIRCULAR]",
  });
  assert.deepEqual(JSON.parse(safeJson(value)), {
    first: { type: "string", apiKey: "[REDACTED]" },
    second: { type: "string", apiKey: "[REDACTED]" },
    self: "[CIRCULAR]",
  });
});
