import assert from "node:assert/strict";
import test from "node:test";
import { calendarInviteMessage, createCalendarInviteDraft } from "../src/calendar-invite-draft.mjs";

const event = {
  id: 7,
  title: "Dinner at Bar Velo",
  description: "A table is reserved under Nate.",
  location: "394 Main Street",
  startsAtUtc: "2026-08-20T22:30:00.000Z",
  endsAtUtc: "2026-08-21T00:00:00.000Z",
  timeZone: "America/New_York",
  isAllDay: false,
  status: "active",
  recurrenceRule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=TH;COUNT=3",
};

const contacts = new Map([
  [11, {
    id: 11, displayName: "Alex Rivera", status: "active",
    methods: [
      { kind: "email", value: "old@example.test", isPrimary: false, canReceive: true },
      { kind: "email", value: "alex@example.test", isPrimary: true, canReceive: true },
    ],
  }],
  [12, {
    id: 12, displayName: "Sam Lee", status: "active",
    methods: [{ kind: "email", value: "sam@example.test", isPrimary: true, canReceive: true }],
  }],
]);

test("calendar invitation text uses saved event details without a separate time-zone line", () => {
  const message = calendarInviteMessage(event);
  assert.equal(message.subject, "Invitation: Dinner at Bar Velo");
  assert.match(message.text, /When: Thu, 20 Aug 2026 at 18:30–20:00/);
  assert.doesNotMatch(message.text, /Time zone:/);
  assert.doesNotMatch(message.text, /\b(?:AM|PM)\b/);
  assert.match(message.text, /Repeats: Every week on Thursday for 3 occurrences/);
  assert.match(message.text, /Where: 394 Main Street/);
  assert.match(message.text, /A table is reserved under Nate\./);
  assert.match(message.text, /Please reply to let me know if you can make it\./);
});

test("creating an invitation draft chooses primary receivable emails and never sends", async () => {
  const calls = [];
  const ledgerEvents = [];
  const result = await createCalendarInviteDraft({
    organizer: {
      getCalendar: (id) => id === event.id ? event : null,
      getContact: (id) => contacts.get(id) ?? null,
    },
    createEmailDraft: async (input) => {
      calls.push(input);
      return { created: { draft: { id: "draft-1" } } };
    },
    ledger: { append: (entry) => ledgerEvents.push(entry) },
  }, { calendarEventId: event.id, contactIds: [11, 12, 11] });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].to, [
    { name: "Alex Rivera", email: "alex@example.test" },
    { name: "Sam Lee", email: "sam@example.test" },
  ]);
  assert.equal(calls[0].subject, "Invitation: Dinner at Bar Velo");
  assert.equal(calls[0].attachments.length, 0);
  assert.equal(Object.hasOwn(calls[0], "send_at_utc"), false);
  assert.equal(result.draftEmailId, "draft-1");
  assert.equal(result.recipientCount, 2);
  assert.equal(ledgerEvents[0].type, "calendar.invitation.draft.created");
  assert.equal(ledgerEvents[0].status, "draft");
});

test("invitation drafts reject missing recipients and archived events", async () => {
  const dependencies = {
    organizer: { getCalendar: () => ({ ...event, status: "archived" }), getContact: () => contacts.get(11) },
    createEmailDraft: async () => assert.fail("draft creation must not run"),
  };
  await assert.rejects(
    createCalendarInviteDraft(dependencies, { calendarEventId: 7, contactIds: [11] }),
    /Archived calendar events cannot be invited/,
  );
  await assert.rejects(
    createCalendarInviteDraft(dependencies, { calendarEventId: 7, contactIds: [] }),
    /Choose between 1 and 50 invitation contacts/,
  );
});
