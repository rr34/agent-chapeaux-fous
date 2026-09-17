import path from "node:path";
import { inspectDelimitedText } from "./tabular-transform.mjs";

const previewText = (value, maximum = 160) => String(value ?? "").slice(0, maximum);

function jsonShape(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function objectKeys(values) {
  const keys = new Set();
  for (const value of values.slice(0, 100)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const key of Object.keys(value)) {
      keys.add(key);
      if (keys.size >= 50) break;
    }
    if (keys.size >= 50) break;
  }
  return [...keys].slice(0, 50);
}

function inspectJson(text) {
  try {
    const value = JSON.parse(text);
    const records = Array.isArray(value) ? value : [value];
    return {
      format: "json", status: "parsed", issues: [],
      structure: {
        rootType: jsonShape(value),
        recordCount: records.length,
        sampleFieldNames: objectKeys(records),
        sampledRecordCount: Math.min(records.length, 100),
      },
    };
  } catch (error) {
    return {
      format: "json", status: "needs_review",
      issues: [{ code: "JSON_PARSE_ERROR", message: previewText(error.message, 300) }],
      structure: { characterCount: text.length },
    };
  }
}

function inspectJsonLines(text) {
  const lines = text.split(/\r\n|\n|\r/u);
  const objects = [];
  let recordCount = 0;
  let invalidCount = 0;
  const invalidLineNumbers = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    recordCount += 1;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (objects.length < 100) objects.push(value);
      } else {
        invalidCount += 1;
        if (invalidLineNumbers.length < 20) invalidLineNumbers.push(index + 1);
      }
    } catch {
      invalidCount += 1;
      if (invalidLineNumbers.length < 20) invalidLineNumbers.push(index + 1);
    }
  }
  return {
    format: "json_lines", status: invalidCount ? "needs_review" : "parsed",
    issues: invalidCount ? [{
      code: "INVALID_JSON_LINE", message: `${invalidCount} nonblank lines are not JSON objects`,
      count: invalidCount, lineNumbers: invalidLineNumbers,
    }] : [],
    structure: {
      recordCount, validObjectCount: recordCount - invalidCount,
      sampleFieldNames: objectKeys(objects), sampledRecordCount: objects.length,
    },
  };
}

function inspectTable(text, declaredFormat) {
  try {
    const table = inspectDelimitedText(text, {
      delimiter: declaredFormat === "tsv" ? "tab" : "auto", headerRow: true, sampleSize: 3,
    });
    const issues = [
      ...table.headerAdjustments.map((item) => ({
        code: item.reason === "blank" ? "BLANK_HEADER" : "DUPLICATE_HEADER",
        message: `Column ${item.columnNumber} uses ${item.effectiveHeader}`,
      })),
      ...(table.inconsistentRecordCount ? [{
        code: "INCONSISTENT_WIDTH",
        message: `${table.inconsistentRecordCount} records have a different column count`,
        count: table.inconsistentRecordCount,
      }] : []),
    ];
    return {
      format: "delimited_table",
      status: table.inconsistentRecordCount ? "needs_review" : "parsed", issues,
      structure: {
        delimiter: table.delimiter, columnCount: table.headers.length,
        headers: table.headers.slice(0, 50), headersTruncated: table.headers.length > 50,
        sourceRecordCount: table.sourceRecordCount,
        blankRecordCount: table.blankRecordCount,
        inconsistentRecordCount: table.inconsistentRecordCount,
        inconsistentRecordNumbers: table.inconsistentRecordNumbers.slice(0, 20),
        sampleRecords: table.sampleRecords.map(({ source_record_number: sourceRecordNumber, values }) => ({
          sourceRecordNumber,
          values: Object.fromEntries(Object.entries(values).slice(0, 12)
            .map(([key, value]) => [key, previewText(value)])),
        })),
      },
    };
  } catch (error) {
    return {
      format: "delimited_table", status: "needs_review",
      issues: [{ code: "TABLE_PARSE_ERROR", message: previewText(error.message, 300) }],
      structure: { characterCount: text.length },
    };
  }
}

export function inspectTextStructure(text, filename = "document.txt") {
  const source = String(text ?? "");
  const extension = path.extname(String(filename)).toLowerCase();
  const declaredFormat = ({ ".csv": "csv", ".tsv": "tsv", ".json": "json",
    ".jsonl": "json_lines", ".vcf": "vcard", ".txt": "text" })[extension] ?? "text";
  let result;
  if (["csv", "tsv"].includes(declaredFormat)) result = inspectTable(source, declaredFormat);
  else if (declaredFormat === "json") result = inspectJson(source);
  else if (declaredFormat === "json_lines") result = inspectJsonLines(source);
  else if (declaredFormat === "vcard") {
    const cards = (source.match(/^BEGIN:VCARD\s*$/gimu) ?? []).length;
    result = {
      format: "vcard", status: cards ? "parsed" : "needs_review",
      issues: cards ? [] : [{ code: "NO_VCARDS", message: "No BEGIN:VCARD records were found" }],
      structure: { cardCount: cards, lineCount: source.split(/\r\n|\n|\r/u).length },
    };
  } else {
    const trimmed = source.trim();
    if (/^BEGIN:VCARD\b/iu.test(trimmed)) {
      const cards = (source.match(/^BEGIN:VCARD\s*$/gimu) ?? []).length;
      result = {
        format: "vcard", status: "parsed", issues: [],
        structure: { cardCount: cards, lineCount: source.split(/\r\n|\n|\r/u).length },
      };
    }
    if (!result && /^[{[]/u.test(trimmed)) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") result = inspectJson(source);
      } catch { /* An unrecognized text file remains plain text. */ }
    }
    if (!result) {
      const nonblankLines = source.split(/\r\n|\n|\r/u).filter((line) => line.trim());
      if (nonblankLines.length >= 2 && nonblankLines.every((line) => {
        try {
          const value = JSON.parse(line);
          return value && typeof value === "object" && !Array.isArray(value);
        } catch { return false; }
      })) result = inspectJsonLines(source);
    }
    if (!result) {
      const candidate = inspectTable(source, "csv");
      if (candidate.structure.sourceRecordCount >= 2
        && candidate.structure.columnCount >= 2
        && candidate.structure.inconsistentRecordCount === 0) result = candidate;
    }
  }
  if (!result) {
    const lines = source.split(/\r\n|\n|\r/u);
    result = {
      format: "text", status: "parsed", issues: [],
      structure: { lineCount: lines.length, sampleLines: lines.slice(0, 5).map((line) => previewText(line)) },
    };
  }
  return {
    declaredFormat, ...result,
    issueCount: result.issues.length,
    issuesTruncated: result.issues.length > 20,
    issues: result.issues.slice(0, 20),
  };
}
