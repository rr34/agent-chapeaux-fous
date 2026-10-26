import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { CorrespondenceSyncService } from "../src/correspondence-sync.mjs";
import { temporaryDatabase } from "./helpers.mjs";

function phoneBatch() {
  return {
    protocol: "timev3.android-correspondence-sync",
    version: 1,
    deviceId: "0123456789abcdef0123456789abcdef",
    contacts: [{
      externalId: "android-lookup-æ",
      updatedAtMs: 1_800_000_000_000,
      displayName: "Alex Rivera",
      givenName: "Alex",
      familyName: "Rivera",
      organizationName: null,
      methods: [
        { kind: "phone", label: "Mobile", value: "+1 (555) 010-0200", isPrimary: true },
        { kind: "email", label: "Personal", value: "Alex@Example.test", isPrimary: true },
      ],
    }],
    correspondence: [
      {
        medium: "sms", direction: "inbound", account: "sim_1", threadKey: "sms:7",
        externalId: "101", body: "  hello <Nate>\nagain  ", deliveryStatus: "delivered",
        providerStatus: "android:sms:inbox:-1", occurredAtMs: 1_800_000_000_123,
        receivedAtMs: 1_800_000_000_123,
        participants: [{ address: "+1 (555) 010-0200", displayName: "Alex Rivera" }],
      },
      {
        medium: "call", direction: "inbound", account: "default", externalId: "102",
        callDisposition: "missed", callDurationSeconds: 0,
        providerStatus: "android:call:missed", occurredAtMs: 1_800_000_001_000,
        participants: [{ address: "+1 (555) 010-0200", displayName: "Alex Rivera" }],
      },
      {
        medium: "mms", direction: "outbound", account: "sim_1", threadKey: "mms:8",
        externalId: "103", body: "group note", deliveryStatus: "sent",
        providerStatus: "android:mms:box_2:type_128", occurredAtMs: 1_800_000_002_000,
        participants: [{ address: "+1 (555) 010-0200" }, { address: "+1 (555) 010-0300" }],
      },
    ],
  };
}

test("phone synchronization atomically imports contacts and replay-safe correspondence", (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const service = new CorrespondenceSyncService({ databaseTarget: temporary.target });
  context.after(() => service.close());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const database = store.requireReady();

  const first = service.synchronize(phoneBatch());
  assert.deepEqual(first.contacts, {
    received: 1, created: 1, updated: 0, matched: 0,
    observationsCreated: 1, methodsCreated: 2,
  });
  assert.deepEqual(first.correspondence, {
    received: 3, created: 3, updated: 0, deduplicated: 0,
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM correspondence").get().count, 3);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM correspondence_participants_join").get().count, 4);
  assert.equal(
    database.prepare("SELECT body FROM correspondence WHERE medium = 'sms'").get().body,
    "  hello &lt;Nate&gt;<br>again  ",
  );
  const participants = database.prepare(`
    SELECT address_value, contact_id, contact_method_id
    FROM correspondence_participants_join
    WHERE correspondence_id = (SELECT correspondence_id FROM correspondence WHERE medium = 'mms')
    ORDER BY address_value
  `).all();
  assert.ok(participants[0].contact_id);
  assert.ok(participants[0].contact_method_id);
  assert.equal(participants[1].contact_id, null);

  const replay = service.synchronize(phoneBatch());
  assert.deepEqual(replay.contacts, {
    received: 1, created: 0, updated: 0, matched: 0,
    observationsCreated: 0, methodsCreated: 0,
  });
  assert.deepEqual(replay.correspondence, {
    received: 3, created: 0, updated: 3, deduplicated: 0,
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM correspondence").get().count, 3);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contacts").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM activity_events WHERE event_type = 'correspondence.sync'").get().count, 2);
  assert.deepEqual(service.status(phoneBatch().deviceId).media, [
    { medium: "call", count: 1, latestAtUtc: "2027-01-15T08:00:01.000Z" },
    { medium: "mms", count: 1, latestAtUtc: "2027-01-15T08:00:02.000Z" },
    { medium: "sms", count: 1, latestAtUtc: "2027-01-15T08:00:00.123Z" },
  ]);

  const oldPhone = structuredClone(phoneBatch());
  oldPhone.deviceId = "fedcba9876543210fedcba9876543210";
  for (const item of oldPhone.correspondence) item.externalId = `old-${item.externalId}`;
  const crossDevice = service.synchronize(oldPhone);
  assert.deepEqual(crossDevice.correspondence, {
    received: 3, created: 0, updated: 0, deduplicated: 3,
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM correspondence").get().count, 3);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM correspondence_source_aliases").get().count, 3);
  assert.deepEqual(service.status(oldPhone.deviceId).media, [
    { medium: "call", count: 1, latestAtUtc: "2027-01-15T08:00:01.000Z" },
    { medium: "mms", count: 1, latestAtUtc: "2027-01-15T08:00:02.000Z" },
    { medium: "sms", count: 1, latestAtUtc: "2027-01-15T08:00:00.123Z" },
  ]);

  const oldPhoneReplay = service.synchronize(oldPhone);
  assert.deepEqual(oldPhoneReplay.correspondence, {
    received: 3, created: 0, updated: 3, deduplicated: 0,
  });
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM correspondence_source_aliases").get().count, 3);
});

test("phone contact observations rename one matched canonical contact and reject older names", (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const service = new CorrespondenceSyncService({ databaseTarget: temporary.target });
  context.after(() => service.close());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const database = store.requireReady();

  database.prepare(`
    INSERT INTO contacts (display_name, given_name, family_name, source, updated_at_utc)
    VALUES ('Jon Smyth', 'Jon', 'Smyth', 'agent', '2027-01-01T00:00:00.000Z')
  `).run();
  database.prepare(`
    INSERT INTO contact_methods (
      contact_id, method_kind, label, value, normalized_value, is_primary, can_receive
    ) VALUES (1, 'phone', 'Mobile', '+1 (555) 010-0200', '15550100200', 1, 1)
  `).run();

  const synchronized = service.synchronize({
    protocol: "timev3.android-correspondence-sync",
    version: 1,
    deviceId: "0123456789abcdef0123456789abcdef",
    contacts: [{
      externalId: "phone-contact-1",
      updatedAtMs: 1_800_000_000_000,
      displayName: "John Smith",
      givenName: "John",
      familyName: "Smith",
      organizationName: null,
      methods: [{ kind: "phone", label: "Mobile", value: "+1 (555) 010-0200", isPrimary: true }],
    }],
    correspondence: [],
  });
  assert.deepEqual(synchronized.contacts, {
    received: 1, created: 0, updated: 1, matched: 1,
    observationsCreated: 1, methodsCreated: 0,
  });
  assert.deepEqual(database.prepare(`
    SELECT display_name, given_name, family_name FROM contacts WHERE contact_id = 1
  `).get(), { display_name: "John Smith", given_name: "John", family_name: "Smith" });

  const olderPhone = service.synchronize({
    protocol: "timev3.android-correspondence-sync",
    version: 1,
    deviceId: "fedcba9876543210fedcba9876543210",
    contacts: [{
      externalId: "old-phone-contact-9",
      updatedAtMs: 1_700_000_000_000,
      displayName: "Jon Smyth",
      givenName: "Jon",
      familyName: "Smyth",
      organizationName: null,
      methods: [{ kind: "phone", label: "Mobile", value: "15550100200", isPrimary: true }],
    }],
    correspondence: [],
  });
  assert.deepEqual(olderPhone.contacts, {
    received: 1, created: 0, updated: 0, matched: 1,
    observationsCreated: 1, methodsCreated: 0,
  });
  assert.equal(
    database.prepare("SELECT display_name FROM contacts WHERE contact_id = 1").get().display_name,
    "John Smith",
  );
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contact_source_aliases").get().count, 2);
});
