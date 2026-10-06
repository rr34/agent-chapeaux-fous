import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const filterSource = fs.readFileSync(new URL("../web/src/search-filter.ts", import.meta.url), "utf8");
const filterComponentSource = fs.readFileSync(new URL("../web/src/components/SectionFilter.tsx", import.meta.url), "utf8");
const calendarSource = fs.readFileSync(new URL("../web/src/components/DailyPaper.tsx", import.meta.url), "utf8");
const routineSource = fs.readFileSync(new URL("../web/src/components/RoutineCalendar.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

test("section filters require every query term while allowing terms in any field", () => {
  assert.match(filterSource, /match\(\/\[\\p\{L\}\\p\{N\}\]\+\/gu\)/);
  assert.match(filterSource, /Object\.values\(value\)/);
  assert.match(filterSource, /terms\.every\(\(term\) => searchableText\.includes\(term\)\)/);
  assert.match(filterSource, /normalize\("NFKD"\)/);
});

test("React sections share one consistent filter control", () => {
  assert.match(filterComponentSource, /placeholder="Type words in any order…"/);
  for (const screen of ["AgentScreen", "CalendarScreen", "TodoScreen", "ContactsScreen", "LibraryScreen", "VideoScriptsScreen", "FilesScreen", "GenericScreen", "HatsScreen", "JournalScreen", "UsageScreen"]) {
    const start = appSource.indexOf(`function ${screen}`);
    assert.notEqual(start, -1, `${screen} exists`);
    const next = appSource.indexOf("\nfunction ", start + 1);
    assert.match(appSource.slice(start, next < 0 ? undefined : next), /<SectionFilter /, `${screen} uses SectionFilter`);
  }
  assert.match(routineSource, /<SectionFilter /);
});

test("calendar filters highlight matching events without removing the calendar", () => {
  assert.match(calendarSource, /matchesSearch\(event, searchQuery\)/);
  assert.match(calendarSource, /Number\(matchesSearch\(right, searchQuery\)\) - Number\(matchesSearch\(left, searchQuery\)\)/);
  assert.match(calendarSource, /is-search-match/);
  assert.match(styles, /\.two-week-grid\.is-searching \.calendar-chip\.is-search-match/);
  assert.doesNotMatch(calendarSource, /days\.filter\([^)]*searchQuery/);
});
