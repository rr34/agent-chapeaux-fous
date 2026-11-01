import assert from "node:assert/strict";
import test from "node:test";
import {
  MessagesWebSyncInputError,
  normalizeMessagesWebSyncBatch,
} from "../src/messages-web-sync.mjs";

const minute = Date.parse("2027-01-15T08:00:00.000Z");

function message(overrides = {}) {
  return {
    conversationId: "conversation-1",
    externalId: "web-message-1",
    direction: "inbound",
    transport: "unknown",
    occurredAtMs: minute,
    timestampPrecision: "minute",
    text: "hello <Nate>\nagain",
    deliveryStatus: "delivered",
    threadTitle: "Alex Rivera",
    senderName: "Alex Rivera",
    participants: [{ role: "sender", address: "+1 (555) 010-0200", displayName: "Alex Rivera" }],
    reactions: [{ emoji: "👍", type: "like", by: "Nate" }],
    attachments: [{ kind: "image", name: "photo.jpg" }],
    providerLabels: ["Alex said hello. Received on January 15, 2027 at 8:00 AM."],
    ...overrides,
  };
}

function batch(messages) {
  return {
    protocol: "timev3.google-messages-web-sync",
    version: 1,
    accountKey: "primary",
    syncId: "sync-1",
    messages,
  };
}

test("Google Messages batch normalization retains complete web observation metadata", () => {
  const normalized = normalizeMessagesWebSyncBatch(batch([message()]));
  assert.equal(normalized.sourceAccountKey, "google-messages-web:primary");
  assert.equal(normalized.messages[0].medium, "chat");
  assert.equal(normalized.messages[0].body, "hello &lt;Nate&gt;<br>again");
  assert.deepEqual(JSON.parse(normalized.messages[0].sourceMetadataJson), {
    attachments: [{ kind: "image", name: "photo.jpg" }],
    group: false,
    protocol: "timev3.google-messages-web-sync",
    providerLabels: ["Alex said hello. Received on January 15, 2027 at 8:00 AM."],
    reactions: [{ by: "Nate", emoji: "👍", type: "like" }],
    senderName: "Alex Rivera",
    threadTitle: "Alex Rivera",
    timestampPrecision: "minute",
    transport: "unknown",
  });
  assert.throws(
    () => normalizeMessagesWebSyncBatch(batch([message({ text: null, attachments: [] })])),
    MessagesWebSyncInputError,
  );
});
