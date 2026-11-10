import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { currentPersonId } from "./person-context.mjs";
import {
  localCalendarSnapshot,
  localDateForInstant,
  localDateUtcBounds,
} from "./temporal-consistency.mjs";
import { formatLocalDateRange } from "../public/presentation-format.js";

const DAY_MS = 86_400_000;
const PAPER_SIZES = new Set(["letter", "a4"]);

function dateParts(localDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(localDate ?? ""));
  if (!match) throw Object.assign(new Error("date must use YYYY-MM-DD"), { statusCode: 400 });
  const [year, month, day] = match.slice(1).map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    instant.getUTCFullYear() !== year
    || instant.getUTCMonth() + 1 !== month
    || instant.getUTCDate() !== day
  ) throw Object.assign(new Error("date must be a valid calendar date"), { statusCode: 400 });
  return instant;
}

function addLocalDays(localDate, amount) {
  const instant = dateParts(localDate);
  return new Date(instant.getTime() + amount * DAY_MS).toISOString().slice(0, 10);
}

function mondayOnOrBefore(localDate) {
  const instant = dateParts(localDate);
  const offset = (instant.getUTCDay() + 6) % 7;
  return addLocalDays(localDate, -offset);
}

function isoWeekNumber(localDate) {
  const instant = dateParts(localDate);
  instant.setUTCDate(instant.getUTCDate() + 4 - (instant.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(instant.getUTCFullYear(), 0, 1));
  return Math.ceil((((instant - yearStart) / DAY_MS) + 1) / 7);
}

function weekHeading(startDate, endDate) {
  const start = dateParts(startDate);
  const end = dateParts(endDate);
  const day = (instant) => String(instant.getUTCDate());
  const month = (instant) => new Intl.DateTimeFormat("en-US", {
    month: "short", timeZone: "UTC",
  }).format(instant);
  let range;
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    range = `${day(start)} ${month(start)} ${start.getUTCFullYear()} - ${day(end)} ${month(end)} ${end.getUTCFullYear()}`;
  } else if (start.getUTCMonth() !== end.getUTCMonth()) {
    range = `${day(start)} ${month(start)} - ${day(end)} ${month(end)} ${end.getUTCFullYear()}`;
  } else {
    range = `${day(start)}-${day(end)} ${month(end)} ${end.getUTCFullYear()}`;
  }
  return `Week ${isoWeekNumber(startDate)}: ${range}`;
}

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function normalizeInput(input = {}, defaultTimeZone = "UTC") {
  const timeZone = String(input.timeZone || defaultTimeZone || "UTC").trim();
  if (!validTimeZone(timeZone)) {
    throw Object.assign(new Error("timeZone must be a valid IANA time zone"), { statusCode: 400 });
  }
  const date = String(input.date || localCalendarSnapshot(new Date(), timeZone, 1).localDate);
  dateParts(date);
  const rangeDate = String(input.rangeDate || date);
  dateParts(rangeDate);
  const paperSize = String(input.paperSize || "letter").toLowerCase();
  if (!PAPER_SIZES.has(paperSize)) {
    throw Object.assign(new Error("paperSize must be letter or a4"), { statusCode: 400 });
  }
  return {
    date,
    rangeDate,
    timeZone,
    paperSize,
  };
}

function eventOverlaps(event, bounds, localDate) {
  const start = new Date(event.startsAtUtc).getTime();
  const end = event.endsAtUtc ? new Date(event.endsAtUtc).getTime() : start + 1;
  if (event.isAllDay && Number.isFinite(start)) {
    const timeZone = event.timeZone || "UTC";
    const firstDate = localDateForInstant(start, timeZone);
    const finalDate = localDateForInstant(end > start ? end - 1 : start, timeZone);
    return localDate >= firstDate && localDate <= finalDate;
  }
  return start < new Date(bounds.endsAtUtc).getTime()
    && end > new Date(bounds.startsAtUtc).getTime();
}

function compactEvent(event) {
  return {
    id: event.id,
    title: event.title,
    description: event.description ?? null,
    location: event.location ?? null,
    startsAtUtc: event.startsAtUtc,
    endsAtUtc: event.endsAtUtc ?? null,
    timeZone: event.timeZone ?? null,
    isAllDay: Boolean(event.isAllDay),
    status: event.status,
    ...(event.seriesId != null ? { seriesId: event.seriesId } : {}),
    ...(event.isGeneratedOccurrence ? { isGeneratedOccurrence: true } : {}),
    ...(event.readOnly ? { readOnly: true } : {}),
    linkedContacts: event.linkedContacts ?? [],
  };
}

function compactPinnedTodo(todo, group) {
  return {
    todoId: Number(todo.id),
    text: todo.text,
    status: todo.status,
    groupId: Number(group.id),
    groupName: group.name,
    groupSortPosition: Number(group.sortPosition),
    sequence: todo.sequence == null ? null : Number(todo.sequence),
    sortPosition: Number(todo.sortPosition),
    relatedContact: todo.relatedContactId == null ? null : {
      contactId: Number(todo.relatedContactId),
      displayName: todo.relatedContactName,
    },
  };
}

function buildPrintableTodoGroups(pinnedGroups) {
  return pinnedGroups
    .map((group) => ({
      id: Number(group.id),
      name: group.name,
      sortPosition: Number(group.sortPosition),
      dailyPaperPinned: true,
      todos: (group.todos || []).map((todo) => compactPinnedTodo(todo, group)),
    }))
    .sort((left, right) => left.sortPosition - right.sortPosition || left.name.localeCompare(right.name))
    .map((group) => ({ ...group, todos: [...group.todos] }));
}

function formatLocalDate(localDate, options) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" })
    .format(dateParts(localDate));
}
function normalizedPdfRenderError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/executable doesn't exist|browserType\.launch|failed to launch (?:the )?(?:browser|chromium)/iu.test(message)) {
    return Object.assign(new Error(
      "The PDF browser is unavailable on the server. Run `npm run install:pdf-browser` "
      + "in the deployed checkout, then restart the service. Alternatively configure "
      + "SLAYER_PDF_BROWSER_EXECUTABLE with an installed Chromium executable.",
    ), { statusCode: 503, cause: error });
  }
  return error;
}

async function defaultRenderPdf({ url, filename, accessToken, format, browserExecutable }) {
  const browser = await chromium.launch({
    headless: true,
    ...(browserExecutable ? { executablePath: browserExecutable } : {}),
  });
  try {
    const context = await browser.newContext({
      extraHTTPHeaders: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
    const page = await context.newPage();
    const navigation = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    if (!navigation?.ok()) {
      throw Object.assign(new Error(
        `Weekly paper render page returned HTTP ${navigation?.status() ?? "unknown"}`,
      ), { statusCode: 502 });
    }
    await page.waitForFunction(() => window.__DAILY_PAPER_READY__ === true, null, {
      timeout: 60_000,
    });
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: filename,
      format,
      printBackground: true,
      preferCSSPageSize: true,
      tagged: true,
      outline: true,
    });
    await context.close();
  } finally {
    await browser.close();
  }
}

export class DailyPaperService {
  constructor({
    organizer,
    trackerSchedule = null,
    weather = null,
    ledger,
    mediaRoot,
    publicUrl,
    accessToken = "",
    browserExecutable = null,
    timeZone = () => "UTC",
    renderPdf = defaultRenderPdf,
  }) {
    this.organizer = organizer;
    this.trackerSchedule = trackerSchedule;
    this.weather = weather;
    this.ledger = ledger;
    this.mediaRoot = path.resolve(mediaRoot);
    this.publicUrl = new URL(publicUrl);
    this.accessToken = accessToken;
    this.browserExecutable = browserExecutable;
    this.timeZone = timeZone;
    this.renderPdf = renderPdf;
    this.renderSnapshots = new Map();
  }

  build(input = {}) {
    if (!this.organizer) throw Object.assign(new Error("Calendar storage is unavailable"), { statusCode: 503 });
    const selected = normalizeInput(input, this.timeZone());
    const rangeStartDate = mondayOnOrBefore(selected.rangeDate);
    const dates = Array.from({ length: 14 }, (_, index) => addLocalDays(rangeStartDate, index));
    const rangeStart = localDateUtcBounds({ localDate: dates[0], timeZone: selected.timeZone });
    const rangeEnd = localDateUtcBounds({
      localDate: addLocalDays(dates.at(-1), 1),
      timeZone: selected.timeZone,
    });
    const listedRangeEvents = this.organizer.listCalendar({
      from: rangeStart.startsAtUtc,
      to: rangeEnd.startsAtUtc,
    });
    const rangeEvents = listedRangeEvents.map(compactEvent);
    const calendarDays = dates.map((localDate) => {
      const bounds = localDateUtcBounds({ localDate, timeZone: selected.timeZone });
      return {
        localDate,
        weekday: formatLocalDate(localDate, { weekday: "short" }),
        dayNumber: Number(localDate.slice(-2)),
        month: formatLocalDate(localDate, { month: "short" }),
        isToday: localDate === selected.date,
        events: rangeEvents.filter((event) => eventOverlaps(event, bounds, localDate)),
      };
    });
    const todayBounds = localDateUtcBounds({
      localDate: selected.date,
      timeZone: selected.timeZone,
    });
    const selectedDateIsVisible = selected.date >= dates[0] && selected.date <= dates.at(-1);
    const selectedEvents = selectedDateIsVisible
      ? rangeEvents
      : this.organizer.listCalendar({
        from: todayBounds.startsAtUtc,
        to: todayBounds.endsAtUtc,
      }).map(compactEvent);
    const todayEvents = selectedEvents.filter((event) => eventOverlaps(event, todayBounds, selected.date))
      .sort((left, right) => left.startsAtUtc.localeCompare(right.startsAtUtc));
    const weekStartDate = mondayOnOrBefore(selected.date);
    const weekEndDate = addLocalDays(weekStartDate, 6);
    const printEndDate = addLocalDays(weekStartDate, 13);
    const printDates = Array.from({ length: 14 }, (_, index) => addLocalDays(weekStartDate, index));
    const printRangeIsVisible = weekStartDate >= dates[0] && printEndDate <= dates.at(-1);
    const printEvents = printRangeIsVisible ? rangeEvents : this.organizer.listCalendar({
      from: localDateUtcBounds({ localDate: weekStartDate, timeZone: selected.timeZone }).startsAtUtc,
      to: localDateUtcBounds({ localDate: addLocalDays(printEndDate, 1), timeZone: selected.timeZone }).startsAtUtc,
    }).map(compactEvent);
    const printCalendarDays = printDates.map((localDate) => {
      const bounds = localDateUtcBounds({ localDate, timeZone: selected.timeZone });
      return {
        localDate,
        weekday: formatLocalDate(localDate, { weekday: "short" }),
        dayNumber: Number(localDate.slice(-2)),
        month: formatLocalDate(localDate, { month: "short" }),
        isToday: localDate === selected.date,
        events: printEvents.filter((event) => eventOverlaps(event, bounds, localDate)),
      };
    });
    const scheduledTrackers = this.trackerSchedule?.scheduledTrackersForDay({
      localDate: selected.date,
      timeZone: selected.timeZone,
    }) ?? [];
    const printableTodoGroups = buildPrintableTodoGroups(
      this.organizer.listDailyPaperTodoGroups?.() ?? [],
    );
    return {
      protocol: "agent-slayer.daily-paper",
      version: 1,
      generatedAtUtc: new Date().toISOString(),
      ...selected,
      heading: weekHeading(weekStartDate, weekEndDate),
      rangeHeading: formatLocalDateRange(dates[0], dates.at(-1)),
      weekStartDate,
      weekEndDate,
      weekHeading: weekHeading(weekStartDate, weekEndDate),
      calendarDays,
      printCalendarDays,
      todayEvents,
      printableTodoGroups,
      scheduledTrackers,
      weather: null,
    };
  }

  async buildWithWeather(input = {}) {
    const model = this.build(input);
    if (!this.weather?.read) return model;
    try {
      return { ...model, weather: await this.weather.read({ date: model.date, timeZone: model.timeZone }) };
    } catch {
      return {
        ...model,
        weather: {
          status: "unavailable",
          provider: "Open-Meteo.com",
          fetchedAtUtc: new Date().toISOString(),
          message: "Weather unavailable",
        },
      };
    }
  }

  renderSnapshot(snapshotId) {
    const entry = this.renderSnapshots.get(String(snapshotId ?? ""));
    return entry?.personId === currentPersonId() ? entry.model : null;
  }

  renderSnapshotCapability(snapshotId) {
    return this.renderSnapshots.get(String(snapshotId ?? "")) ?? null;
  }

  async generate(input = {}, context = {}) {
    const model = await this.buildWithWeather(input);
    const now = new Date();
    const relativeDirectory = path.join(
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
    );
    const directory = path.join(this.mediaRoot, relativeDirectory);
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    const storedName = `${randomUUID()}.pdf`;
    const filename = path.join(directory, storedName);
    const snapshotId = randomUUID();
    this.renderSnapshots.set(snapshotId, { personId: currentPersonId(), model });
    const renderUrl = new URL("/app", this.publicUrl);
    renderUrl.searchParams.set("paper", "daily");
    renderUrl.searchParams.set("snapshot", snapshotId);
    try {
      await this.renderPdf({
        url: renderUrl.toString(),
        filename,
        accessToken: this.accessToken,
        browserExecutable: this.browserExecutable,
        format: model.paperSize === "a4" ? "A4" : "Letter",
      });
      const bytes = await fsp.readFile(filename);
      const storagePath = path.posix.join("media", ...relativeDirectory.split(path.sep), storedName);
      const title = `Weekly paper — ${model.weekHeading}`;
      const file = this.ledger.registerFile({
        storagePath,
        originalFilename: `cf-weekly-planner-${model.weekStartDate}.pdf`,
        title,
        description: `Printable weekly calendar and to-do lists for ${model.weekHeading}.`,
        mediaKind: "document",
        mimeType: "application/pdf",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteSize: bytes.length,
      });
      if (file.duplicate && file.storagePath !== storagePath) await fsp.unlink(filename).catch(() => {});
      const eventId = this.ledger.append({
        type: "daily-paper.generated",
        status: "complete",
        actorType: context.actorType || "tool",
        actorName: context.actorName || "daily_paper_generate",
        channel: context.channel || "web",
        turnId: context.requestId || null,
        operationId: context.callId || null,
        name: title,
        primaryFileId: file.fileId,
        subjectType: "file",
        subjectId: String(file.fileId),
        payload: {
          date: model.date,
          timeZone: model.timeZone,
          paperSize: model.paperSize,
          eventCount: model.printCalendarDays.reduce((count, day) => count + day.events.length, 0),
          todoCount: model.printableTodoGroups.reduce((count, group) => count + group.todos.length, 0),
          trackerCount: model.scheduledTrackers.length,
          weatherStatus: model.weather?.status ?? "omitted",
        },
      });
      return {
        model,
        file: {
          ...file,
          ref: `agent-slayer://files/${file.fileId}`,
          sourceEventSeqs: [this.ledger.eventSequence(eventId)].filter(Number.isSafeInteger),
          downloadUrl: `/api/files/${file.fileId}/download`,
        },
      };
    } catch (error) {
      await fsp.unlink(filename).catch(() => {});
      throw normalizedPdfRenderError(error);
    } finally {
      this.renderSnapshots.delete(snapshotId);
    }
  }
}

export { addLocalDays, mondayOnOrBefore, normalizeInput };
