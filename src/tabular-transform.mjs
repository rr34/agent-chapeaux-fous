import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const delimiterNames = new Map([
  ["comma", ","],
  ["tab", "\t"],
  ["semicolon", ";"],
  ["pipe", "|"],
]);
const automaticDelimiters = [",", "\t", ";", "|"];
const maximumColumns = 1_000;
const maximumRows = 500_000;

function selectedDelimiter(value) {
  const selected = String(value ?? "auto");
  if (selected === "auto") return null;
  if (delimiterNames.has(selected)) return delimiterNames.get(selected);
  if ([...selected].length !== 1 || ['"', "\r", "\n"].includes(selected)) {
    throw new Error("delimiter must be auto, comma, tab, semicolon, pipe, or one literal character");
  }
  return selected;
}

export function parseDelimitedRows(text, delimiter = ",") {
  if ([...delimiter].length !== 1 || ['"', "\r", "\n"].includes(delimiter)) {
    throw new Error("A delimiter must be one literal character other than a quote or line break");
  }
  const input = String(text ?? "");
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  let closedQuote = false;
  let fieldStarted = false;
  const finishField = () => {
    row.push(value);
    value = "";
    closedQuote = false;
    fieldStarted = false;
  };
  const finishRow = () => {
    finishField();
    if (row.length > maximumColumns) throw new Error(`Delimited file exceeds ${maximumColumns} columns`);
    rows.push(row);
    if (rows.length > maximumRows) throw new Error(`Delimited file exceeds ${maximumRows} records`);
    row = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
        closedQuote = true;
      } else value += character;
      continue;
    }
    if (closedQuote && character !== delimiter && character !== "\n" && character !== "\r") {
      throw new Error("Delimited file contains characters after a closing quote");
    }
    if (character === '"') {
      if (fieldStarted || value !== "") throw new Error("Delimited file contains a quote inside an unquoted field");
      quoted = true;
      fieldStarted = true;
    } else if (character === delimiter) finishField();
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      finishRow();
    } else {
      value += character;
      fieldStarted = true;
    }
  }
  if (quoted) throw new Error("Delimited file has an unterminated quoted field");
  if (closedQuote || fieldStarted || value !== "" || row.length > 0) finishRow();
  return rows;
}

function nonblankRow(row) {
  return row.some((value) => String(value).trim() !== "");
}

function modalWidth(rows) {
  const counts = new Map();
  for (const row of rows.filter(nonblankRow).slice(0, 100)) {
    counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0])[0] ?? [0, 0];
}

export function detectDelimiter(text) {
  const candidates = automaticDelimiters.flatMap((delimiter, order) => {
    try {
      const rows = parseDelimitedRows(text, delimiter);
      const [width, matches] = modalWidth(rows);
      if (width < 2) return [];
      return [{ delimiter, score: matches * 10_000 + width * 10 - order }];
    } catch {
      return [];
    }
  });
  const winner = candidates.sort((left, right) => right.score - left.score)[0];
  if (!winner) throw new Error("Could not detect a consistent comma, tab, semicolon, or pipe delimiter");
  return winner.delimiter;
}

function table(text, { delimiter = "auto", headerRow = true } = {}) {
  const resolvedDelimiter = selectedDelimiter(delimiter) ?? detectDelimiter(text);
  const rows = parseDelimitedRows(text, resolvedDelimiter);
  if (rows.length === 0) throw new Error("Delimited file is empty");
  const maximumWidth = Math.max(...rows.map((row) => row.length));
  const headers = headerRow
    ? rows[0].map((header) => String(header).trim())
    : Array.from({ length: maximumWidth }, (_unused, index) => `column_${index + 1}`);
  if (headers.length > maximumColumns) throw new Error(`Delimited file exceeds ${maximumColumns} columns`);
  if (headers.some((header) => !header)) throw new Error("Delimited file contains a blank header");
  if (new Set(headers).size !== headers.length) throw new Error("Delimited file contains duplicate headers");
  return {
    delimiter: resolvedDelimiter,
    headers,
    rows: headerRow ? rows.slice(1) : rows,
  };
}

export function inspectDelimitedText(text, options = {}) {
  const parsed = table(text, options);
  const sampleSize = Math.min(50, Math.max(1, Number(options.sampleSize) || 10));
  const indexedRows = parsed.rows.map((row, index) => ({ row, sourceRecordNumber: index + 1 }));
  const nonblankRows = indexedRows.filter(({ row }) => nonblankRow(row));
  const blankRowCount = parsed.rows.length - nonblankRows.length;
  const inconsistentRecordNumbers = [];
  const profiles = parsed.headers.map((name, columnIndex) => {
    let blankCount = 0;
    const distinct = new Set();
    const samples = [];
    for (const { row } of nonblankRows) {
      const value = String(row[columnIndex] ?? "");
      if (!value.trim()) blankCount += 1;
      else {
        if (samples.length < 5 && !samples.includes(value)) samples.push(value);
        if (distinct.size <= 1_000) distinct.add(value);
      }
    }
    return {
      name,
      blankCount,
      nonblankCount: nonblankRows.length - blankCount,
      distinctCount: distinct.size <= 1_000 ? distinct.size : null,
      distinctCountAtLeast: distinct.size > 1_000 ? 1_001 : null,
      samples,
    };
  });
  for (const [index, row] of parsed.rows.entries()) {
    if (nonblankRow(row) && row.length !== parsed.headers.length && inconsistentRecordNumbers.length < 100) {
      inconsistentRecordNumbers.push(index + 1);
    }
  }
  return {
    delimiter: parsed.delimiter,
    delimiterName: [...delimiterNames.entries()].find(([, value]) => value === parsed.delimiter)?.[0] ?? "custom",
    headers: parsed.headers,
    sourceRecordCount: nonblankRows.length,
    blankRecordCount: blankRowCount,
    inconsistentRecordCount: parsed.rows.filter((row) => nonblankRow(row) && row.length !== parsed.headers.length).length,
    inconsistentRecordNumbers,
    columns: profiles,
    sampleRecords: nonblankRows.slice(0, sampleSize).map(({ row, sourceRecordNumber }) => ({
      source_record_number: sourceRecordNumber,
      values: Object.fromEntries(parsed.headers.map((header, columnIndex) => [header, row[columnIndex] ?? ""])),
    })),
  };
}

function blank(value) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function mappedValue(field, source, sourceRecordNumber) {
  if (field.source_record_number === true) return sourceRecordNumber;
  if (Object.hasOwn(field, "constant")) return structuredClone(field.constant);
  const columns = field.source_columns ?? (field.source_column ? [field.source_column] : []);
  if (columns.length === 0) return null;
  const values = columns.map((column) => source[column] ?? "");
  if (field.source_mode === "array") return values;
  return values.find((value) => !blank(value)) ?? "";
}

function validDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizedDate(value, formats) {
  const input = String(value ?? "").trim();
  for (const format of formats) {
    let match;
    let parts;
    if (format === "YYYY-MM-DD" && (match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(input))) parts = [match[1], match[2], match[3]];
    else if (format === "YYYYMMDD" && (match = /^(\d{4})(\d{2})(\d{2})$/.exec(input))) parts = [match[1], match[2], match[3]];
    else if (format === "MM/DD/YYYY" && (match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input))) parts = [match[3], match[1], match[2]];
    else if (format === "DD/MM/YYYY" && (match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input))) parts = [match[3], match[2], match[1]];
    if (!parts) continue;
    const [year, month, day] = parts.map(Number);
    if (validDateParts(year, month, day)) {
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  throw new Error(`value ${JSON.stringify(input)} does not match an allowed date format`);
}

function normalizedDecimal(value, operation) {
  let input = String(value ?? "").trim();
  let negative = false;
  for (const symbol of operation.currency_symbols ?? []) input = input.replaceAll(symbol, "");
  input = input.trim();
  if (operation.parentheses_negative !== false && /^\(.*\)$/.test(input)) {
    negative = true;
    input = input.slice(1, -1).trim();
  }
  const grouping = operation.grouping_separator ?? null;
  const decimal = operation.decimal_separator ?? ".";
  if (grouping) input = input.replaceAll(grouping, "");
  if (decimal !== ".") input = input.replace(decimal, ".");
  input = input.trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(input)) {
    throw new Error(`value ${JSON.stringify(value)} is not a supported decimal`);
  }
  if (negative) input = input.startsWith("-") ? input.slice(1) : `-${input.replace(/^\+/, "")}`;
  else input = input.replace(/^\+/, "");
  return input;
}

function applyOperation(value, operation) {
  switch (operation.op) {
    case "trim":
      return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()) : String(value ?? "").trim();
    case "lowercase": return String(value ?? "").toLocaleLowerCase();
    case "uppercase": return String(value ?? "").toLocaleUpperCase();
    case "split": {
      const parts = String(value ?? "").split(operation.delimiter);
      const index = operation.index < 0 ? parts.length + operation.index : operation.index;
      if (index < 0 || index >= parts.length) throw new Error(`split index ${operation.index} is outside the value`);
      return parts[index];
    }
    case "join":
      if (!Array.isArray(value)) throw new Error("join requires source_mode array");
      return value.filter((item) => !blank(item)).join(operation.delimiter);
    case "replace": {
      const key = String(value ?? "");
      return Object.hasOwn(operation.values, key) ? structuredClone(operation.values[key]) : value;
    }
    case "default": return blank(value) ? structuredClone(operation.value) : value;
    case "date": return blank(value) ? value : normalizedDate(value, operation.input_formats);
    case "decimal": return blank(value) ? value : normalizedDecimal(value, operation);
    case "boolean": {
      const selected = String(value ?? "");
      const comparable = operation.case_sensitive ? selected : selected.toLocaleLowerCase();
      const normalized = (items) => items.map((item) => operation.case_sensitive ? item : item.toLocaleLowerCase());
      if (normalized(operation.true_values).includes(comparable)) return true;
      if (normalized(operation.false_values).includes(comparable)) return false;
      throw new Error(`value ${JSON.stringify(selected)} is not in the declared boolean values`);
    }
    default: throw new Error(`Unknown transform operation: ${operation.op}`);
  }
}

function mappingConfiguration(mapping, headers) {
  if (!mapping || !Array.isArray(mapping.fields) || mapping.fields.length === 0) {
    throw new Error("mapping.fields must contain at least one output field");
  }
  const outputNames = mapping.fields.map(({ output_field: name }) => String(name ?? "").trim());
  if (outputNames.some((name) => !name)) throw new Error("Every mapping field needs output_field");
  if (new Set(outputNames).size !== outputNames.length) throw new Error("mapping contains duplicate output fields");
  const headerSet = new Set(headers);
  for (const field of mapping.fields) {
    const hasRecordNumber = field.source_record_number === true;
    const hasConstant = Object.hasOwn(field, "constant");
    const columns = field.source_columns ?? (field.source_column ? [field.source_column] : []);
    if (Number(hasRecordNumber) + Number(hasConstant) + Number(columns.length > 0) !== 1) {
      throw new Error(`Mapping field ${field.output_field} needs exactly one of source columns, source_record_number, or constant`);
    }
    const missing = columns.filter((column) => !headerSet.has(column));
    if (missing.length) throw new Error(`Mapping field ${field.output_field} references missing columns: ${missing.join(", ")}`);
    for (const operation of field.transforms ?? []) {
      if (["split", "join"].includes(operation.op) && typeof operation.delimiter !== "string") {
        throw new Error(`${operation.op} on ${field.output_field} requires delimiter`);
      }
      if (operation.op === "split" && !Number.isInteger(operation.index)) {
        throw new Error(`split on ${field.output_field} requires an integer index`);
      }
      if (operation.op === "join" && field.source_mode !== "array") {
        throw new Error(`join on ${field.output_field} requires source_mode array`);
      }
      if (operation.op === "replace" && (!operation.values || typeof operation.values !== "object")) {
        throw new Error(`replace on ${field.output_field} requires values`);
      }
      if (operation.op === "default" && !Object.hasOwn(operation, "value")) {
        throw new Error(`default on ${field.output_field} requires value`);
      }
      if (operation.op === "date" && !operation.input_formats?.length) {
        throw new Error(`date on ${field.output_field} requires input_formats`);
      }
      if (operation.op === "boolean" && (!operation.true_values?.length || !operation.false_values?.length)) {
        throw new Error(`boolean on ${field.output_field} requires true_values and false_values`);
      }
    }
  }
  return mapping.fields;
}

function schemaValidator(schema) {
  if (schema == null) return null;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  try {
    return ajv.compile(schema);
  } catch (error) {
    throw new Error(`target_schema is invalid: ${error.message}`);
  }
}

function validationErrors(validator) {
  return (validator?.errors ?? []).map((error) => ({
    path: error.instancePath || "/",
    keyword: error.keyword,
    message: error.message ?? "schema validation failed",
    params: error.params,
  }));
}

export function transformDelimitedText(text, {
  delimiter = "auto", headerRow = true, mapping, targetSchema = null,
} = {}) {
  const parsed = table(text, { delimiter, headerRow });
  const fields = mappingConfiguration(mapping, parsed.headers);
  const validator = schemaValidator(targetSchema);
  const records = [];
  const exceptions = [];
  let blankRecordCount = 0;
  for (const [index, row] of parsed.rows.entries()) {
    const sourceRecordNumber = index + 1;
    if (!nonblankRow(row)) {
      blankRecordCount += 1;
      continue;
    }
    const source = Object.fromEntries(parsed.headers.map((header, columnIndex) => [header, row[columnIndex] ?? ""]));
    if (row.length !== parsed.headers.length) {
      exceptions.push({
        source_record_number: sourceRecordNumber,
        code: "COLUMN_COUNT_MISMATCH",
        message: `Record has ${row.length} columns; expected ${parsed.headers.length}`,
        source,
      });
      continue;
    }
    try {
      const record = {};
      for (const field of fields) {
        let value = mappedValue(field, source, sourceRecordNumber);
        for (const operation of field.transforms ?? []) value = applyOperation(value, operation);
        const emptyMode = field.empty_value ?? "null";
        if (blank(value) && emptyMode === "omit") continue;
        record[field.output_field] = blank(value) && emptyMode === "null" ? null : value;
      }
      if (validator && !validator(record)) {
        exceptions.push({
          source_record_number: sourceRecordNumber,
          code: "TARGET_SCHEMA_INVALID",
          message: "Transformed record does not match target_schema",
          errors: validationErrors(validator),
          source,
          record,
        });
      } else records.push({ sourceRecordNumber, record });
    } catch (error) {
      exceptions.push({
        source_record_number: sourceRecordNumber,
        code: "TRANSFORM_FAILED",
        message: error instanceof Error ? error.message : String(error),
        source,
      });
    }
  }
  const mappingHash = createHash("sha256").update(JSON.stringify({
    delimiter: parsed.delimiter, headerRow, mapping, targetSchema,
  })).digest("hex");
  return {
    delimiter: parsed.delimiter,
    headers: parsed.headers,
    sourceRecordCount: records.length + exceptions.length,
    blankRecordCount,
    transformedRecordCount: records.length,
    exceptionRecordCount: exceptions.length,
    mappingHash,
    records,
    exceptions,
  };
}
