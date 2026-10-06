import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import {
  localCalendarSnapshot,
  localDateUtcBounds,
} from "./temporal-consistency.mjs";
import {
  formatLocalDate as formatPresentationLocalDate,
  formatLocalDateRange,
} from "../public/presentation-format.js";

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
    includeCompletedTodos: input.includeCompletedTodos === true,
  };
}

function eventOverlaps(event, bounds) {
  const start = new Date(event.startsAtUtc).getTime();
  const end = event.endsAtUtc ? new Date(event.endsAtUtc).getTime() : start + 1;
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
    planningState: event.planningState ?? null,
    ...(event.seriesId != null ? { seriesId: event.seriesId } : {}),
    ...(event.isGeneratedOccurrence ? { isGeneratedOccurrence: true } : {}),
    ...(event.readOnly ? { readOnly: true } : {}),
    linkedTodos: event.linkedTodos ?? [],
  };
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
        `Daily paper render page returned HTTP ${navigation?.status() ?? "unknown"}`,
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
    this.ledger = ledger;
    this.mediaRoot = path.resolve(mediaRoot);
    this.publicUrl = new URL(publicUrl);
    this.accessToken = accessToken;
    this.browserExecutable = browserExecutable;
    this.timeZone = timeZone;
    this.renderPdf = renderPdf;
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
    const rangeEvents = this.organizer.listCalendar({
      from: rangeStart.startsAtUtc,
      to: rangeEnd.startsAtUtc,
    }).map(compactEvent);
    const calendarDays = dates.map((localDate) => {
      const bounds = localDateUtcBounds({ localDate, timeZone: selected.timeZone });
      return {
        localDate,
        weekday: formatLocalDate(localDate, { weekday: "short" }),
        dayNumber: Number(localDate.slice(-2)),
        month: formatLocalDate(localDate, { month: "short" }),
        isToday: localDate === selected.date,
        events: rangeEvents.filter((event) => eventOverlaps(event, bounds)),
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
    const todayEvents = selectedEvents.filter((event) => eventOverlaps(event, todayBounds))
      .sort((left, right) => left.startsAtUtc.localeCompare(right.startsAtUtc));
    const scheduledTrackers = this.trackerSchedule?.scheduledTrackersForDay({
      localDate: selected.date,
      timeZone: selected.timeZone,
    }) ?? [];
    const todoMap = new Map();
    for (const event of todayEvents) {
      for (const todo of event.linkedTodos) {
        if (!selected.includeCompletedTodos && todo.status === "complete") continue;
        const current = todoMap.get(Number(todo.todoId)) ?? {
          ...todo,
          todoId: Number(todo.todoId),
          eventTitles: [],
          eventLinks: [],
        };
        if (!current.eventTitles.includes(event.title)) current.eventTitles.push(event.title);
        if (!current.eventLinks.some(({ eventId }) => String(eventId) === String(event.id))) {
          current.eventLinks.push({
            eventId: event.id,
            ...(event.seriesId != null ? { seriesId: event.seriesId } : {}),
            title: event.title,
            startsAtUtc: event.startsAtUtc,
            isAllDay: event.isAllDay,
            relationshipKind: todo.relationshipKind ?? null,
          });
        }
        todoMap.set(current.todoId, current);
      }
    }
    return {
      protocol: "agent-slayer.daily-paper",
      version: 1,
      generatedAtUtc: new Date().toISOString(),
      ...selected,
      heading: formatPresentationLocalDate(selected.date),
      rangeHeading: formatLocalDateRange(dates[0], dates.at(-1)),
      calendarDays,
      todayEvents,
      scheduledTodos: [...todoMap.values()],
      scheduledTrackers,
    };
  }

  async generate(input = {}, context = {}) {
    const model = this.build(input);
    const now = new Date();
    const relativeDirectory = path.join(
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
    );
    const directory = path.join(this.mediaRoot, relativeDirectory);
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    const storedName = `${randomUUID()}.pdf`;
    const filename = path.join(directory, storedName);
    const renderUrl = new URL("/app", this.publicUrl);
    renderUrl.searchParams.set("paper", "daily");
    renderUrl.searchParams.set("date", model.date);
    renderUrl.searchParams.set("timeZone", model.timeZone);
    renderUrl.searchParams.set("paperSize", model.paperSize);
    renderUrl.searchParams.set("includeCompletedTodos", String(model.includeCompletedTodos));
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
      const title = `Daily paper — ${model.heading}`;
      const file = this.ledger.registerFile({
        storagePath,
        originalFilename: `cf-clipboard-app-${model.date}.pdf`,
        title,
        description: `Printable daily calendar, timeline, scheduled to-dos, and tracker check-ins for ${model.heading}.`,
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
          includeCompletedTodos: model.includeCompletedTodos,
          eventCount: model.todayEvents.length,
          todoCount: model.scheduledTodos.length,
          trackerCount: model.scheduledTrackers.length,
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
    }
  }
}

export { addLocalDays, mondayOnOrBefore, normalizeInput };
