import assert from "node:assert/strict";
import test from "node:test";
import {
  CorrespondenceSyncInputError,
  normalizeAndroidSyncBatch,
} from "../src/correspondence-sync.mjs";

function batch(overrides = {}) {
  return {
    protocol: "timev3.android-correspondence-sync",
    version: 1,
    deviceId: "0123456789abcdef0123456789abcdef",
    contacts: [],
    correspondence: [],
    ...overrides,
  };
}

test("Android correspondence normalization preserves complete plain text and deduplicates participants", () => {
  const normalized = normalizeAndroidSyncBatch(batch({
    correspondence: [{
      medium: "sms",
      direction: "inbound",
      account: "sim_1",
      threadKey: "sms:42",
      externalId: "9001",
      body: "  hello <Nate>\nsecond line  ",
      occurredAtMs: 1_800_000_000_123,
      participants: [
        { address: "+1 (555) 010-0200", displayName: "Alex" },
        { address: "+1 (555) 010-0200", displayName: "Duplicate" },
      ],
    }],
  }));

  assert.equal(normalized.correspondence[0].body, "  hello &lt;Nate&gt;<br>second line  ");
  assert.deepEqual(normalized.correspondence[0].participants, [{
    addressValue: "+1 (555) 010-0200",
    displayName: "Alex",
  }]);
});

test("Android correspondence normalization rejects unsafe identities and duplicate records", () => {
  assert.throws(() => normalizeAndroidSyncBatch(batch({
    correspondence: [{
      medium: "sms", direction: "inbound", externalId: "not-ascii-☃",
      occurredAtMs: 1_800_000_000_123,
    }],
  })), CorrespondenceSyncInputError);

  const item = {
    medium: "call", direction: "inbound", externalId: "44",
    callDisposition: "missed", callDurationSeconds: 0, occurredAtMs: 1_800_000_000_123,
  };
  assert.throws(() => normalizeAndroidSyncBatch(batch({ correspondence: [item, item] })), {
    message: "A synchronization batch cannot contain duplicate correspondence identities.",
  });
});
