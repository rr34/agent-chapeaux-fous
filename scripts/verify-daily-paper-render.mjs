#!/usr/bin/env node
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
dates[5].events = [{ ...events[2], id: 13, title: "Farmers market" }];
dates[6].events = events;
dates[8].events = [{ ...events[0], id: 14, title: "Send estimate" }];
dates[10].events = [{ ...events[2], id: 15, title: "Dinner with Alex" }];

const model = {
  protocol: "agent-slayer.daily-paper",
  version: 1,
  generatedAtUtc: "2026-10-04T11:30:00.000Z",
  date: "2026-10-04",
  timeZone: "America/New_York",
  paperSize: "letter",
  includeCompletedTodos: false,
  heading: "Sunday, October 4, 2026",
  rangeHeading: "Sep 28–Oct 11, 2026",
  calendarDays: dates,
  todayEvents: events,
  scheduledTodos: [
    { todoId: 17, title: "Bring the annotated draft", status: "todo", eventTitles: ["Review the draft"] },
    { todoId: 18, title: "Choose three priorities", status: "todo", eventTitles: ["Planning breakfast"] },
    { todoId: 19, title: "Pick up birthday card", status: "todo", eventTitles: ["Call Mom"] },
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
};

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
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await page.pdf({ path: pdfPath, format: "Letter", printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
const pdf = await fsp.readFile(pdfPath);
if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Chromium did not create a PDF document");
if (browserErrors.length) throw new Error(`Browser errors: ${browserErrors.join("; ")}`);
process.stdout.write(`${JSON.stringify({ pdfPath, screenshotPath, bytes: pdf.length })}\n`);
