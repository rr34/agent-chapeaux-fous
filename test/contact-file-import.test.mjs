import assert from "node:assert/strict";
import test from "node:test";
import { parseContactAttachment } from "../src/contact-file-import.mjs";

test("vCard whole-file parsing unfolds lines and preserves grouped methods and categories", () => {
  const text = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "UID:alice-1",
    "FN:Alice Example",
    "N:Example;Alice;;;",
    "ORG:Example Co.;Research",
    "item1.EMAIL;TYPE=WORK,PREF:alice@example.test",
    "TEL;TYPE=CELL:+1 555 010 1000",
    "CATEGORIES:Friend,Research",
    "NOTE:Long note that is ",
    " folded onto another line",
    "END:VCARD",
    "",
  ].join("\r\n");
  const parsed = parseContactAttachment({ filename: "contacts.vcf", text }, {
    format: "auto",
    csvMapping: null,
    defaultTags: ["Imported"],
  });
  assert.equal(parsed.format, "vcard");
  assert.equal(parsed.entries.length, 1);
  assert.deepEqual(parsed.entries[0], {
    external_id: "alice-1",
    contact_kind: "person",
    display_name: "Alice Example",
    given_name: "Alice",
    family_name: "Example",
    organization_name: "Example Co. / Research",
    status: "active",
    birth_date: null,
    notes: "Long note that is folded onto another line",
    methods: [
      {
        method_kind: "email", label: "WORK, PREF", value: "alice@example.test",
        is_primary: true, can_receive: true,
      },
      {
        method_kind: "phone", label: "CELL", value: "+1 555 010 1000",
        is_primary: false, can_receive: true,
      },
    ],
    tags: ["Imported", "Friend", "Research"],
  });
});

test("CSV whole-file parsing rejects mappings that do not match exact headers", () => {
  assert.throws(
    () => parseContactAttachment({ filename: "contacts.csv", text: "Name,Email\nAlice,a@example.test\n" }, {
      format: "csv",
      csvMapping: {
        external_id_column: null,
        external_id_strategy: "row_hash",
        external_id_prefix: "hash-",
        display_name_column: "Full Name",
        given_name_column: null,
        family_name_column: null,
        organization_name_column: null,
        birth_date_column: null,
        notes_columns: [],
        tag_columns: [],
        tag_separator: null,
        methods: [],
        default_contact_kind: "person",
        default_status: "active",
      },
      defaultTags: [],
    }),
    /missing columns: Full Name/,
  );
});

test("CSV row-hash IDs survive row reordering and normalize common birthday forms", () => {
  const mapping = {
    external_id_column: null,
    external_id_strategy: "row_hash",
    external_id_prefix: "hash-",
    display_name_column: "Name",
    given_name_column: null,
    family_name_column: null,
    organization_name_column: null,
    birth_date_column: "Birthday",
    notes_columns: [],
    tag_columns: [],
    tag_separator: null,
    methods: [],
    default_contact_kind: "person",
    default_status: "active",
  };
  const first = parseContactAttachment({
    filename: "contacts.csv",
    text: "Name,Birthday\nAlice,1/2/1980\nBob,3/4\n",
  }, { format: "csv", csvMapping: mapping, defaultTags: [] });
  const reordered = parseContactAttachment({
    filename: "contacts.csv",
    text: "Name,Birthday\nBob,3/4\nAlice,1/2/1980\n",
  }, { format: "csv", csvMapping: mapping, defaultTags: [] });
  const firstIds = Object.fromEntries(first.entries.map((entry) => [entry.display_name, entry.external_id]));
  const reorderedIds = Object.fromEntries(reordered.entries.map((entry) => [entry.display_name, entry.external_id]));
  assert.deepEqual(firstIds, reorderedIds);
  assert.deepEqual(first.entries.map(({ birth_date: value }) => value), ["1980-01-02", "--03-04"]);
});
