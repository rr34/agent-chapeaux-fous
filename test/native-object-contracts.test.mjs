import assert from "node:assert/strict";
import test from "node:test";
import { objectDescriptionMetadataKey } from "../src/object-description.mjs";
import { objectInputBindingsMetadataKey } from "../src/object-input-bindings.mjs";
import {
  nativeFirstClassObjectTypes, normalizeNativeIdentityScalars,
} from "../src/native-object-types.mjs";
import {
  objectReferenceGroupsFromToolResult, objectReferenceProtectedFields,
} from "../src/object-references.mjs";
import { requestCapabilityCatalog } from "../src/request-compiler.mjs";
import { registerCalendarTools } from "../src/tools/calendar-tools.mjs";
import { registerCatchUpTools } from "../src/tools/catch-up-tools.mjs";
import { registerContactTools } from "../src/tools/contact-tools.mjs";
import { registerFileTools } from "../src/tools/file-tools.mjs";
import { registerJournalTools } from "../src/tools/journal-tools.mjs";
import { registerJmapEmailTools } from "../src/tools/jmap-email-tools.mjs";
import { registerProfileFactTools } from "../src/tools/profile-fact-tools.mjs";
import { registerPaymentTools } from "../src/tools/payment-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerTodoTools } from "../src/tools/todo-tools.mjs";
import { registerVideoScriptTools } from "../src/tools/video-script-tools.mjs";

function nativeRegistry() {
  const registry = new ToolRegistry();
  registerCalendarTools(registry, null, null, null);
  registerContactTools(registry, null, null, null);
  registerTodoTools(registry, null, null);
  registerPaymentTools(registry, null, null);
  registerJournalTools(registry, null, null);
  registerProfileFactTools(registry, null);
  registerCatchUpTools(registry, null);
  registerFileTools(registry, {
    ledger: null, searchCoordinator: null, mediaRoot: "/tmp", maximumTextBytes: 1,
  });
  registerJmapEmailTools(registry, {
    health: () => ({ ready: true }),
    publicSession: () => ({ selectedAccountId: "account1", accounts: { account1: { name: "Personal" } } }),
  });
  registerVideoScriptTools(registry, {
    get: () => null,
    create: () => null,
    selectedInteractionContext: () => ({ data: { sources: [] }, text: "" }),
  }, {
    videoContent: { list: () => null, add: () => null, listGroups: () => [] },
  });
  return registry;
}

function objectTypes(definition) {
  return definition.metadata?.[objectDescriptionMetadataKey]?.types.map(({ id }) => id) ?? [];
}

function schemaPropertyPaths(schema, path = "", output = []) {
  if (!schema || typeof schema !== "object") return output;
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const childPath = `${path}/${name}`;
    output.push({ name, path: childPath });
    schemaPropertyPaths(child, childPath, output);
  }
  if (schema.items) schemaPropertyPaths(schema.items, `${path}/*`, output);
  for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) {
    schemaPropertyPaths(branch, path, output);
  }
  return output;
}

test("native authoritative reads publish the same Object Description contract as MCP reads", () => {
  const registry = nativeRegistry();
  const definitions = new Map(registry.toolDefinitions().map((definition) => [definition.name, definition]));
  assert.deepEqual(objectTypes(definitions.get("contact_search")), ["contacts.contact", "contacts.method"]);
  assert.deepEqual(objectTypes(definitions.get("todo_group_list")), ["todos.todo_group"]);
  assert.deepEqual(objectTypes(definitions.get("todo_list")), ["todos.personal_task"]);
  assert.deepEqual(objectTypes(definitions.get("payment_invoice_list")), ["payments.invoice"]);
  assert.deepEqual(objectTypes(definitions.get("tracker_list")), ["journal.group", "journal.tracker"]);
  assert.deepEqual(objectTypes(definitions.get("journal_list")), ["journal.entry"]);
  assert.deepEqual(objectTypes(definitions.get("calendar_event_search")), ["calendar.event"]);
  assert.deepEqual(objectTypes(definitions.get("calendar_routine_list")), ["calendar.routine"]);
  assert.deepEqual(objectTypes(definitions.get("file_get")), ["files.file"]);
  assert.deepEqual(objectTypes(definitions.get("profile_fact_list")), ["profile.fact"]);
  assert.deepEqual(objectTypes(definitions.get("catch_up_list")), ["catch_up.question"]);
  assert.deepEqual(objectTypes(definitions.get("email_account_list")), ["email.account"]);
  assert.deepEqual(objectTypes(definitions.get("email_mailbox_list")), ["email.mailbox"]);
  assert.deepEqual(objectTypes(definitions.get("email_identity_list")), ["email.identity"]);
  assert.deepEqual(objectTypes(definitions.get("email_search")), ["email.message"]);
  assert.deepEqual(objectTypes(definitions.get("email_thread_get")), ["email.thread"]);
  assert.deepEqual(objectTypes(definitions.get("email_get")), ["email.blob"]);
  assert.deepEqual(objectTypes(definitions.get("video_script_get")), ["video.script"]);
  assert.deepEqual(objectTypes(definitions.get("video_content_list")), [
    "video.content_group", "video.content_item",
  ]);
  for (const definition of definitions.values()) {
    assert.equal(definition.nativeObjectTypes, undefined);
    assert.equal(definition.allowUnboundObjectInputs, undefined);
    assert.equal(definition.nativeObjectInputRoles, undefined);
  }

  const catalogTypes = requestCapabilityCatalog(registry.toolDefinitions())
    .flatMap(({ objectTypes: types }) => types.map(({ id, readTool }) => `${id}:${readTool}`));
  assert.ok(catalogTypes.includes("contacts.contact:contact_search"));
  assert.ok(catalogTypes.includes("todos.personal_task:todo_list"));
  assert.ok(catalogTypes.includes("payments.invoice:payment_invoice_list"));
  assert.ok(catalogTypes.includes("files.file:file_get"));
  assert.ok(catalogTypes.includes("catch_up.question:catch_up_list"));
  assert.ok(catalogTypes.includes("email.message:email_search"));
  assert.ok(catalogTypes.includes("email.blob:email_get"));
  assert.ok(catalogTypes.includes("video.script:video_script_get"));
  assert.ok(catalogTypes.includes("video.content_group:video_content_list"));
  const catalogTools = requestCapabilityCatalog(registry.toolDefinitions())
    .flatMap(({ tools }) => tools);
  assert.deepEqual(catalogTools.find(({ name }) => name === "contact_merge").objectRoles, [
    { role: "merge_destination", objectType: "contacts.contact" },
    { role: "merge_source", objectType: "contacts.contact" },
  ]);
  assert.equal(catalogTools.find(({ name }) => name === "todo_update").objectRoles, undefined);
});

test("the reviewed native catalog exhaustively covers every declared producer and consumer", () => {
  const definitions = nativeRegistry().toolDefinitions();
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  for (const type of nativeFirstClassObjectTypes) {
    assert.ok(
      objectTypes(byName.get(type.readTool)).includes(type.id),
      `${type.id} is published on ${type.readTool}`,
    );
    for (const inputField of type.inputFields) {
      const consumers = definitions.flatMap((definition) => schemaPropertyPaths(definition.inputSchema)
        .filter(({ name }) => name === inputField)
        .map(({ path }) => ({ definition, path: `${path}${inputField.endsWith("_ids") ? "/*" : ""}` })));
      assert.ok(consumers.length, `${type.id} input field ${inputField} exists on a native tool`);
      for (const { definition, path } of consumers) {
        const bindings = definition.metadata?.[objectInputBindingsMetadataKey]?.bindings ?? [];
        assert.ok(bindings.some((binding) => (
          binding.path === path && binding.objectType === type.id && binding.value === "id"
        )), `${definition.name} ${path} binds ${type.id}`);
      }
    }
  }
});

test("native object types explicitly distinguish integer primary keys from opaque string IDs", () => {
  const stringTypes = nativeFirstClassObjectTypes
    .filter(({ idKind }) => idKind === "string")
    .map(({ id }) => id);
  assert.deepEqual(stringTypes, [
    "email.account", "email.mailbox", "email.identity",
    "email.message", "email.thread", "email.blob",
  ]);
  assert.ok(nativeFirstClassObjectTypes.every(({ idKind }) => (
    idKind === "integer" || idKind === "string"
  )));
  assert.deepEqual(normalizeNativeIdentityScalars({
    calendar_event_id: "3113",
    contact_id: "578",
    run_id: "0007",
    email_id: "123",
  }), {
    calendar_event_id: 3113,
    contact_id: 578,
    run_id: "0007",
    email_id: "123",
  });
});

test("native ID consumers publish bindings for singleton and batch inputs", () => {
  const definitions = new Map(nativeRegistry().toolDefinitions().map((definition) => [definition.name, definition]));
  const bindings = (name) => definitions.get(name).metadata?.[objectInputBindingsMetadataKey]?.bindings ?? [];
  assert.deepEqual(bindings("todo_list"), [{
    path: "/queries/*/personal_task_ids/*", objectType: "todos.personal_task",
    value: "id", role: "subject", allowUnbound: true,
  }]);
  assert.deepEqual(bindings("todo_add"), [
    { path: "/todo_group_id", objectType: "todos.todo_group", value: "id", role: "subject" },
    { path: "/related_contact_id", objectType: "contacts.contact", value: "id", role: "subject" },
  ]);
  assert.deepEqual(bindings("todo_group_daily_paper_pin_set"), [{
    path: "/updates/*/todo_group_id", objectType: "todos.todo_group",
    value: "id", role: "subject",
  }]);
  assert.deepEqual(bindings("todo_content_link_set"), [
    { path: "/personal_task_id", objectType: "todos.personal_task", value: "id", role: "subject" },
    { path: "/content_id", objectType: "video.content_item", value: "id", role: "subject" },
  ]);
  assert.deepEqual(bindings("contact_merge"), [
    { path: "/merges/*/keep_contact_id", objectType: "contacts.contact", value: "id", role: "merge_destination" },
    { path: "/merges/*/merge_contacts/*/contact_id", objectType: "contacts.contact", value: "id", role: "merge_source" },
  ]);
  assert.deepEqual(bindings("contact_update"), [{
    path: "/updates/*/contact_id", objectType: "contacts.contact", value: "id", role: "subject",
  }]);
  assert.deepEqual(bindings("calendar_event_contact_link_set"), [
    { path: "/calendar_event_id", objectType: "calendar.event", value: "id", role: "subject" },
    { path: "/contact_id", objectType: "contacts.contact", value: "id", role: "subject" },
  ]);
  assert.deepEqual(bindings("journal_update"), [
    { path: "/journal_entry_id", objectType: "journal.entry", value: "id", role: "subject" },
  ]);
  assert.deepEqual(bindings("journal_add"), [
    { path: "/tracker_id", objectType: "journal.tracker", value: "id", role: "subject" },
    { path: "/journal_group_id", objectType: "journal.group", value: "id", role: "subject" },
  ]);
  assert.deepEqual(bindings("journal_import"), [
    { path: "/entries/*/tracker_id", objectType: "journal.tracker", value: "id", role: "subject" },
    { path: "/entries/*/journal_group_id", objectType: "journal.group", value: "id", role: "subject" },
  ]);
  assert.deepEqual(bindings("file_update"), [
    { path: "/file_id", objectType: "files.file", value: "id", role: "subject" },
  ]);
  assert.deepEqual(bindings("profile_fact_set"), [
    { path: "/replaces_profile_fact_id", objectType: "profile.fact", value: "id", role: "subject" },
  ]);
  assert.deepEqual(bindings("catch_up_question_update"), [
    { path: "/question_id", objectType: "catch_up.question", value: "id", role: "subject" },
  ]);
  assert.deepEqual(bindings("email_update"), [
    { path: "/account_id", objectType: "email.account", value: "id", role: "subject" },
    { path: "/email_id", objectType: "email.message", value: "id", role: "subject" },
    { path: "/replace_mailbox_ids/*", objectType: "email.mailbox", value: "id", role: "replacement_mailbox" },
    { path: "/add_mailbox_ids/*", objectType: "email.mailbox", value: "id", role: "added_mailbox" },
    { path: "/remove_mailbox_ids/*", objectType: "email.mailbox", value: "id", role: "removed_mailbox" },
  ]);
  assert.deepEqual(bindings("email_send"), [
    { path: "/account_id", objectType: "email.account", value: "id", role: "subject" },
    { path: "/email_id", objectType: "email.message", value: "id", role: "subject" },
    { path: "/identity_id", objectType: "email.identity", value: "id", role: "subject" },
    { path: "/drafts_mailbox_id", objectType: "email.mailbox", value: "id", role: "drafts_mailbox" },
    { path: "/sent_mailbox_id", objectType: "email.mailbox", value: "id", role: "sent_mailbox" },
  ]);
  assert.deepEqual(bindings("email_attachment_get"), [
    { path: "/account_id", objectType: "email.account", value: "id", role: "subject", allowUnbound: true },
    { path: "/blob_id", objectType: "email.blob", value: "id", role: "subject", allowUnbound: true },
  ]);
  assert.deepEqual(bindings("video_script_get"), [
    { path: "/videoScriptId", objectType: "video.script", value: "id", role: "subject", allowUnbound: true },
  ]);
  assert.deepEqual(bindings("video_content_list"), [
    { path: "/groupId", objectType: "video.content_group", value: "id", role: "subject", allowUnbound: true },
  ]);
  assert.deepEqual(bindings("video_content_add"), [
    { path: "/videoScriptId", objectType: "video.script", value: "id", role: "subject" },
    { path: "/groupId", objectType: "video.content_group", value: "id", role: "subject" },
  ]);
  assert.deepEqual(bindings("video_content_create"), [
    { path: "/groupId", objectType: "video.content_group", value: "id", role: "subject" },
  ]);
});

test("native results bind only complete identity and preserve the correct parent display", () => {
  const registry = nativeRegistry();
  const definitions = registry.toolDefinitions();
  const trackerList = definitions.find(({ name }) => name === "tracker_list");
  assert.deepEqual(objectReferenceGroupsFromToolResult({
    toolDefinition: trackerList,
    toolDefinitions: definitions,
    sourceEventSeq: 91,
    result: { trackers: [{
      tracker_id: 14,
      ref: "agent-slayer://journal-trackers/14",
      name: "Push-ups",
      journal_group_id: 5,
      group_ref: "agent-slayer://journal-groups/5",
      group_name: "Exercise",
    }] },
  }), [
    {
      mention: "Journal group returned by tracker_list",
      role: "subject",
      type: "journal.group", source: "native:journal",
      objects: [{ id: 5, ref: "agent-slayer://journal-groups/5", display: "Exercise" }],
      sourceEventSeqs: [91],
    },
    {
      mention: "Journal tracker returned by tracker_list",
      role: "subject",
      type: "journal.tracker", source: "native:journal",
      objects: [{ id: 14, ref: "agent-slayer://journal-trackers/14", display: "Push-ups" }],
      sourceEventSeqs: [91],
    },
  ]);

  const calendarSearch = definitions.find(({ name }) => name === "calendar_event_search");
  const groups = objectReferenceGroupsFromToolResult({
    toolDefinition: calendarSearch,
    toolDefinitions: definitions,
    sourceEventSeq: 92,
    result: { events: [{
      calendar_event_id: "3113", ref: "agent-slayer://calendar-events/3113", title: "Call Lucas",
      linked_todos: [{ personal_task_id: 8, ref: "agent-slayer://todos/8", text: "Prepare notes" }],
      linked_contacts: [
        { contact_id: "578", ref: "agent-slayer://contacts/578", display_name: "Lucas Ruffing" },
        { contact_id: 9 },
      ],
    }] },
  });
  assert.deepEqual(groups.map(({ type, objects }) => [type, objects.map(({ id }) => id)]), [
    ["contacts.contact", [578]], ["todos.personal_task", [8]], ["calendar.event", [3113]],
  ]);

  const contentGroupCreate = definitions.find(({ name }) => name === "video_content_group_create");
  assert.deepEqual(objectReferenceGroupsFromToolResult({
    toolDefinition: contentGroupCreate,
    toolDefinitions: definitions,
    sourceEventSeq: 95,
    result: {
      created: true,
      unchanged: false,
      group: {
        content_group_id: 9,
        content_group_ref: "agent-slayer://content-groups/9",
        content_group_name: "What to Watch",
      },
    },
  }).map(({ type, objects }) => [type, objects]), [
    ["video.content_group", [{
      id: 9, ref: "agent-slayer://content-groups/9", display: "What to Watch",
    }]],
  ]);

  const contentCreate = definitions.find(({ name }) => name === "video_content_create");
  assert.deepEqual(objectReferenceGroupsFromToolResult({
    toolDefinition: contentCreate,
    toolDefinitions: definitions,
    sourceEventSeq: 96,
    result: {
      group: {
        content_group_id: 9,
        content_group_ref: "agent-slayer://content-groups/9",
        content_group_name: "What to Watch",
      },
      createdCount: 1,
      items: [{
        content_id: 31,
        content_ref: "agent-slayer://content-items/31",
        content_title: "What to Watch 1",
      }],
    },
  }).map(({ type, objects }) => [type, objects]), [
    ["video.content_group", [{
      id: 9, ref: "agent-slayer://content-groups/9", display: "What to Watch",
    }]],
    ["video.content_item", [{
      id: 31, ref: "agent-slayer://content-items/31", display: "What to Watch 1",
    }]],
  ]);

  const todoContentLink = definitions.find(({ name }) => name === "todo_content_link_set");
  assert.deepEqual(objectReferenceGroupsFromToolResult({
    toolDefinition: todoContentLink,
    toolDefinitions: definitions,
    sourceEventSeq: 96,
    result: {
      task: {
        personal_task_id: 17, ref: "agent-slayer://todos/17", text: "Review tutorial",
        linked_content: [{
          content_id: 23,
          content_ref: "agent-slayer://content-items/23",
          content_title: "Launch tutorial",
        }],
      },
    },
  }).map(({ type, objects }) => [type, objects]), [
    ["todos.personal_task", [{
      id: 17, ref: "agent-slayer://todos/17", display: "Review tutorial",
    }]],
    ["video.content_item", [{
      id: 23, ref: "agent-slayer://content-items/23", display: "Launch tutorial",
    }]],
  ]);

  const protectedFields = objectReferenceProtectedFields(calendarSearch, definitions);
  for (const field of ["objectRole", "contact_id", "display_name", "personal_task_id", "text", "calendar_event_id", "title", "ref"]) {
    assert.ok(protectedFields.includes(field), `${field} is protected from result projection`);
  }

  const emailSearch = definitions.find(({ name }) => name === "email_search");
  assert.deepEqual(objectReferenceGroupsFromToolResult({
    toolDefinition: emailSearch,
    toolDefinitions: definitions,
    sourceEventSeq: 93,
    result: { messages: [{
      email_id: "M-7", email_ref: "agent-slayer://emails/M-7", email_display: "Quarterly plan",
      raw_message_blob: {
        blob_id: "B-7", blob_ref: "agent-slayer://email-blobs/B-7",
        blob_display: "Quarterly plan raw message",
      },
    }] },
  }).map(({ type, objects }) => [type, objects]), [
    ["email.message", [{ id: "M-7", ref: "agent-slayer://emails/M-7", display: "Quarterly plan" }]],
    ["email.blob", [{
      id: "B-7", ref: "agent-slayer://email-blobs/B-7", display: "Quarterly plan raw message",
    }]],
  ]);

  const contentList = definitions.find(({ name }) => name === "video_content_list");
  assert.deepEqual(objectReferenceGroupsFromToolResult({
    toolDefinition: contentList,
    toolDefinitions: definitions,
    sourceEventSeq: 94,
    result: {
      group: {
        content_group_id: 4, content_group_ref: "agent-slayer://content-groups/4",
        content_group_name: "Promos",
      },
      items: [{
        content_id: 12, content_ref: "agent-slayer://content-items/12",
        content_title: "Launch video",
      }],
    },
  }).map(({ type, objects }) => [type, objects]), [
    ["video.content_group", [{ id: 4, ref: "agent-slayer://content-groups/4", display: "Promos" }]],
    ["video.content_item", [{ id: 12, ref: "agent-slayer://content-items/12", display: "Launch video" }]],
  ]);
});
