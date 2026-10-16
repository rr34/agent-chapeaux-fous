import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const calendarSource = fs.readFileSync(
  new URL("../web/src/components/DailyPaper.tsx", import.meta.url),
  "utf8",
);
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
  assert.match(appSource, /const selectedTodos = useMemo\(\(\) => linkedTodosForEvents\(selectedEvents\)/);
});

test("screen calendar nests scheduled to-dos beneath their linked events", () => {
  assert.match(appSource, /<h2>Selected day’s plan<\/h2>/);
  assert.match(appSource, /Events are expanded by default so notes, contacts, planning prompts, and linked to-dos are visible/);
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

test("print preview follows the selected calendar day immediately", () => {
  assert.match(appSource, /const previewModel = useMemo<DailyPaperModel \| null>/);
  assert.match(appSource, /date: selectedDate/);
  assert.match(appSource, /heading: formatLocalDate\(selectedDate\)/);
  assert.match(appSource, /todayEvents: selectedEvents/);
  assert.match(appSource, /scheduledTodos: selectedTodos/);
  assert.match(appSource, /<DailyPaper model=\{previewModel\} preview \/>/);
});

test("screen calendar days keep their aspect ratio while printable days grow with their events", () => {
  assert.match(styles, /\.calendar-cell \{[^}]*aspect-ratio: 2 \/ 3;/);
  assert.match(styles, /\.calendar-cell \{[^}]*justify-content: flex-start;[^}]*align-items: stretch;/);
  assert.match(styles, /\.two-week-grid--compact \.calendar-cells \{[^}]*grid-auto-rows: max-content;[^}]*align-items: stretch;/);
  assert.match(styles, /\.two-week-grid--compact \.calendar-cell \{[^}]*min-height: \.70in;[^}]*aspect-ratio: auto;/);
  assert.match(calendarSource, /const visibleEvents = compact \? orderedEvents : orderedEvents\.slice\(0, eventLimit\)/);
  assert.match(calendarSource, /!compact && day\.events\.length > eventLimit/);
});

test("printable calendar shows every event with hanging-indented wrapped titles", () => {
  assert.match(calendarSource, /\{visibleEvents\.map\(\(event\) => \(/);
  assert.doesNotMatch(calendarSource, /compact \? 3/);
  assert.match(styles, /\.calendar-chip \{[^}]*align-items: flex-start;/s);
  assert.match(styles, /\.calendar-chip time \+ span \{[^}]*flex: 1 1 auto;/s);
});

test("the printed timeline uses horizontal space and keeps complete events together", () => {
  assert.match(calendarSource, /function PrintableDayTimeline/);
  assert.match(calendarSource, /<PrintableDayTimeline[\s\S]*?events=\{model\.todayEvents\}/);
  assert.match(calendarSource, /className="paper-event-description">\{event\.description\}<\/p>/);
  assert.match(styles, /\.daily-paper \.timeline-list p \{[^}]*font-size: 5\.8pt;/s);
  assert.match(styles, /\.paper-event-card p \{[^}]*-webkit-line-clamp: 2;/s);
  assert.match(styles, /\.paper-event-card \{[^}]*grid-template-columns: minmax\(1\.35in, \.8fr\) minmax\(0, 1\.4fr\) auto;/s);
  assert.match(styles, /\.paper-event-card > \.paper-event-description \{[^}]*grid-column: 2;/s);
  assert.match(styles, /\.paper-event-card:not\(\.has-description\):not\(\.has-location\) > strong \{[^}]*grid-column: 1 \/ -1;/s);
  assert.match(styles, /\.daily-paper \.timeline-list > li \{[^}]*break-inside: avoid-page;/s);
});

test("daily paper keeps one today section with event-owned to-dos and pinned groups appended", () => {
  const paperLayout = calendarSource.slice(calendarSource.indexOf("export function DailyPaper"));
  assert.doesNotMatch(calendarSource, /TodoWorksheet|Handwriting sheets follow|TODOS_PER_WORKSHEET/);
  assert.match(paperLayout, /className="paper-section paper-today"/);
  assert.match(paperLayout, /<h2>Today’s stuff<\/h2>/);
  assert.doesNotMatch(paperLayout, /<h2>To-dos<\/h2>|<h2>Trackers<\/h2>/);
  assert.match(calendarSource, /className="paper-event-todos"/);
  assert.match(calendarSource, /<PrintableTodoCard todo=\{todo\} showRelationship/);
  assert.match(calendarSource, /<PrintablePinnedTodoGroups groups=\{model\.printableTodoGroups\} \/>/);
  assert.ok(paperLayout.indexOf("PrintableDayTimeline") < paperLayout.indexOf("PrintablePinnedTodoGroups"));
  assert.match(calendarSource, /className="paper-todo-empty-lines"/);
  assert.match(calendarSource, /className="paper-todo-group"/);
  assert.doesNotMatch(calendarSource, /paper-todo-cluster/);
  assert.match(organizerSource, /related_contact\.display_name AS related_contact_name/);
  assert.match(organizerSource, /linkedTodos: links\.get\(eventId\(event\)\) \?\? \[\]/);
  assert.doesNotMatch(calendarSource, /personal_task_id|todoPrintIdentifier|data-object-reference|paper-todo-id/);
  assert.match(calendarSource, /Blank writing area for \$\{todoTitle\(todo\)\}/);
  assert.match(calendarSource, /className="paper-handwriting-space"/);
  assert.match(styles, /\.paper-today \{[^}]*border-top: 1px solid/s);
  assert.match(styles, /\.daily-paper \.timeline-list > li \{[^}]*grid-template-columns: \.62in 1fr/s);
  assert.match(styles, /\.daily-paper \.timeline-list > li > time \{[^}]*text-align: left/s);
  assert.match(styles, /\.paper-event-todos \{[^}]*border-left: 2px solid #a4492e/s);
  assert.match(styles, /\.paper-todo-group > h3 \{/);
  assert.match(styles, /\.paper-todo-card \{[^}]*border: 1px solid/s);
  assert.match(calendarSource, /<strong className="multiline-item-text">\{todoTitle\(todo\)\}<\/strong>[\s\S]*className="paper-todo-relationships"/);
  assert.match(styles, /\.paper-todo-card header \{[^}]*grid-template-columns: minmax\(0, 1\.25fr\) minmax\(1\.2in, \.75fr\);/s);
  assert.match(styles, /\.paper-todo-card header:not\(\.has-details\) > strong \{[^}]*grid-column: 1 \/ -1;/s);
  assert.doesNotMatch(styles, /\.paper-todo-id/);
  assert.match(styles, /\.paper-todo-relationships \{[^}]*grid-column: 2;/s);
  assert.match(styles, /\.paper-todo-group \{[^}]*break-inside: avoid-page;/s);
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
  assert.match(serverSource, /catchUp\.setTrackerSchedule/);
  assert.match(organizerSource, /askingRecurrenceRule: row\.asking_recurrence_rule/);
  assert.match(styles, /\.tracker-schedule \{/);
});

test("daily paper renders RRULE-driven tracker status", () => {
  assert.match(calendarSource, /<h3>Trackers<\/h3>/);
  assert.match(calendarSource, /<ScheduledTrackers trackers=\{model\.scheduledTrackers\}/);
  assert.match(calendarSource, /tracker\.logged \? "✓" : ""/);
  assert.match(calendarSource, /trackerCadenceLabel\(tracker\)/);
  assert.match(styles, /\.paper-trackers \{/);
  assert.match(styles, /\.paper-today-trackers \{[^}]*break-inside: avoid-page;/s);
  assert.match(styles, /\.paper-trackers li \{[^}]*break-inside: avoid-page;/s);
});

test("daily paper gives continuation pages extra top margin", () => {
  assert.match(styles, /@page letter \{ size: Letter; margin: \.22in 0 0; \}/);
  assert.match(styles, /@page letter:first \{ margin-top: 0; \}/);
  assert.match(styles, /@page a4 \{ size: A4; margin: \.22in 0 0; \}/);
  assert.match(styles, /@page a4:first \{ margin-top: 0; \}/);
});

test("React calendar and printed paper use the day-first date contract", () => {
  assert.match(dateFormatSource, /weekday.*day.*month.*year/s);
  assert.match(dateFormatSource, /hourCycle: "h23"/);
  assert.match(calendarSource, /Printed \{formatDisplayDate\(model\.generatedAtUtc/);
  assert.match(calendarSource, /For \{formatLocalDate\(model\.date\)\}/);
  assert.match(calendarSource, /<strong>\{day\.dayNumber\}<\/strong>/);
  assert.doesNotMatch(dateFormatSource, /padStart\(2/);
  assert.doesNotMatch(calendarSource, /dateStyle: "medium"/);
});
