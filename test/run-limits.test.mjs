import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRunLimits } from "../src/run-limits.mjs";

test("run limits accept bounded values and explicit unlimited settings", () => {
  assert.equal(normalizeRunLimits(null), null);
  assert.deepEqual(normalizeRunLimits({ maxToolCalls: 256, timeoutMs: 3_600_000 }), {
    maxToolCalls: 256,
    timeoutMs: 3_600_000,
  });
  assert.deepEqual(normalizeRunLimits({ maxToolCalls: null, timeoutMs: null }), {
    maxToolCalls: null,
    timeoutMs: null,
  });
  assert.throws(() => normalizeRunLimits({ maxToolCalls: 0, timeoutMs: 60_000 }), /maxToolCalls/);
  assert.throws(() => normalizeRunLimits({ maxToolCalls: 20, timeoutMs: 999 }), /timeoutMs/);
  assert.throws(
    () => normalizeRunLimits({ maxToolCalls: 20, timeoutMs: 60_000, extra: true }),
    /Unexpected runLimits field/,
  );
});
