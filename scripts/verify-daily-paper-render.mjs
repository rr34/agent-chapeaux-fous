#!/usr/bin/env node
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { chromium } from "playwright-core";
import { createStaticHandler } from "../src/static-files.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const outputDirectory = path.resolve(process.argv[2] || await fsp.mkdtemp(path.join(os.tmpdir(), "agent-slayer-paper-render-")));
await fsp.mkdir(outputDirectory, { recursive: true });

const dates = Array.from({ length: 14 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 8, 28 + index));
  const localDate = date.toISOString().slice(0, 10);
  return {
    localDate,
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date),
    dayNumber: date.getUTCDate(),
    month: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date),
    isToday: localDate === "2026-10-04",
    events: [],
  };
});
const events = [
  { id: 1, title: "Morning walk", startsAtUtc: "2026-10-04T12:00:00.000Z", endsAtUtc: "2026-10-04T12:45:00.000Z", timeZone: "America/New_York", isAllDay: false, status: "confirmed", linkedTodos: [] },
  { id: 2, title: "Planning breakfast", description: "Decide the next experiment and the one thing that would make today feel complete.", location: "Kitchen table", startsAtUtc: "2026-10-04T13:00:00.000Z", endsAtUtc: "2026-10-04T14:00:00.000Z", timeZone: "America/New_York", isAllDay: false, status: "confirmed", linkedTodos: [] },
  { id: 3, title: "Review the draft", location: "Studio", startsAtUtc: "2026-10-04T18:00:00.000Z", endsAtUtc: "2026-10-04T19:30:00.000Z", timeZone: "America/New_York", isAllDay: false, status: "confirmed", linkedTodos: [] },
  { id: 4, title: "Call Mom", startsAtUtc: "2026-10-04T22:00:00.000Z", endsAtUtc: "2026-10-04T22:30:00.000Z", timeZone: "America/New_York", isAllDay: false, status: "confirmed", linkedTodos: [] },
];
dates[1].events = [{ ...events[0], id: 11, title: "Dentist" }];
dates[3].events = [{ ...events[1], id: 12, title: "Project check-in" }];
dates[5].events = Array.from({ length: 12 }, (_, index) => ({
  ...events[index % events.length],
  id: 100 + index,
  title: `Crowded calendar event ${index + 1}`,
}));
dates[6].events = events;
dates[8].events = [{ ...events[0], id: 14, title: "Send estimate" }];
dates[10].events = [{ ...events[2], id: 15, title: "Dinner with Alex" }];

const model = {
  protocol: "agent-slayer.daily-paper",
  version: 1,
  generatedAtUtc: "2026-10-04T11:30:00.000Z",
  date: "2026-10-04",
  rangeDate: "2026-10-04",
  timeZone: "America/New_York",
  paperSize: "letter",
  includeCompletedTodos: false,
  heading: "Sunday, October 4, 2026",
  rangeHeading: "Sep 28–Oct 11, 2026",
  calendarDays: dates,
  todayEvents: events,
  scheduledTodos: [
    {
      todoId: 17, title: "Bring the annotated draft", status: "todo",
      groupId: 4, groupName: "Writing", groupSortPosition: 1, sortPosition: 1,
      relatedContact: { contactId: 8, displayName: "Jane Smith" }, interactionGuide: null,
      eventLinks: [{ eventId: 3, title: "Review the draft", startsAtUtc: events[2].startsAtUtc, isAllDay: false, relationshipKind: "work" }],
    },
    {
      todoId: 18, title: "Choose three priorities", status: "todo",
      groupId: 4, groupName: "Writing", groupSortPosition: 1, sortPosition: 2,
      relatedContact: { contactId: 8, displayName: "Jane Smith" }, interactionGuide: null,
      eventLinks: [{ eventId: 2, title: "Planning breakfast", startsAtUtc: events[1].startsAtUtc, isAllDay: false, relationshipKind: "context" }],
    },
    {
      todoId: 19, title: "Pick up birthday card", status: "todo",
      groupId: 7, groupName: "Personal", groupSortPosition: 2, sortPosition: 1,
      relatedContact: { contactId: 12, displayName: "Mom" }, interactionGuide: null,
      eventLinks: [{ eventId: 4, title: "Call Mom", startsAtUtc: events[3].startsAtUtc, isAllDay: false, relationshipKind: "deadline" }],
    },
    {
      todoId: 20, title: "Ask Alex for the restaurant name", status: "todo",
      groupId: 7, groupName: "Personal", groupSortPosition: 2, sortPosition: 2,
      relatedContact: { contactId: 13, displayName: "Alex" }, interactionGuide: null,
      eventLinks: [{ eventId: 4, title: "Call Mom", startsAtUtc: events[3].startsAtUtc, isAllDay: false, relationshipKind: "context" }],
    },
  ],
  scheduledTrackers: [
    {
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
    },
    {
      trackerId: 32,
      ref: "agent-slayer://journal-trackers/32",
      name: "Call parents",
      groupName: "Relationships",
      unit: "occurrence",
      frequency: "weekly",
      interval: 1,
      periodStartsAtUtc: "2026-09-28T04:00:00.000Z",
      periodEndsAtUtc: "2026-10-05T04:00:00.000Z",
      logged: true,
    },
    {
      trackerId: 33,
      ref: "agent-slayer://journal-trackers/33",
      name: "Review household budget",
      groupName: "Home",
      unit: "occurrence",
      frequency: "monthly",
      interval: 1,
      periodStartsAtUtc: "2026-10-01T04:00:00.000Z",
      periodEndsAtUtc: "2026-11-01T04:00:00.000Z",
      logged: false,
    },
  ],
  weather: {
    status: "available",
    provider: "Open-Meteo.com",
    attributionUrl: "https://open-meteo.com/",
    fetchedAtUtc: "2026-10-04T11:30:00.000Z",
    location: "Delaware, Ohio, United States",
    temperatureUnit: "celsius",
    points: [5, 8, 11, 14, 17, 20, 23].map((hour) => ({
      time: `2026-10-04T${String(hour).padStart(2, "0")}:00`,
      hour,
      temperature: 3 + hour / 2,
      precipitationProbability: hour === 14 ? 25 : 5,
      weatherCode: hour === 14 ? 51 : 3,
    })),
  },
};
model.printableTodoGroups = [{
  id: 9,
  name: "Shopping",
  sortPosition: 3,
  dailyPaperPinned: true,
  todos: [{
    todoId: 21, title: "Buy coffee beans", status: "todo",
    groupId: 9, groupName: "Shopping", groupSortPosition: 3, sortPosition: 1,
    relatedContact: null, eventLinks: [],
  }],
}, {
  id: 10,
  name: "Packing",
  sortPosition: 4,
  dailyPaperPinned: true,
  todos: [],
}];
for (const todo of model.scheduledTodos) {
  for (const link of todo.eventLinks) {
    const event = events.find(({ id }) => id === link.eventId);
    event?.linkedTodos.push({ ...todo, relationshipKind: link.relationshipKind });
  }
}

const serveStatic = createStaticHandler({ repositoryRoot, publicRoot: path.join(repositoryRoot, "public") });
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/api/daily-paper") {
      const body = Buffer.from(JSON.stringify(model));
      response.writeHead(200, { "Content-Type": "application/json", "Content-Length": body.length });
      response.end(body);
      return;
    }
    if (await serveStatic(request, response)) return;
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain" });
    response.end(error instanceof Error ? error.message : String(error));
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const pdfPath = path.join(outputDirectory, "daily-paper-letter.pdf");
const screenshotPath = path.join(outputDirectory, "daily-paper-letter.png");
const browser = await chromium.launch({ headless: true });
const browserErrors = [];
try {
  const page = await browser.newPage({ viewport: { width: 816, height: 1056 }, deviceScaleFactor: 1 });
  page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", error => browserErrors.push(error.message));
  await page.goto(`${origin}/app?paper=daily&date=2026-10-04&timeZone=America%2FNew_York&paperSize=letter`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForFunction(() => window.__DAILY_PAPER_READY__ === true, null, { timeout: 60_000 });
  const groupLabels = await page.locator(".paper-todo-group > h3").allTextContents();
  if (groupLabels.join("|") !== "Shopping|Packing") throw new Error(`Unexpected pinned to-do groups: ${groupLabels.join("|")}`);
  if (await page.locator(".paper-todo-empty-lines").count() !== 1) {
    throw new Error("Expected one empty pinned to-do group checklist");
  }
  if (await page.locator(".paper-event-todos .paper-todo-card").count() !== 4) {
    throw new Error("Expected four event-owned to-dos in the printed timeline");
  }
  if (await page.locator(".paper-pinned-todos .paper-todo-card").count() !== 1) {
    throw new Error("Expected one pinned-only to-do after the timeline");
  }
  const pinnedText = await page.locator(".paper-pinned-todos").allTextContents();
  if (pinnedText.some((text) => text.includes("Bring the annotated draft"))) {
    throw new Error("A scheduled to-do was duplicated in the pinned appendage");
  }
  if (await page.locator(".paper-hour-rule").count() !== 19) {
    throw new Error("Expected fixed hourly rules from 05:00 through 23:00");
  }
  if (await page.locator(".paper-event-bracket").count() !== events.length) {
    throw new Error("Expected one proportional bracket for every timed event");
  }
  if (await page.locator(".paper-event-connector").count() !== events.length) {
    throw new Error("Expected every event bracket to connect to its existing detail card");
  }
  if (await page.locator(".paper-timeline-card > .paper-event-card").count() !== events.length) {
    throw new Error("Expected every timed event to use one detailed card inside the fixed timeline");
  }
  const disconnectedCards = await page.locator(".paper-positioned-event").evaluateAll((items) => items
    .map((item, index) => {
      const connector = item.querySelector(".paper-event-connector")?.getBoundingClientRect();
      const card = item.querySelector(".paper-event-card")?.getBoundingClientRect();
      return connector && card && Math.abs(connector.right - card.left) > 1
        ? { index, connectorRight: connector.right, cardLeft: card.left }
        : null;
    })
    .filter(Boolean));
  if (disconnectedCards.length) {
    throw new Error(`Event connectors did not meet their cards: ${JSON.stringify(disconnectedCards)}`);
  }
  if (await page.locator(".paper-weather-point").count() !== model.weather.points.length) {
    throw new Error("Expected weather points aligned to the printed time scale");
  }
  if ((await page.locator(".paper-plan-page").innerText()).includes("Celsius")) {
    throw new Error("The accessible weather unit leaked into the visible print layout");
  }
  const firstPage = await page.locator(".paper-plan-page").boundingBox();
  const timeline = await page.locator(".paper-time-scale").boundingBox();
  if (!firstPage || !timeline || timeline.height < 400 || timeline.y + timeline.height > firstPage.y + firstPage.height) {
    throw new Error(`Fixed timeline did not occupy the remaining first page: ${JSON.stringify({ firstPage, timeline })}`);
  }
  await page.emulateMedia({ media: "print" });
  const calendarOverflow = await page.locator(".two-week-grid--compact .calendar-cell").evaluateAll((cells) => cells
    .map((cell, index) => {
      const lastEvent = cell.querySelector(".calendar-chip:last-child");
      if (!lastEvent) return null;
      const cellBounds = cell.getBoundingClientRect();
      const eventBounds = lastEvent.getBoundingClientRect();
      return eventBounds.bottom > cellBounds.bottom + 0.5 ? { index, cellBottom: cellBounds.bottom, eventBottom: eventBounds.bottom } : null;
    })
    .filter(Boolean));
  if (calendarOverflow.length) {
    throw new Error(`Printable calendar events escaped their day borders: ${JSON.stringify(calendarOverflow)}`);
  }
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.pdf({ path: pdfPath, format: "Letter", printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
const pdf = await fsp.readFile(pdfPath);
if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Chromium did not create a PDF document");
const pdfDocument = await PDFDocument.load(pdf);
if (pdfDocument.getPageCount() !== 2) throw new Error(`Expected a two-page PDF; received ${pdfDocument.getPageCount()} pages`);
if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join("; ")}`);
process.stdout.write(`${JSON.stringify({ pdfPath, screenshotPath, bytes: pdf.length })}\n`);
