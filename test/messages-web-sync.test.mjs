import assert from "node:assert/strict";
import test from "node:test";
import { CorrespondenceService } from "../src/correspondence.mjs";
import { CorrespondenceSyncService } from "../src/correspondence-sync.mjs";
import { SlayerDatabase } from "../src/database.mjs";
import {
  MessagesWebSyncService,
} from "../src/messages-web-sync.mjs";
import { temporaryDatabase } from "./helpers.mjs";

const minute = Date.parse("2027-01-15T08:00:00.000Z");

function webBatch(messages) {
  return {
    protocol: "timev3.google-messages-web-sync",
    version: 1,
    accountKey: "primary",
    syncId: "sync-1",
    messages,
  };
}

function webMessage(overrides = {}) {
  return {
    conversationId: "conversation-1",
    externalId: "web-message-1",
    direction: "inbound",
    transport: "unknown",
    occurredAtMs: minute,
    timestampPrecision: "minute",
    text: "hello",
    deliveryStatus: "delivered",
    threadTitle: "Alex Rivera",
    senderName: "Alex Rivera",
    participants: [{ role: "sender", address: "+1 (555) 010-0200", displayName: "Alex Rivera" }],
    reactions: [{ emoji: "👍", type: "like", by: "Nate" }],
    attachments: [{ kind: "image", name: "photo.jpg" }],
    ...overrides,
  };
}

function phoneBatch() {
  return {
    protocol: "timev3.android-correspondence-sync",
    version: 1,
    deviceId: "0123456789abcdef0123456789abcdef",
    contacts: [{
      externalId: "android-contact-1",
      updatedAtMs: minute,
      displayName: "Alex Rivera",
      givenName: "Alex",
      familyName: "Rivera",
      organizationName: null,
      methods: [{ kind: "phone", label: "Mobile", value: "+1 (555) 010-0200", isPrimary: true }],
    }],
    correspondence: [{
      medium: "sms",
      direction: "inbound",
      account: "sim_1",
      threadKey: "sms:7",
      externalId: "phone-message-1",
      body: "hello",
      deliveryStatus: "delivered",
      providerStatus: "android:sms:inbox:-1",
      occurredAtMs: minute + 37_000,
      receivedAtMs: minute + 37_000,
      participants: [{ address: "+1 (555) 010-0200", displayName: "Alex Rivera" }],
    }],
  };
}

test("Google Messages sync links one precise phone duplicate and retains its source observation", (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const phone = new CorrespondenceSyncService({ databaseTarget: temporary.target });
  const web = new MessagesWebSyncService({ databaseTarget: temporary.target });
  const store = new SlayerDatabase(temporary.target);
  context.after(() => phone.close());
  context.after(() => web.close());
  context.after(() => store.close());

  phone.synchronize(phoneBatch());
  const first = web.synchronize(webBatch([webMessage()]));
  assert.deepEqual(first.messages, {
    received: 1,
    created: 0,
    updated: 0,
    deduplicated: 1,
    ambiguous: 0,
    unresolvedParticipants: 0,
  });

  const database = store.requireReady();
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM correspondence").get().count, 1);
  const alias = database.prepare(`
    SELECT medium, source_account_key, external_id, source_metadata_json
    FROM correspondence_source_aliases
  `).get();
  assert.equal(alias.medium, "sms");
  assert.equal(alias.source_account_key, "google-messages-web:primary");
  assert.equal(alias.external_id, "web-message-1");
  assert.equal(JSON.parse(alias.source_metadata_json).transport, "unknown");
  assert.deepEqual(JSON.parse(alias.source_metadata_json).reactions, [{ by: "Nate", emoji: "👍", type: "like" }]);

  const replay = web.synchronize(webBatch([webMessage({ deliveryStatus: "sent" })]));
  assert.equal(replay.messages.updated, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM correspondence_source_aliases").get().count, 1);

  const correspondence = new CorrespondenceService({ store, ledger: { append() {} }, jmap: null });
  const listed = correspondence.list({ limit: 10 }).items[0];
  assert.equal(listed.source_observations.length, 1);
  assert.equal(listed.source_observations[0].source_metadata.transport, "unknown");
});

test("Google Messages sync stores confirmed RCS independently", (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const web = new MessagesWebSyncService({ databaseTarget: temporary.target });
  const store = new SlayerDatabase(temporary.target);
  context.after(() => web.close());
  context.after(() => store.close());

  const result = web.synchronize(webBatch([webMessage({
    externalId: "rcs-message-1",
    transport: "rcs",
    text: "encrypted RCS",
    attachments: [],
  })]));
  assert.equal(result.messages.created, 1);
  assert.equal(result.messages.deduplicated, 0);
  const row = store.requireReady().prepare(`
    SELECT medium, body, source_account_key, source_metadata_json FROM correspondence
  `).get();
  assert.equal(row.medium, "rcs");
  assert.equal(row.body, "encrypted RCS");
  assert.equal(row.source_account_key, "google-messages-web:primary");
  assert.equal(JSON.parse(row.source_metadata_json).transport, "rcs");
});
