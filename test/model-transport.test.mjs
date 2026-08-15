import assert from "node:assert/strict";
import test from "node:test";
import { assertModelTransport } from "../src/model-transport.mjs";

test("a model adapter must implement the complete Slayer transport boundary", () => {
  assert.throws(
    () => assertModelTransport({ id: "incomplete", displayName: "Incomplete" }),
    /does not implement start/,
  );

  const transport = {
    id: "complete",
    displayName: "Complete",
    async start() {},
    async close() {},
    health() { return { ready: true }; },
    describeRequest(request) { return request; },
    async runTurn() { return { text: "done" }; },
  };
  assert.equal(assertModelTransport(transport), transport);
});
