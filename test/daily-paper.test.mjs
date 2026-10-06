import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DailyPaperService, mondayOnOrBefore, normalizeInput } from "../src/daily-paper.mjs";

function events() {
  const openTodo = {
    todoId: 17,
    title: "Bring the annotated draft",
    description: null,
    status: "todo",
    relationshipKind: "work",
    groupId: 4,
    groupName: "Writing",
    groupSortPosition: 2,
    sequence: 12,
    sortPosition: 3,
    relatedContact: { contactId: 8, displayName: "Jane Smith" },
  };
  return [
    {
      id: 1,
      title: "Planning breakfast",
      description: "Decide the next experiment.",
      location: "Kitchen table",
      startsAtUtc: "2026-10-04T13:00:00.000Z",
      endsAtUtc: "2026-10-04T14:00:00.000Z",
      timeZone: "America/New_York",
      isAllDay: false,
      status: "confirmed",
      linkedTodos: [openTodo, { todoId: 18, title: "Finished already", status: "complete" }],
    },
    {
      id: 2,
      title: "Review the draft",
      startsAtUtc: "2026-10-04T18:00:00.000Z",
      endsAtUtc: "2026-10-04T19:00:00.000Z",
      timeZone: "America/New_York",
      isAllDay: false,
      status: "confirmed",
      linkedTodos: [{ ...openTodo, relationshipKind: "deadline" }],
    },
    {
      id: 3,
      title: "Tomorrow's work",
      startsAtUtc: "2026-10-05T16:00:00.000Z",
      endsAtUtc: "2026-10-05T17:00:00.000Z",
      timeZone: "America/New_York",
      isAllDay: false,
      status: "confirmed",
      linkedTodos: [],
    },
  ];
}

test("daily paper starts its two-week grid on Monday and selects today's timeline and to-dos", () => {
  let calendarRange;
  let trackerRequest;
  const service = new DailyPaperService({
    organizer: { listCalendar(range) { calendarRange = range; return events(); } },
    trackerSchedule: { scheduledTrackersForDay(input) {
      trackerRequest = input;
      return [{
        trackerId: 31,
        ref: "agent-slayer://journal-trackers/31",
        name: "Weight",
        groupName: "Health",
        unit: "kg",
        frequency: "daily",
        interval: 1,
        periodStartsAtUtc: "2026-10-04T04:00:00.000Z",
        periodEndsAtUtc: "2026-10-05T04:00:00.000Z",
        logged: false,
      }];
    } },
    ledger: {},
    mediaRoot: "/tmp/unused-daily-paper",
    publicUrl: "http://127.0.0.1:8787",
    timeZone: () => "America/New_York",
  });

  const model = service.build({ date: "2026-10-04" });
  assert.equal(mondayOnOrBefore(model.date), "2026-09-28");
  assert.equal(model.calendarDays.length, 14);
  assert.equal(model.calendarDays[0].localDate, "2026-09-28");
  assert.equal(model.calendarDays.at(-1).localDate, "2026-10-11");
  assert.equal(model.calendarDays.filter(({ isToday }) => isToday).length, 1);
  assert.equal(model.heading, "Sun, 4 Oct 2026");
  assert.equal(model.rangeHeading, "28 Sep - 11 Oct 2026");
  assert.deepEqual(model.todayEvents.map(({ id }) => id), [1, 2]);
  assert.deepEqual(model.scheduledTodos, [{
    todoId: 17,
    title: "Bring the annotated draft",
    description: null,
    status: "todo",
    relationshipKind: "work",
    groupId: 4,
    groupName: "Writing",
    groupSortPosition: 2,
    sequence: 12,
    sortPosition: 3,
    relatedContact: { contactId: 8, displayName: "Jane Smith" },
    eventTitles: ["Planning breakfast", "Review the draft"],
    eventLinks: [{
      eventId: 1,
      title: "Planning breakfast",
      startsAtUtc: "2026-10-04T13:00:00.000Z",
      isAllDay: false,
      relationshipKind: "work",
    }, {
      eventId: 2,
      title: "Review the draft",
      startsAtUtc: "2026-10-04T18:00:00.000Z",
      isAllDay: false,
      relationshipKind: "deadline",
    }],
  }]);
  assert.deepEqual(model.printableTodoGroups.map(({ id, name, dailyPaperPinned, todos }) => ({
    id, name, dailyPaperPinned, todoIds: todos.map(({ todoId }) => todoId),
  })), [{ id: 4, name: "Writing", dailyPaperPinned: false, todoIds: [17] }]);
  assert.deepEqual(trackerRequest, { localDate: "2026-10-04", timeZone: "America/New_York" });
  assert.equal(model.scheduledTrackers.length, 1);
  assert.equal(model.scheduledTrackers[0].name, "Weight");
  assert.equal(model.scheduledTrackers[0].frequency, "daily");
  assert.equal(model.scheduledTrackers[0].logged, false);
  assert.deepEqual(calendarRange, {
    from: "2026-09-28T04:00:00.000Z",
    to: "2026-10-12T04:00:00.000Z",
  });
});

test("daily paper includes pinned groups, their open tasks, and empty group containers", () => {
  const service = new DailyPaperService({
    organizer: {
      listCalendar: () => events(),
      listDailyPaperTodoGroups: () => [{
        id: 4, name: "Writing", sortPosition: 2, dailyPaperPinned: true,
        todos: [{
          id: 17, text: "Bring the annotated draft", status: "todo",
          groupId: 4, sequence: 12, sortPosition: 3,
          relatedContactId: 8, relatedContactName: "Jane Smith",
        }],
      }, {
        id: 5, name: "Shopping", sortPosition: 3, dailyPaperPinned: true,
        todos: [{
          id: 19, text: "Coffee beans", status: "todo", groupId: 5,
          sequence: null, sortPosition: 1, relatedContactId: null,
        }],
      }, {
        id: 6, name: "Packing", sortPosition: 4, dailyPaperPinned: true, todos: [],
      }],
    },
    ledger: {},
    mediaRoot: "/tmp/unused-daily-paper",
    publicUrl: "http://127.0.0.1:8787",
    timeZone: () => "America/New_York",
  });

  const model = service.build({ date: "2026-10-04" });
  assert.deepEqual(model.printableTodoGroups.map(({ name, dailyPaperPinned, todos }) => ({
    name, dailyPaperPinned, todoIds: todos.map(({ todoId }) => todoId),
  })), [
    { name: "Writing", dailyPaperPinned: true, todoIds: [17] },
    { name: "Shopping", dailyPaperPinned: true, todoIds: [19] },
    { name: "Packing", dailyPaperPinned: true, todoIds: [] },
  ]);
  assert.equal(model.printableTodoGroups[0].todos[0].eventLinks.length, 2);
});

test("daily paper validates physical-page inputs", () => {
  assert.throws(() => normalizeInput({ date: "2026-02-30" }), /valid calendar date/);
  assert.throws(() => normalizeInput({ date: "2026-10-04", timeZone: "Mars/Olympus" }), /IANA time zone/);
  assert.throws(() => normalizeInput({ date: "2026-10-04", paperSize: "legal" }), /letter or a4/);
  assert.equal(normalizeInput({ date: "2026-10-04", paperSize: "A4" }).paperSize, "a4");
});

test("daily paper can move its visible range without changing the selected day", () => {
  const ranges = [];
  const service = new DailyPaperService({
    organizer: { listCalendar(range) { ranges.push(range); return events(); } },
    ledger: {},
    mediaRoot: "/tmp/unused-daily-paper",
    publicUrl: "http://127.0.0.1:8787",
    timeZone: () => "America/New_York",
  });

  const model = service.build({ date: "2026-10-04", rangeDate: "2026-10-19" });
  assert.equal(model.date, "2026-10-04");
  assert.equal(model.rangeDate, "2026-10-19");
  assert.equal(model.calendarDays[0].localDate, "2026-10-19");
  assert.equal(model.calendarDays.at(-1).localDate, "2026-11-01");
  assert.deepEqual(model.todayEvents.map(({ id }) => id), [1, 2]);
  assert.equal(ranges.length, 2);
  assert.deepEqual(ranges[1], {
    from: "2026-10-04T04:00:00.000Z",
    to: "2026-10-05T04:00:00.000Z",
  });
});

test("PDF generation registers the rendered document and its provenance", async (context) => {
  const mediaRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-slayer-daily-paper-"));
  context.after(() => fsp.rm(mediaRoot, { recursive: true, force: true }));
  const registrations = [];
  const activity = [];
  const ledger = {
    registerFile(input) {
      registrations.push(input);
      return { fileId: 91, originalFilename: input.originalFilename, mimeType: input.mimeType, byteSize: input.byteSize, storagePath: input.storagePath, duplicate: false };
    },
    append(input) { activity.push(input); return "daily-paper-event"; },
    eventSequence(eventId) { assert.equal(eventId, "daily-paper-event"); return 452; },
  };
  let renderInput;
  const service = new DailyPaperService({
    organizer: { listCalendar: () => events() },
    ledger,
    mediaRoot,
    publicUrl: "http://127.0.0.1:9123",
    accessToken: "private-token",
    timeZone: () => "America/New_York",
    renderPdf: async (input) => {
      renderInput = input;
      await fsp.writeFile(input.filename, Buffer.from("%PDF-1.7\nfixture\n%%EOF\n"));
    },
  });

  const result = await service.generate({ date: "2026-10-04", paperSize: "letter" }, { requestId: "request-1", callId: "call-1" });
  assert.match(renderInput.url, /^http:\/\/127\.0\.0\.1:9123\/app\?paper=daily&/);
  assert.equal(renderInput.accessToken, "private-token");
  assert.equal(renderInput.format, "Letter");
  assert.equal(registrations.length, 1);
  assert.match(registrations[0].storagePath, /^media\/\d{4}\/\d{2}\/[0-9a-f-]+\.pdf$/);
  assert.equal(registrations[0].mimeType, "application/pdf");
  assert.equal(registrations[0].sha256.length, 64);
  assert.equal(activity[0].type, "daily-paper.generated");
  assert.equal(activity[0].primaryFileId, 91);
  assert.deepEqual(result.file.sourceEventSeqs, [452]);
  assert.equal(registrations[0].originalFilename, "cf-clipboard-app-2026-10-04.pdf");
  assert.equal(result.file.ref, "agent-slayer://files/91");
  assert.equal(result.file.downloadUrl, "/api/files/91/download");
});

test("a missing server browser returns an actionable PDF error and removes its partial file", async (context) => {
  const mediaRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-slayer-daily-paper-browser-"));
  context.after(() => fsp.rm(mediaRoot, { recursive: true, force: true }));
  const service = new DailyPaperService({
    organizer: { listCalendar: () => events() },
    ledger: {},
    mediaRoot,
    publicUrl: "http://127.0.0.1:9123",
    renderPdf: async ({ filename }) => {
      await fsp.writeFile(filename, "partial");
      throw new Error("browserType.launch: Executable doesn't exist at /missing/chromium");
    },
  });

  await assert.rejects(
    service.generate({ date: "2026-10-04" }),
    (error) => {
      assert.equal(error.statusCode, 503);
      assert.match(error.message, /npm run install:pdf-browser/);
      return true;
    },
  );
  const entries = await fsp.readdir(mediaRoot, { recursive: true });
  assert.equal(entries.some((entry) => String(entry).endsWith(".pdf")), false);
});
