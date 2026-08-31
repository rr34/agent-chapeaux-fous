import assert from "node:assert/strict";
import test from "node:test";
import {
  localCalendarSnapshot,
  temporalConsistencyFindings,
  timeZoneFromProfileFacts,
  weekdayForLocalDate,
} from "../src/temporal-consistency.mjs";

test("the local calendar identifies August 31 2026 as Monday and the upcoming Sunday as September 6", () => {
  const calendar = localCalendarSnapshot(
    new Date("2026-08-31T15:30:25.138Z"),
    "America/New_York",
  );

  assert.equal(calendar.localDate, "2026-08-31");
  assert.equal(calendar.localWeekday, "Monday");
  assert.deepEqual(calendar.upcomingDates.find(({ weekday }) => weekday === "Sunday"), {
    offsetDays: 6,
    localDate: "2026-09-06",
    weekday: "Sunday",
    relative: null,
  });
  assert.equal(weekdayForLocalDate("2026-08-31"), "Monday");
  assert.equal(weekdayForLocalDate("2026-09-06"), "Sunday");
});

test("profile facts select a validated IANA time zone with UTC fallback", () => {
  assert.equal(timeZoneFromProfileFacts([{
    factType: "time_zone",
    text: "I am in the Eastern Time Zone (America/New_York).",
  }]), "America/New_York");
  assert.equal(timeZoneFromProfileFacts([{
    factType: "time_zone",
    text: "Use my usual local time.",
  }]), "UTC");
});

test("temporal validation rejects the exact Sunday August 31 failure", () => {
  const brief = {
    responseMode: "act",
    objective: "Schedule the tasks for Sunday, 2026-08-31.",
    temporalResolutions: [{
      sourceText: "Sunday afternoon",
      sourceEventSeqs: [16651],
      weekday: "Sunday",
      localDate: "2026-08-31",
      timeZone: "America/New_York",
      role: "target",
      appliesTo: "scheduled_at",
    }],
  };
  const findings = temporalConsistencyFindings(brief, {
    requestText: "Schedule them for Sunday afternoon.",
    requestEventSeq: 16651,
  });

  assert.ok(findings.some(({ code, message }) => (
    code === "weekday_date_mismatch"
    && message === "2026-08-31 is Monday, not Sunday"
  )));
});

test("an action naming a weekday requires a source-referenced resolution", () => {
  const findings = temporalConsistencyFindings({
    responseMode: "act",
    objective: "Schedule the tasks.",
    temporalResolutions: [],
  }, {
    requestText: "Schedule them Sunday afternoon.",
    requestEventSeq: 16651,
  });
  assert.deepEqual(findings, [{
    code: "missing_weekday_resolution",
    path: "brief.temporalResolutions",
    message: "The action request names Sunday, but no source-referenced local date resolves it",
    claimedWeekday: "Sunday",
  }]);
});

test("a valid source-referenced Sunday resolution passes", () => {
  assert.deepEqual(temporalConsistencyFindings({
    responseMode: "act",
    objective: "Schedule the tasks for Sunday, 2026-09-06.",
    temporalResolutions: [{
      sourceText: "Sunday afternoon",
      sourceEventSeqs: [16651],
      weekday: "Sunday",
      localDate: "2026-09-06",
      timeZone: "America/New_York",
      role: "target",
      appliesTo: "scheduled_at",
    }],
  }, {
    requestText: "Schedule them for Sunday afternoon.",
    requestEventSeq: 16651,
  }), []);
});
