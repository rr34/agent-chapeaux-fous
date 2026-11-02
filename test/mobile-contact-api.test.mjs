import assert from "node:assert/strict";
import test from "node:test";
import { OrganizerStore } from "../src/organizer-store.mjs";

test("mobile contact projection marks aliases for only the requested Android device", () => {
  const contacts = [
    { id: 11, displayName: "Linked Person", methods: [] },
    { id: 12, displayName: "Agent Only", methods: [] },
  ];
  const calls = [];
  const store = {
    listContacts(options) {
      assert.deepEqual(options, { scope: "active", limit: 100, query: "person" });
      return contacts;
    },
    database: {
      prepare(sql) {
        assert.match(sql, /FROM contact_source_aliases/u);
        return {
          all(...values) {
            calls.push(values);
            return [{ contact_id: 11, external_id: "a".repeat(64) }];
          },
        };
      },
    },
  };

  const projected = OrganizerStore.prototype.listMobileContacts.call(store, {
    deviceId: "0123456789ABCDEF0123456789ABCDEF",
    limit: 100,
    query: "person",
  });
  assert.deepEqual(calls, [["android:0123456789abcdef0123456789abcdef", 11, 12]]);
  assert.equal(projected[0].androidContactExternalId, "a".repeat(64));
  assert.equal(projected[1].androidContactExternalId, null);
  assert.throws(
    () => OrganizerStore.prototype.listMobileContacts.call(store, { deviceId: "bad" }),
    /deviceId must be the Android device identifier/u,
  );
});
