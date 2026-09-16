import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { RE2JS } from "re2js";

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
    const fractionalDigitCounts = {};
    let decimalValueCount = 0;
    let maxFractionalDigits = 0;
    for (const { row } of nonblankRows) {
      const value = String(row[columnIndex] ?? "");
      if (!value.trim()) blankCount += 1;
      else {
        if (samples.length < 5 && !samples.includes(value)) samples.push(value);
        if (distinct.size <= 1_000) distinct.add(value);
        const decimal = /^[+-]?\d+(?:\.(\d+))?$/.exec(value.trim());
        if (decimal) {
          const digits = decimal[1]?.length ?? 0;
          decimalValueCount += 1;
          maxFractionalDigits = Math.max(maxFractionalDigits, digits);
          fractionalDigitCounts[digits] = (fractionalDigitCounts[digits] ?? 0) + 1;
        }
      }
    }
    return {
      name,
      blankCount,
      nonblankCount: nonblankRows.length - blankCount,
      distinctCount: distinct.size <= 1_000 ? distinct.size : null,
      distinctCountAtLeast: distinct.size > 1_000 ? 1_001 : null,
      samples,
      decimalProfile: decimalValueCount ? {
        valueCount: decimalValueCount,
        maxFractionalDigits,
        fractionalDigitCounts,
      } : null,
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
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const dateFormatTokens = new Map([
  ["YYYY", "(\\d{4})"], ["MM", "(\\d{1,2})"], ["DD", "(\\d{1,2})"],
  ["HH", "(\\d{2})"], ["mm", "(\\d{2})"], ["ss", "(\\d{2})"],
  ["S", "(\\d{1,9})"],
]);

function compiledDateFormat(format, { timestamp = false, assumeUtc = false } = {}) {
  if (typeof format !== "string" || format.length === 0 || format.length > 80) {
    throw new Error("Date input format must contain 1 through 80 characters");
  }
  const fields = [];
  let source = "^";
  let literals = "";
  for (let index = 0; index < format.length;) {
    if (format[index] === "[") {
      const end = format.indexOf("]", index + 1);
      if (end <= index + 1) throw new Error("Date input format has an empty or unclosed literal block");
      const literal = format.slice(index + 1, end);
      literals += literal;
      source += literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      index = end + 1;
      continue;
    }
    const token = [...dateFormatTokens.keys()].find((candidate) => format.startsWith(candidate, index));
    if (token) {
      if (fields.includes(token)) throw new Error(`Date input format repeats ${token}`);
      fields.push(token);
      source += dateFormatTokens.get(token);
      index += token.length;
    } else {
      const literal = format[index];
      literals += literal;
      source += literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      index += 1;
    }
  }
  if (!["YYYY", "MM", "DD"].every((token) => fields.includes(token))) {
    throw new Error("Date input format requires YYYY, MM, and DD");
  }
  const timeFields = ["HH", "mm", "ss"];
  const hasTime = timeFields.some((token) => fields.includes(token));
  if (hasTime && !timeFields.every((token) => fields.includes(token))) {
    throw new Error("Time input format requires HH, mm, and ss together");
  }
  if (fields.includes("S") && !hasTime) throw new Error("Fractional seconds require HH, mm, and ss");
  if (!timestamp && hasTime) throw new Error("Date input format cannot include a time");
  if (timestamp && hasTime && !assumeUtc && !literals.includes("UTC") && !literals.includes("Z")) {
    throw new Error("Timestamp input format requires a literal UTC or Z marker, or assume_utc true");
  }
  return { matcher: new RegExp(`${source}$`), fields, hasTime };
}

function normalizedTemporal(value, formats, options = {}) {
  const input = String(value ?? "").trim();
  for (const format of formats) {
    const { matcher, fields, hasTime } = typeof format === "string"
      ? compiledDateFormat(format, options) : format;
    const match = matcher.exec(input);
    if (!match) continue;
    const parts = Object.fromEntries(fields.map((field, index) => [field, match[index + 1]]));
    const year = Number(parts.YYYY);
    const month = Number(parts.MM);
    const day = Number(parts.DD);
    if (!validDateParts(year, month, day)) continue;
    const date = `${parts.YYYY}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!options.timestamp) return date;
    if (!hasTime) return `${date}T00:00:00Z`;
    if (Number(parts.HH) > 23 || Number(parts.mm) > 59 || Number(parts.ss) > 59) continue;
    return `${date}T${parts.HH}:${parts.mm}:${parts.ss}${parts.S ? `.${parts.S}` : ""}Z`;
  }
  throw new Error(`value ${JSON.stringify(input)} does not match a declared ${options.timestamp ? "UTC timestamp" : "date"} format`);
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

function decimalRatioUnits(value, operation) {
  const input = String(value ?? "").trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(input);
  if (!match || input.length > 256 || !Number.isInteger(operation.from_scale)
    || !Number.isInteger(operation.to_scale)
    || operation.from_scale < 0 || operation.from_scale > 30
    || operation.to_scale < 0 || operation.to_scale > 30) {
    throw new Error(`value ${JSON.stringify(input)} is not a supported positive decimal ratio`);
  }
  const decimalDigits = match[2]?.length ?? 0;
  let numerator = BigInt(`${match[1]}${match[2] ?? ""}`) * 10n ** BigInt(operation.to_scale);
  let denominator = 10n ** BigInt(decimalDigits + operation.from_scale);
  if (numerator === 0n) throw new Error("decimal ratio must be positive");
  let a = numerator;
  let b = denominator;
  while (b !== 0n) [a, b] = [b, a % b];
  numerator /= a;
  denominator /= a;
  return (operation.side === "from_units" ? denominator : numerator).toString();
}

function regexInput(value) {
  const input = String(value ?? "");
  if (input.length > 10_000) throw new Error("Regex input exceeds 10,000 characters");
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
    case "date": return blank(value) ? value : normalizedTemporal(value, operation.compiledFormats);
    case "timestamp": return blank(value) ? value : normalizedTemporal(value, operation.compiledFormats, {
      timestamp: true, assumeUtc: operation.assume_utc === true,
    });
    case "decimal": return blank(value) ? value : normalizedDecimal(value, operation);
    case "decimal_ratio_units": return blank(value) ? value : decimalRatioUnits(value, operation);
    case "regex_extract": {
      const match = operation.compiledRegex.exec(regexInput(value));
      if (!match) throw new Error("Regex extraction did not match the value");
      const selected = typeof operation.group === "string"
        ? match.groups?.[operation.group] : match[operation.group];
      if (selected == null) throw new Error(`Regex group ${JSON.stringify(operation.group)} did not match`);
      return selected;
    }
    case "regex_replace": {
      const matcher = operation.compiledRegex.matcher(regexInput(value));
      const result = operation.replace_all
        ? matcher.replaceAll(operation.replacement) : matcher.replaceFirst(operation.replacement);
      if (result.length > 100_000) throw new Error("Regex replacement exceeds 100,000 characters");
      return result;
    }
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
  const preparedFields = [];
  for (const field of mapping.fields) {
    const hasRecordNumber = field.source_record_number === true;
    const hasConstant = Object.hasOwn(field, "constant");
    const columns = field.source_columns ?? (field.source_column ? [field.source_column] : []);
    if (Number(hasRecordNumber) + Number(hasConstant) + Number(columns.length > 0) !== 1) {
      throw new Error(`Mapping field ${field.output_field} needs exactly one of source columns, source_record_number, or constant`);
    }
    const missing = columns.filter((column) => !headerSet.has(column));
    if (missing.length) throw new Error(`Mapping field ${field.output_field} references missing columns: ${missing.join(", ")}`);
    const preparedOperations = [];
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
      if (["date", "timestamp"].includes(operation.op)) {
        if (!operation.input_formats?.length) {
          throw new Error(`${operation.op} on ${field.output_field} requires input_formats`);
        }
        const compiledFormats = operation.input_formats.map((format) => compiledDateFormat(format, {
          timestamp: operation.op === "timestamp", assumeUtc: operation.assume_utc === true,
        }));
        preparedOperations.push({ ...operation, compiledFormats });
      }
      if (operation.op === "decimal_ratio_units" && (
        !["from_units", "to_units"].includes(operation.side)
        || !Number.isInteger(operation.from_scale) || !Number.isInteger(operation.to_scale)
      )) {
        throw new Error(`decimal_ratio_units on ${field.output_field} requires side, from_scale, and to_scale`);
      }
      if (["regex_extract", "regex_replace"].includes(operation.op)) {
        if (typeof operation.pattern !== "string" || !operation.pattern || operation.pattern.length > 256) {
          throw new Error(`${operation.op} on ${field.output_field} requires a pattern of 1 through 256 characters`);
        }
        if (operation.op === "regex_extract" && !(Number.isInteger(operation.group)
          && operation.group >= 0 && operation.group <= 50) && !(typeof operation.group === "string"
          && operation.group.length > 0 && operation.group.length <= 80)) {
          throw new Error(`regex_extract on ${field.output_field} requires a group number or name`);
        }
        if (operation.op === "regex_replace" && (typeof operation.replacement !== "string"
          || typeof operation.replace_all !== "boolean")) {
          throw new Error(`regex_replace on ${field.output_field} requires replacement and replace_all`);
        }
        let compiledRegex;
        try {
          const flags = (operation.case_sensitive === false ? RE2JS.CASE_INSENSITIVE : 0)
            | (operation.multiline === true ? RE2JS.MULTILINE : 0);
          compiledRegex = RE2JS.compile(operation.pattern, flags);
          if (compiledRegex.programSize() > 10_000) {
            throw new Error("compiled regex exceeds 10,000 program instructions");
          }
        } catch (error) {
          throw new Error(`Invalid regex on ${field.output_field}: ${error.message}`);
        }
        preparedOperations.push({ ...operation, compiledRegex });
      } else if (!["date", "timestamp"].includes(operation.op)) preparedOperations.push(operation);
      if (operation.op === "boolean" && (!operation.true_values?.length || !operation.false_values?.length)) {
        throw new Error(`boolean on ${field.output_field} requires true_values and false_values`);
      }
    }
    preparedFields.push({ ...field, transforms: preparedOperations });
  }
  return preparedFields;
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
