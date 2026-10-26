import assert from "node:assert/strict";
import test from "node:test";
import {
  androidCorrespondenceDedupeFingerprint,
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

test("cross-device fingerprints ignore provider identity but preserve communication identity", () => {
  const first = normalizeAndroidSyncBatch(batch({
    correspondence: [{
      medium: "sms", direction: "inbound", account: "sim_1", externalId: "10",
      threadKey: "sms:4", body: "same message", occurredAtMs: 1_800_000_000_123,
      participants: [{ address: "+1 (555) 010-0200", displayName: "Alex" }],
    }],
  })).correspondence[0];
  const second = normalizeAndroidSyncBatch(batch({
    deviceId: "fedcba9876543210fedcba9876543210",
    correspondence: [{
      medium: "sms", direction: "inbound", account: "sim_2", externalId: "999",
      threadKey: "sms:88", body: "same message", occurredAtMs: 1_800_000_000_123,
      participants: [{ address: "15550100200", displayName: "A. Rivera" }],
    }],
  })).correspondence[0];
  assert.equal(
    androidCorrespondenceDedupeFingerprint(first),
    androidCorrespondenceDedupeFingerprint(second),
  );
  assert.notEqual(
    androidCorrespondenceDedupeFingerprint(first),
    androidCorrespondenceDedupeFingerprint({ ...second, body: "different message" }),
  );
});
