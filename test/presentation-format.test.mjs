import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDisplayDate,
  formatDisplayTime,
  formatLocalDate,
  formatUserFacingDates,
} from "../public/presentation-format.js";

test("the shared presentation formatter uses the TLOM date and 24-hour time style", () => {
  const instant = new Date("2026-08-20T22:30:00.000Z");
  assert.equal(formatLocalDate("2026-08-31"), "Mon, 31 Aug 2026");
  assert.equal(formatLocalDate("2026-02-29"), "—");
  assert.equal(formatDisplayDate(instant, {
    includeTime: false,
    timeZone: "America/New_York",
  }), "Thu, 20 Aug 2026");
  assert.equal(formatDisplayTime(instant, { timeZone: "America/New_York" }), "18:30");
  assert.equal(formatDisplayDate(instant, { timeZone: "America/New_York" }), "Thu, 20 Aug 2026 at 18:30");
});

test("final-response prose dates are normalized and weekdays are recomputed", () => {
  assert.equal(
    formatUserFacingDates([
      "Moved everything to 2026-08-31.",
      "The prior dates were Sunday, August 30, 2026 and Monday, 31 August 2026.",
      "The existing label Mon, 31 Aug 2026 remains stable.",
      "An impossible date 2026-02-29 remains literal.",
    ].join("\n")),
    [
      "Moved everything to Mon, 31 Aug 2026.",
      "The prior dates were Sun, 30 Aug 2026 and Mon, 31 Aug 2026.",
      "The existing label Mon, 31 Aug 2026 remains stable.",
      "An impossible date 2026-02-29 remains literal.",
    ].join("\n"),
  );
});

test("machine-readable dates remain literal outside ordinary prose", () => {
  const response = [
    "The prose date is 2026-08-31.",
    "`2026-08-31`",
    'JSON: {"local_date":"2026-08-31"}',
    "Timestamp: 2026-08-31T14:32:03.980Z",
    "Filename: report-2026-08-31.csv",
    "URL: https://example.test/report/2026-08-31",
    "```json",
    '{"local_date":"2026-08-31"}',
    "```",
  ].join("\n");
  assert.equal(formatUserFacingDates(response), [
    "The prose date is Mon, 31 Aug 2026.",
    "`2026-08-31`",
    'JSON: {"local_date":"2026-08-31"}',
    "Timestamp: 2026-08-31T14:32:03.980Z",
    "Filename: report-2026-08-31.csv",
    "URL: https://example.test/report/2026-08-31",
    "```json",
    '{"local_date":"2026-08-31"}',
    "```",
  ].join("\n"));
});
