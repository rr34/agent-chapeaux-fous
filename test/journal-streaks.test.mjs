import test from "node:test";
import assert from "node:assert/strict";
import { loggingStreaks } from "../src/organizer-store.mjs";

test("journal streaks count distinct local dates and keep yesterday active", () => {
  assert.deepEqual(loggingStreaks([
    "2026-11-05", "2026-11-06", "2026-11-06", "2026-11-08", "2026-11-09",
  ], "2026-11-10"), { currentStreak: 2, longestStreak: 2 });
});

test("journal streaks stop after a missed day and ignore future entries", () => {
  assert.deepEqual(loggingStreaks([
    "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-12",
  ], "2026-11-10"), { currentStreak: 0, longestStreak: 3 });
});
