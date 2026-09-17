import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  detectDelimiter,
  inspectDelimitedText,
  parseDelimitedRows,
  readDelimitedRecords,
  transformDelimitedText,
} from "../src/tabular-transform.mjs";
import { registerFileTools } from "../src/tools/file-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

test("delimited parser handles commas, tabs, escaped quotes, and embedded newlines", () => {
  assert.deepEqual(parseDelimitedRows('id,note\r\n1,"hello, ""world""\nagain"\r\n', ","), [
    ["id", "note"],
    ["1", 'hello, "world"\nagain'],
  ]);
  const tsv = "id\taccount\n1\tAssets:Cash\n2\tExpenses:Food\n";
  assert.equal(detectDelimiter(tsv), "\t");
  assert.deepEqual(parseDelimitedRows(tsv, "\t")[1], ["1", "Assets:Cash"]);
  assert.throws(() => parseDelimitedRows('id,note\n1,"unfinished\n', ","), /unterminated quoted field/);
});

test("table inspection reads the complete source but returns bounded representative evidence", () => {
  const inspected = inspectDelimitedText(
    "Transaction ID;Account;Amount\n1;Assets:Cash;$10.00\n1;Income:Sales;$(10.00)\n\n",
    { delimiter: "auto", headerRow: true, sampleSize: 1 },
  );
  assert.equal(inspected.delimiter, ";");
  assert.equal(inspected.sourceRecordCount, 2);
  assert.equal(inspected.blankRecordCount, 1);
  assert.deepEqual(inspected.headers, ["Transaction ID", "Account", "Amount"]);
  assert.equal(inspected.sampleRecords.length, 1);
  assert.equal(inspected.columns[1].distinctCount, 2);
});

test("an unnamed CSV column keeps its values and a unique positional name through transformation", () => {
  const source = "Timestamp,Type,,column_3\n2026-09-16,Sell,source-note,existing-value\n";
  const inspected = inspectDelimitedText(source, { delimiter: "comma", headerRow: true });
  assert.deepEqual(inspected.headers, ["Timestamp", "Type", "column_3_2", "column_3"]);
  assert.deepEqual(inspected.sampleRecords[0].values, {
    Timestamp: "2026-09-16", Type: "Sell",
    column_3_2: "source-note", column_3: "existing-value",
  });

  const transformed = transformDelimitedText(source, {
    delimiter: "comma", headerRow: true,
    mapping: { fields: [
      { output_field: "note", source_column: "column_3_2" },
      { output_field: "other", source_column: "column_3" },
    ] },
  });
  assert.equal(transformed.exceptionRecordCount, 0);
  assert.deepEqual(transformed.records[0].record, {
    note: "source-note", other: "existing-value",
  });
  const duplicate = inspectDelimitedText("Name,Name\na,b\n", {
    delimiter: "comma", headerRow: true,
  });
  assert.deepEqual(duplicate.headers, ["Name", "column_2"]);
  assert.deepEqual(duplicate.headerAdjustments, [{
    columnNumber: 2, sourceHeader: "Name", effectiveHeader: "column_2", reason: "duplicate",
  }]);
  assert.deepEqual(duplicate.sampleRecords[0].values, { Name: "a", column_2: "b" });
  const page = readDelimitedRecords("Name,Name\na,b\nc,d,e\n", {
    delimiter: "comma", headerRow: true, startRecord: 2, limit: 1,
  });
  assert.deepEqual(page.records[0], {
    sourceRecordNumber: 2,
    cells: ["c", "d", "e"],
    values: { Name: "c", column_2: "d" },
    matchesHeaderWidth: false,
  });
  assert.equal(page.totalRecordCount, 2);
  assert.equal(page.hasMore, false);
});

test("one declarative mapping transforms every valid record and isolates exceptions", () => {
  const transformed = transformDelimitedText([
    "Txn\tDate\tAccount\tAmount\tCleared",
    "tx-1\t8/27/2026\tAssets:Bank:Checking\t$1,234.50\tY",
    "tx-1\t8/27/2026\tIncome:Work\t$(1,234.50)\tY",
    "tx-2\tbad-date\tExpenses:Food\t12.00\tN",
    "too\tfew\tcolumns",
    "",
  ].join("\n"), {
    delimiter: "tab",
    headerRow: true,
    mapping: {
      fields: [
        { output_field: "transaction_external_id", source_column: "Txn", transforms: [{ op: "trim" }] },
        {
          output_field: "transaction_date", source_column: "Date",
          transforms: [{ op: "date", input_formats: ["MM/DD/YYYY", "YYYY-MM-DD"] }],
        },
        { output_field: "account_full_name", source_column: "Account", transforms: [{ op: "trim" }] },
        {
          output_field: "account_name", source_column: "Account",
          transforms: [{ op: "split", delimiter: ":", index: -1 }, { op: "trim" }],
        },
        {
          output_field: "amount_decimal", source_column: "Amount",
          transforms: [{
            op: "decimal", decimal_separator: ".", grouping_separator: ",",
            currency_symbols: ["$"], parentheses_negative: true,
          }],
        },
        {
          output_field: "cleared", source_column: "Cleared",
          transforms: [{ op: "boolean", true_values: ["Y"], false_values: ["N"], case_sensitive: false }],
        },
        { output_field: "source_record_number", source_record_number: true },
        { output_field: "source_system", constant: "gnucash" },
      ],
    },
    targetSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        transaction_external_id: { type: "string", minLength: 1 },
        transaction_date: { type: "string", format: "date" },
        account_full_name: { type: "string", minLength: 1 },
        account_name: { type: "string", minLength: 1 },
        amount_decimal: { type: "string", pattern: "^-?\\d+(?:\\.\\d+)?$" },
        cleared: { type: "boolean" },
        source_record_number: { type: "integer", minimum: 1 },
        source_system: { const: "gnucash" },
      },
      required: [
        "transaction_external_id", "transaction_date", "account_full_name", "account_name",
        "amount_decimal", "cleared", "source_record_number", "source_system",
      ],
    },
  });
  assert.equal(transformed.sourceRecordCount, 4);
  assert.equal(transformed.transformedRecordCount, 2);
  assert.equal(transformed.exceptionRecordCount, 2);
  assert.equal(transformed.blankRecordCount, 0);
  assert.deepEqual(transformed.records[0].record, {
    transaction_external_id: "tx-1",
    transaction_date: "2026-08-27",
    account_full_name: "Assets:Bank:Checking",
    account_name: "Checking",
    amount_decimal: "1234.50",
    cleared: true,
    source_record_number: 1,
    source_system: "gnucash",
  });
  assert.equal(transformed.records[1].record.amount_decimal, "-1234.50");
  assert.deepEqual(transformed.exceptions.map(({ code }) => code), [
    "TRANSFORM_FAILED", "COLUMN_COUNT_MISMATCH",
  ]);
});

test("mapping errors fail before processing rather than becoming one exception per row", () => {
  assert.throws(() => transformDelimitedText("A,B\n1,2\n", {
    delimiter: "comma",
    mapping: { fields: [{ output_field: "value", source_column: "Missing" }] },
  }), /missing columns: Missing/);
  assert.throws(() => transformDelimitedText("A,B\n1,2\n", {
    delimiter: "comma",
    mapping: {
      fields: [{
        output_field: "value", source_columns: ["A", "B"], source_mode: "first_nonblank",
        transforms: [{ op: "join", delimiter: ":" }],
      }],
    },
  }), /requires source_mode array/);
});

test("BTC price CSV maps exact UTC timestamps and native-unit ratios without rounding", () => {
  const source = [
    "event_date,close_price_usd,market_cap_usd,volume_usd",
    "2013-04-28 00:00:00 UTC,141.96,1500517590,0",
    "2026-09-14 00:00:00 UTC,78173.35158344489,1542831471374.2715,16138951580.829597",
    '2026-09-16 00:00:00 UTC,"",1518224622698.2222,39803154169.39753',
  ].join("\n");
  const inspected = inspectDelimitedText(source, { delimiter: "comma", sampleSize: 2 });
  assert.deepEqual(inspected.columns[1].decimalProfile, {
    valueCount: 2,
    maxFractionalDigits: 11,
    fractionalDigitCounts: { 2: 1, 11: 1 },
  });
  assert.equal(inspected.columns[1].blankCount, 1);

  const ratio = (side) => ({
    output_field: side,
    source_column: "close_price_usd",
    transforms: [{ op: "decimal" }, {
      op: "decimal_ratio_units", from_scale: 8, to_scale: 2, side,
    }],
  });
  const transformed = transformDelimitedText(source, {
    delimiter: "comma",
    mapping: { fields: [
      { output_field: "valid_at", source_column: "event_date", transforms: [{
        op: "timestamp", input_formats: ["YYYY-MM-DD HH:mm:ss UTC"],
      }] },
      ratio("from_units"), ratio("to_units"),
      { output_field: "from_currency_id", constant: 2 },
      { output_field: "to_currency_id", constant: 1 },
    ] },
    targetSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        valid_at: { type: "string", format: "date-time" },
        from_units: { type: "string", pattern: "^[1-9]\\d*$" },
        to_units: { type: "string", pattern: "^[1-9]\\d*$" },
        from_currency_id: { const: 2 }, to_currency_id: { const: 1 },
      },
      required: ["valid_at", "from_units", "to_units", "from_currency_id", "to_currency_id"],
    },
  });
  assert.equal(transformed.sourceRecordCount, 3);
  assert.equal(transformed.transformedRecordCount, 2);
  assert.equal(transformed.exceptionRecordCount, 1);
  assert.equal(transformed.exceptions[0].source_record_number, 3);
  assert.equal(transformed.exceptions[0].code, "TARGET_SCHEMA_INVALID");
  assert.equal(transformed.records[0].record.valid_at, "2013-04-28T00:00:00Z");
  assert.equal(
    BigInt(transformed.records[0].record.to_units) * 100000000n,
    BigInt(transformed.records[0].record.from_units) * 14196n,
  );
  const precise = transformed.records[1].record;
  assert.equal(precise.valid_at, "2026-09-14T00:00:00Z");
  assert.equal(
    BigInt(precise.to_units) * 100000000n * 100000000000n,
    BigInt(precise.from_units) * 7817335158344489n * 100n,
  );
});

test("UTC timestamp and ratio transforms reject impossible dates and nonpositive prices", () => {
  const transformed = transformDelimitedText([
    "time,price",
    "2026-02-30 00:00:00 UTC,1.25",
    "2026-02-28 24:00:00 UTC,1.25",
    "2026-02-28 00:00:00 UTC,0",
    "2026-02-28 00:00:00 UTC,-1.25",
  ].join("\n"), {
    mapping: { fields: [
      { output_field: "valid_at", source_column: "time", transforms: [{
        op: "timestamp", input_formats: ["YYYY-MM-DD HH:mm:ss UTC"],
      }] },
      { output_field: "from_units", source_column: "price", transforms: [{
        op: "decimal_ratio_units", from_scale: 8, to_scale: 2, side: "from_units",
      }] },
    ] },
  });
  assert.equal(transformed.transformedRecordCount, 0);
  assert.equal(transformed.exceptionRecordCount, 4);
  assert.ok(transformed.exceptions.every(({ code }) => code === "TRANSFORM_FAILED"));
});

test("declared date templates cover new separators and ordering without parser code changes", () => {
  const transformed = transformDelimitedText("time\n16.09.2026 12:34:56 UTC\n", {
    delimiter: "comma",
    mapping: { fields: [{
      output_field: "valid_at", source_column: "time",
      transforms: [{ op: "timestamp", input_formats: ["DD.MM.YYYY HH:mm:ss [UTC]"] }],
    }] },
  });
  assert.equal(transformed.records[0].record.valid_at, "2026-09-16T12:34:56Z");
  assert.throws(() => transformDelimitedText("time\n16.09.2026 12:34:56\n", {
    delimiter: "comma",
    mapping: { fields: [{
      output_field: "valid_at", source_column: "time",
      transforms: [{ op: "timestamp", input_formats: ["DD.MM.YYYY HH:mm:ss"] }],
    }] },
  }), /requires a literal UTC or Z marker/);
});

test("RE2 regex operations extract captures and replace literal periods across a table", () => {
  const transformed = transformDelimitedText([
    "source",
    "BTC.Price=141.96 USD",
    "BTC.Price=135.3 USD",
    "invalid",
  ].join("\n"), {
    delimiter: "comma",
    mapping: { fields: [
      {
        output_field: "price", source_column: "source",
        transforms: [
          { op: "regex_extract", pattern: "^BTC\\.Price=(?<price>\\d+(?:\\.\\d+)?) USD$", group: "price" },
          { op: "decimal" },
        ],
      },
      {
        output_field: "normalized_label", source_column: "source",
        transforms: [{
          op: "regex_replace", pattern: "\\.", replacement: "-", replace_all: true,
        }],
      },
      {
        output_field: "reordered_label", source_column: "source",
        transforms: [{
          op: "regex_replace", pattern: "^(BTC)\\.Price=(.+)$", replacement: "$1/$2", replace_all: false,
        }],
      },
    ] },
  });
  assert.equal(transformed.transformedRecordCount, 2);
  assert.deepEqual(transformed.records[0].record, {
    price: "141.96", normalized_label: "BTC-Price=141-96 USD",
    reordered_label: "BTC/141.96 USD",
  });
  assert.equal(transformed.records[1].record.price, "135.3");
  assert.equal(transformed.exceptions[0].source_record_number, 3);
  assert.match(transformed.exceptions[0].message, /did not match/);
  assert.throws(() => transformDelimitedText("source\na\n", {
    delimiter: "comma",
    mapping: { fields: [{ output_field: "bad", source_column: "source", transforms: [{
      op: "regex_extract", pattern: "(?<=a)b", group: 0,
    }] }] },
  }), /Invalid regex/);
});

test("published file tool schema exposes exact timestamp and ratio transforms", () => {
  const registry = new ToolRegistry();
  registerFileTools(registry, { ledger: {}, searchCoordinator: {}, mediaRoot: "/tmp", maximumTextBytes: 4096 });
  const tool = registry.tools.get("file_table_transform");
  const operation = tool.parameters.properties.mapping.properties.fields.items.properties.transforms.items;
  assert.ok(operation.properties.op.enum.includes("timestamp"));
  assert.ok(operation.properties.op.enum.includes("decimal_ratio_units"));
  assert.ok(operation.properties.op.enum.includes("regex_extract"));
  assert.ok(operation.properties.op.enum.includes("regex_replace"));
  assert.equal(operation.properties.input_formats.items.type, "string");
  assert.equal(operation.properties.pattern.maxLength, 256);
  assert.deepEqual(operation.properties.side.enum, ["from_units", "to_units"]);
  assert.match(tool.description, /RE2 regex extraction\/replacement/);
  assert.equal(registry.get("file_table_read_rows").annotations.readOnlyHint, true);
});

test("file tools expose header repairs and exact irregular rows from a verified upload", async (context) => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "table-rows-"));
  context.after(() => fs.rmSync(mediaRoot, { recursive: true, force: true }));
  const source = "Date,Amount,,Amount\n2026-09-16,1,note,2\n2026-09-17,3,note,4,extra\n";
  fs.writeFileSync(path.join(mediaRoot, "statement.csv"), source);
  const stored = {
    file_id: 8, storage_path: "media/statement.csv", original_filename: "statement.csv",
    media_kind: "document", mime_type: "text/csv", byte_size: Buffer.byteLength(source),
    sha256: createHash("sha256").update(source).digest("hex"),
  };
  const registry = new ToolRegistry();
  registerFileTools(registry, {
    ledger: {
      file: () => stored,
      fileDetails: () => ({ fileId: 8, originalFilename: "statement.csv" }),
    },
    searchCoordinator: {}, mediaRoot, maximumTextBytes: 4096,
  });
  const inspected = await registry.execute("file_table_inspect", {
    file_id: 8, delimiter: "auto", header_row: true, sample_size: 1,
  });
  assert.deepEqual(inspected.headers, ["Date", "Amount", "column_3", "column_4"]);
  assert.deepEqual(inspected.headerAdjustments.map(({ reason }) => reason), ["blank", "duplicate"]);
  assert.deepEqual(inspected.inconsistentRecordNumbers, [2]);

  const page = await registry.execute("file_table_read_rows", {
    file_id: 8, delimiter: inspected.delimiter, header_row: true,
    start_record: 2, limit: 1,
  });
  assert.deepEqual(page.records[0].cells, ["2026-09-17", "3", "note", "4", "extra"]);
  assert.equal(page.records[0].matchesHeaderWidth, false);
  assert.equal(page.hasMore, false);
  assert.deepEqual(fs.readdirSync(mediaRoot), ["statement.csv"]);
});

test("read-only mapping preview checks a verified whole file before artifact creation", async (context) => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "table-preview-"));
  context.after(() => fs.rmSync(mediaRoot, { recursive: true, force: true }));
  const source = "value\nBTC.Price=141.96\ninvalid\n";
  fs.writeFileSync(path.join(mediaRoot, "prices.csv"), source);
  const stored = {
    file_id: 7, storage_path: "media/prices.csv", original_filename: "prices.csv",
    media_kind: "document", mime_type: "text/csv", byte_size: Buffer.byteLength(source),
    sha256: createHash("sha256").update(source).digest("hex"),
  };
  const registry = new ToolRegistry();
  registerFileTools(registry, {
    ledger: {
      file: () => stored,
      fileDetails: () => ({ fileId: 7, originalFilename: "prices.csv" }),
      registerFile: () => { throw new Error("preview must not write"); },
    },
    searchCoordinator: {}, mediaRoot, maximumTextBytes: 4096,
  });
  const preview = await registry.execute("file_table_transform_preview", {
    file_id: 7, delimiter: "comma", header_row: true,
    mapping: { fields: [{ output_field: "price", source_column: "value", transforms: [{
      op: "regex_extract", pattern: "^BTC\\.Price=(\\d+(?:\\.\\d+)?)$", group: 1,
    }] }] },
    target_schema: { type: "object", properties: { price: { type: "string" } }, required: ["price"] },
  });
  assert.equal(registry.get("file_table_transform_preview").annotations.readOnlyHint, true);
  assert.equal(preview.verified, true);
  assert.equal(preview.transformedRecordCount, 1);
  assert.equal(preview.exceptionRecordCount, 1);
  assert.deepEqual(preview.outputPreview, [{ source_record_number: 1, record: { price: "141.96" } }]);
  assert.equal(preview.exceptionPreview[0].source_record_number, 2);
  assert.deepEqual(fs.readdirSync(mediaRoot), ["prices.csv"]);
});
