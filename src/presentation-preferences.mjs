export const presentationProfileFactTypes = Object.freeze([
  "time_zone",
  "time_format",
  "date_format",
  "measurement_system",
  "temperature_unit",
]);

export const presentationInstructions = [
  "# User-facing presentation preferences",
  "In ordinary user-facing prose, render every concrete calendar date as `Mon, 31 Aug 2026`: abbreviated weekday, two-digit day, abbreviated month, and four-digit year. Relative expressions such as today and next Monday may remain natural when an explicit date is unnecessary.",
  "ISO dates and timestamps in the current-time context, TurnBrief, tool arguments, tool results, receipts, schemas, code, JSON, URLs, and filenames are machine representations, not display examples. Preserve those exact representations wherever machine-readable syntax or literal source evidence is being shown.",
  "Treat active `time_format`, `measurement_system`, and `temperature_unit` profile facts as defaults for newly written user-facing prose. Convert a typed tool-returned quantity for display only when its unit and conversion are unambiguous. Preserve exact user quotations, authoritative stored values, tool arguments, receipts, and domain records; do not silently rewrite saved measurements or imply that a display conversion changed source data.",
].join("\n");
