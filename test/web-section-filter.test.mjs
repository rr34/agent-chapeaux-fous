import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const filterSource = fs.readFileSync(new URL("../web/src/search-filter.ts", import.meta.url), "utf8");
const filterComponentSource = fs.readFileSync(new URL("../web/src/components/SectionFilter.tsx", import.meta.url), "utf8");
const calendarSource = fs.readFileSync(new URL("../web/src/components/DailyPaper.tsx", import.meta.url), "utf8");
const routineSource = fs.readFileSync(new URL("../web/src/components/RoutineCalendar.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const serverSource = fs.readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");

test("section filters require every query term while allowing terms in any field", () => {
  assert.match(filterSource, /match\(\/\[\\p\{L\}\\p\{N\}\]\+\/gu\)/);
  assert.match(filterSource, /Object\.values\(value\)/);
  assert.match(filterSource, /terms\.every\(\(term\) => searchableText\.includes\(term\)\)/);
  assert.match(filterSource, /normalize\("NFKD"\)/);
});

test("React sections share one consistent filter control", () => {
  assert.match(filterComponentSource, /placeholder="Type words in any order…"/);
  assert.match(filterComponentSource, /<form className="section-filter surface"/);
  assert.match(filterComponentSource, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); onSearch\(\); \}\}/);
  assert.match(filterComponentSource, /\{searching \? "Searching…" : "Search"\}[\s\S]*<\/button>/);
  for (const screen of ["AgentScreen", "GlobalSearchScreen", "CalendarScreen", "TodoScreen", "ContactsScreen", "LibraryScreen", "VideoScriptsScreen", "FilesScreen", "GenericScreen", "HatsScreen", "JournalScreen", "UsageScreen"]) {
    const start = appSource.indexOf(`function ${screen}`);
    assert.notEqual(start, -1, `${screen} exists`);
    const next = appSource.indexOf("\nfunction ", start + 1);
    assert.match(appSource.slice(start, next < 0 ? undefined : next), /<SectionFilter /, `${screen} uses SectionFilter`);
  }
  assert.match(routineSource, /<SectionFilter /);
});

test("bounded section searches submit their query to server endpoints", () => {
  assert.match(appSource, /`\/api\/global-search\?q=\$\{encodeURIComponent\(serverQuery\)\}&mode=terms&limit=100`/);
  assert.match(serverSource, /url\.pathname === "\/api\/global-search"[\s\S]*searchCoordinator\.search/);
  assert.match(appSource, /`\/api\/files\?\$\{fileParameters\}`/);
  assert.match(appSource, /fileParameters\.set\("query", serverQuery\)/);
  assert.match(appSource, /`\/api\/todos\?\$\{todoParameters\}`/);
  assert.match(appSource, /todoParameters\.set\("q", serverQuery\)/);
  assert.match(appSource, /`\/api\/contacts\?\$\{contactParameters\}`/);
  assert.match(appSource, /contactParameters\.set\("q", serverQuery\)/);
  assert.match(appSource, /`\/api\/journal-entries\?\$\{journalParameters\}`/);
  assert.match(appSource, /`\/api\/requests\?limit=200&q=\$\{encodeURIComponent\(serverQuery\)\}`/);
  assert.match(appSource, /`\/api\/calendar-events\/search\?q=\$\{encodeURIComponent\(serverQuery\)\}&limit=200`/);
});

test("calendar filters highlight matching events without removing the calendar", () => {
  assert.match(calendarSource, /matchesSearch\(event, searchQuery\)/);
  assert.match(calendarSource, /Number\(matchesSearch\(right, searchQuery\)\) - Number\(matchesSearch\(left, searchQuery\)\)/);
  assert.match(calendarSource, /is-search-match/);
  assert.match(styles, /\.two-week-grid\.is-searching \.calendar-chip\.is-search-match/);
  assert.doesNotMatch(calendarSource, /days\.filter\([^)]*searchQuery/);
});
