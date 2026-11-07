import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const calendarSource = fs.readFileSync(
  new URL("../web/src/components/DailyPaper.tsx", import.meta.url),
  "utf8",
);
const calendarCardSource = fs.readFileSync(new URL("../web/src/components/object-cards/CalendarEventCard.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const trackerScheduleSource = fs.readFileSync(new URL("../web/src/components/TrackerSchedule.tsx", import.meta.url), "utf8");
const serverSource = fs.readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
const organizerSource = fs.readFileSync(new URL("../src/organizer-store.mjs", import.meta.url), "utf8");
const dateFormatSource = fs.readFileSync(new URL("../web/src/date-format.ts", import.meta.url), "utf8");

test("calendar days select the detailed timeline and linked to-dos", () => {
  assert.match(calendarSource, /onSelect\?: \(localDate: string\) => void/);
  assert.match(calendarSource, /onClick=\{\(\) => onSelect\(day\.localDate\)\}/);
  assert.match(calendarSource, /aria-pressed=\{isSelected\}/);
  assert.match(appSource, /events=\{selectedEvents\}/);
  assert.match(appSource, /const weekTodos = linkedTodosForEvents\(printCalendarDays\.flatMap\(\(day\) => day\.events\)\)/);
});

test("screen calendar nests scheduled to-dos beneath their linked events", () => {
  assert.match(appSource, /<h2>Selected day’s plan<\/h2>/);
  assert.match(appSource, /Events are expanded by default so notes, contacts, and linked to-dos are visible/);
  assert.match(appSource, /<DayTimeline[^>]+defaultExpanded/);
  assert.match(calendarSource, /<CalendarEventItem[\s\S]*defaultExpanded=\{defaultExpanded\}/);
  assert.doesNotMatch(appSource, /<h2>Scheduled to-dos<\/h2>/);
  assert.match(styles, /\.timeline-event-linked-todos \{[^}]*display: grid;[^}]*list-style: none;/s);
});

test("calendar week arrows move only the displayed range and Today restores today", () => {
  assert.match(appSource, /rangeDate: displayDate/);
  assert.match(appSource, /aria-label="Previous week".*setDisplayDate.*shiftLocalDate\(current, -7\)/);
  assert.match(appSource, /aria-label="Next week".*setDisplayDate.*shiftLocalDate\(current, 7\)/);
  assert.doesNotMatch(appSource, /aria-label="Previous week".*setSelectedDate/);
  assert.doesNotMatch(appSource, /aria-label="Next week".*setSelectedDate/);
  assert.match(appSource, />Today<\/button>/);
  assert.match(appSource, /setSelectedDate\(date\); setDisplayDate\(date\);/);
  assert.doesNotMatch(appSource, /setSelectedDate\(data\.date\)/);
  assert.match(appSource, /<CalendarGrid id="calendar-grid"/);
  assert.match(calendarSource, /<section id=\{id\} className=\{\`two-week-grid/);
  assert.match(styles, /\.calendar-range-arrow \{[^}]*width: 100%/s);
});

test("calendar filter card selects the displayed year and month without changing the selected day", () => {
  assert.match(appSource, /<SectionFilter[^>]*controls=\{<>[\s\S]*label="Year"[\s\S]*label="Month"[\s\S]*<\/>\} \/>/);
  assert.match(appSource, /onChange=\{\(year\) => setDisplayDate\(calendarMonthAnchor\(year, displayMonth\)\)\}/);
  assert.match(appSource, /onChange=\{\(month\) => setDisplayDate\(calendarMonthAnchor\(displayYear, month\)\)\}/);
  assert.match(appSource, /function calendarMonthAnchor\([\s\S]*-01`;/);
  assert.doesNotMatch(appSource, /onChange=\{\((?:year|month)\) => setSelectedDate/);
});

test("calendar marks the first displayed day with its month and ISO week", () => {
  assert.match(calendarSource, /calendarRangeMarkerLabel\(days\[0\]\.localDate\)/);
  assert.match(calendarSource, /calendar-range-marker/);
  assert.match(calendarSource, /\`\$\{monthLabel\} \(week \$\{week\}\)\`/);
  assert.match(styles, /\.calendar-range-marker \{[^}]*writing-mode: vertical-rl;[^}]*transform: rotate\(180deg\);/s);
});

test("calendar uses its day selection instead of separate date and paper controls", () => {
  assert.doesNotMatch(appSource, /className="compact-field"/);
  assert.match(appSource, /date: selectedDate, rangeDate: displayDate, timeZone, paperSize: "letter"/);
  assert.match(appSource, /disabled=\{generating \|\| !data\}/);
});

test("print preview follows the selected week while the selected-day UI remains", () => {
  assert.match(appSource, /const previewModel = useMemo<DailyPaperModel \| null>/);
  assert.match(appSource, /date: selectedDate/);
  assert.match(appSource, /const weekStartDate = mondayOnOrBeforeForPreview\(selectedDate\)/);
  assert.match(appSource, /const weekEndDate = shiftLocalDate\(weekStartDate, 6\)/);
  assert.match(appSource, /printCalendarDays: printCalendarDays\.length === 7/);
  assert.match(appSource, /todayEvents: selectedEvents/);
  assert.match(appSource, /scheduledTodos: weekTodos/);
  assert.match(appSource, /<DailyPaper model=\{previewModel\} preview \/>/);
  assert.match(appSource, /Preview and edit the printed week/);
});

test("screen calendar stays bounded while printable calendar rows grow with their events", () => {
  assert.match(styles, /\.calendar-cell \{[^}]*aspect-ratio: 2 \/ 3;/);
  assert.match(styles, /\.calendar-cell \{[^}]*justify-content: flex-start;[^}]*align-items: stretch;/);
  assert.match(styles, /\.two-week-grid--compact \.calendar-cells \{[^}]*grid-auto-rows: minmax\(1\.15in, auto\);[^}]*align-items: stretch;/);
  assert.match(styles, /\.two-week-grid--compact \.calendar-cell \{[^}]*min-height: 1\.15in;/);
  assert.match(styles, /\.two-week-grid--compact \.calendar-cell \{[^}]*aspect-ratio: auto;[^}]*overflow: visible;/);
  assert.match(styles, /\.two-week-grid--compact \.calendar-cell \{[^}]*padding: \.045in \.045in \.15in;/);
  assert.match(calendarSource, /compact \? orderedEvents : orderedEvents\.slice\(0, eventLimit\)/);
  assert.match(calendarSource, /day\.events\.length > visibleEvents\.length/);
});

test("printable calendar renders every event in crowded days", () => {
  assert.match(calendarSource, /\{visibleEvents\.map\(\(event\) => \(/);
  assert.doesNotMatch(calendarSource, /compact \? 3/);
  assert.match(calendarSource, /\+\{day\.events\.length - visibleEvents\.length\} more/);
  assert.doesNotMatch(calendarSource, /calendar-chip-description/);
  assert.match(calendarSource, /\(compact \|\| !event\.isAllDay\) && <time>/);
  assert.match(styles, /\.calendar-chip \{[^}]*align-items: flex-start;/s);
  assert.match(styles, /\.calendar-chip time \+ span \{[^}]*flex: 1 1 auto;/s);
  assert.match(styles, /\.two-week-grid--compact \.calendar-chip \{[^}]*grid-template-columns: \.34in minmax\(0, 1fr\);[^}]*display: grid;/s);
  assert.match(styles, /\.two-week-grid--compact \.calendar-chip time \{[^}]*text-align: right;[^}]*white-space: nowrap;/s);
  assert.match(styles, /\.calendar-event-card\.paper-calendar-event-card > \.first-class-object-content > \.first-class-object-body \{[^}]*grid-column: 2;[^}]*overflow: visible;[^}]*white-space: pre-wrap;[^}]*-webkit-line-clamp: unset;/s);
});

test("the printed week nests linked to-dos beneath each event at the event width", () => {
  assert.match(calendarSource, /showLinkedTodos && \(event\.linkedTodos \|\| \[\]\)\.some/);
  assert.match(calendarSource, /className="calendar-chip-todos"/);
  assert.match(calendarSource, /days=\{model\.printCalendarDays\}/);
  assert.match(calendarSource, /showLinkedTodos/);
  assert.match(styles, /\.two-week-grid--compact \.calendar-chip-todos \{[^}]*grid-column: 1 \/ -1;/s);
  assert.doesNotMatch(calendarSource, /PrintableWeatherTimeline|PrintableEventCards|paper-event-bracket|paper-event-connector/);
});

test("the reusable calendar event card owns concise date and time edge labels", () => {
  assert.match(calendarCardSource, /export function calendarEventTiming/);
  assert.match(calendarCardSource, /const timeZone = displayTimeZone \|\| event\.timeZone \|\| "UTC"/);
  assert.match(calendarCardSource, /Date\.parse\(event\.endsAtUtc\) - 1/);
  assert.match(calendarCardSource, /const spansDays = startDate !== endDate/);
  assert.match(calendarCardSource, /start: shortDate\(event\.startsAtUtc, timeZone, crossesYear\)/);
  assert.match(calendarCardSource, /end: spansDays \? `\$\{shortDate/);
  assert.match(calendarCardSource, /topEdge=\{timing \? <time className="calendar-event-time calendar-event-time--start"/);
  assert.match(calendarCardSource, /bottomEdge=\{timing\?\.end \? <time className="calendar-event-time calendar-event-time--end"/);
  assert.match(calendarCardSource, /<strong>\{timing\.start\}<\/strong><span>\{event!\.isAllDay \? "All day"/);
  assert.match(calendarCardSource, /<strong>\{timing\.end\}<\/strong><span>End<\/span>/);
  assert.match(calendarCardSource, /!event!\.endsAtUtc \? "Time" : "Start"/);
  assert.match(styles, /\.calendar-event-time--start \{[^}]*border-bottom:/s);
  assert.match(styles, /\.calendar-event-time--end \{[^}]*border-top:/s);
});

test("weekly paper replaces the daily plan with scheduled and pinned to-do lists", () => {
  const paperLayout = calendarSource.slice(calendarSource.indexOf("export function DailyPaper"));
  assert.doesNotMatch(calendarSource, /TodoWorksheet|Handwriting sheets follow|TODOS_PER_WORKSHEET/);
  assert.match(paperLayout, /paper-week-page/);
  assert.doesNotMatch(paperLayout, /paper-details-page|Today’s plan|Follow-through/);
  assert.match(paperLayout, /<h2>To-do lists<\/h2>/);
  assert.match(calendarSource, /<PrintableScheduledTodos todos=\{model\.scheduledTodos\} \/>/);
  assert.match(calendarSource, /<PrintablePinnedTodoGroups groups=\{model\.printableTodoGroups\} \/>/);
  assert.ok(paperLayout.indexOf("PrintableScheduledTodos") < paperLayout.indexOf("PrintablePinnedTodoGroups"));
  assert.match(calendarSource, /className="paper-todo-empty-lines"/);
  assert.match(calendarSource, /className="paper-todo-group"/);
  assert.doesNotMatch(calendarSource, /paper-todo-cluster/);
  assert.match(organizerSource, /related_contact\.display_name AS related_contact_name/);
  assert.match(organizerSource, /linkedTodos: links\.get\(eventId\(event\)\) \?\? \[\]/);
  assert.doesNotMatch(calendarSource, /personal_task_id|todoPrintIdentifier|data-object-reference|paper-todo-id/);
  assert.match(calendarSource, /Blank writing area for \$\{todoTitle\(todo\)\}/);
  assert.match(calendarSource, /className="paper-handwriting-space"/);
  assert.match(styles, /\.paper-weekly-todos \{[^}]*border-top: 1px solid/s);
  assert.match(styles, /\.paper-todo-group > h3 \{/);
  assert.match(styles, /\.paper-todo-card \{[^}]*border: 1px solid/s);
  assert.match(calendarSource, /<strong className="multiline-item-text">\{todoTitle\(todo\)\}<\/strong>[\s\S]*className="paper-todo-relationships"/);
  assert.match(styles, /\.paper-todo-card header \{[^}]*grid-template-columns: minmax\(0, 1\.25fr\) minmax\(1\.2in, \.75fr\);/s);
  assert.match(styles, /\.paper-todo-card header:not\(\.has-details\) > strong \{[^}]*grid-column: 1 \/ -1;/s);
  assert.doesNotMatch(styles, /\.paper-todo-id/);
  assert.match(styles, /\.paper-todo-relationships \{[^}]*grid-column: 2;/s);
  assert.match(styles, /\.paper-todo-group \{[^}]*break-inside: avoid-page;/s);
  assert.match(paperLayout, /contentEditable=\{preview\}/);
});

test("journal trackers expose basic daily, weekly, and monthly RRULE controls", () => {
  assert.match(appSource, /<TrackerSchedule tracker=\{tracker\} onChanged=\{reloadJournal\}/);
  assert.match(trackerScheduleSource, /<option value="off">Not scheduled<\/option>/);
  assert.match(trackerScheduleSource, /<option value="daily">Daily<\/option>/);
  assert.match(trackerScheduleSource, /<option value="weekly">Weekly<\/option>/);
  assert.match(trackerScheduleSource, /<option value="monthly">Monthly<\/option>/);
  assert.match(trackerScheduleSource, /method: "PATCH"/);
  assert.match(trackerScheduleSource, /weekdays: frequency === "weekly"/);
  assert.match(serverSource, /journal-trackers\\\/\(\\d\+\)\\\/schedule/);
  assert.match(serverSource, /journalSchedule\.setTrackerSchedule/);
  assert.match(organizerSource, /askingRecurrenceRule: row\.asking_recurrence_rule/);
  assert.match(styles, /\.tracker-schedule \{/);
});

test("tracker renderer remains available without occupying the weekly printout", () => {
  assert.doesNotMatch(calendarSource.slice(calendarSource.indexOf("export function DailyPaper")), /ScheduledTrackers/);
  assert.match(calendarSource, /tracker\.logged \? "✓" : ""/);
  assert.match(calendarSource, /trackerCadenceLabel\(tracker\)/);
  assert.match(styles, /\.paper-trackers \{/);
  assert.match(styles, /\.paper-today-trackers \{[^}]*break-inside: avoid-page;/s);
  assert.match(styles, /\.paper-trackers li \{[^}]*break-inside: avoid-page;/s);
});

test("weekly paper owns the complete physical page", () => {
  assert.match(styles, /@page letter \{ size: Letter; margin: 0; \}/);
  assert.match(styles, /@page a4 \{ size: A4; margin: 0; \}/);
  assert.doesNotMatch(styles, /@page (?:letter|a4):first/);
});

test("React calendar keeps day-first dates and the printout uses the week heading", () => {
  assert.match(dateFormatSource, /weekday.*day.*month.*year/s);
  assert.match(dateFormatSource, /hourCycle: "h23"/);
  assert.match(calendarSource, /Printed \{formatDisplayDate\(model\.generatedAtUtc/);
  assert.match(calendarSource, /\{model\.weekHeading\}/);
  assert.match(calendarSource, /<strong>\{day\.dayNumber\}<\/strong>/);
  assert.doesNotMatch(dateFormatSource, /padStart\(2/);
  assert.doesNotMatch(calendarSource, /dateStyle: "medium"/);
});
