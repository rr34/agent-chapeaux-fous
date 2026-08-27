import assert from "node:assert/strict";
import test from "node:test";
import {
  detectDelimiter,
  inspectDelimitedText,
  parseDelimitedRows,
  transformDelimitedText,
} from "../src/tabular-transform.mjs";

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
