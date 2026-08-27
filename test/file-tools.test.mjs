import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { SearchCoordinator } from "../src/search/search-coordinator.mjs";
import { FileSearchProvider } from "../src/search/providers/file-search-provider.mjs";
import { registerFileTools } from "../src/tools/file-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("stable file tools find, inspect, verify, page, and safely title an upload", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-slayer-file-tools-"));
  context.after(() => fs.rmSync(mediaRoot, { recursive: true, force: true }));
  const text = "path,currency\nAssets:Cash,USD\nAssets:Brokerage,QQQ\n";
  fs.writeFileSync(path.join(mediaRoot, "account-tree.csv"), text);
  const file = ledger.registerFile({
    storagePath: "media/account-tree.csv",
    originalFilename: "account-tree.csv",
    title: "account-tree.csv",
    description: "CSV with 2 data rows. Columns: path, currency.",
    mediaKind: "document",
    mimeType: "text/csv",
    sha256: createHash("sha256").update(text).digest("hex"),
    byteSize: Buffer.byteLength(text),
  });
  const request = ledger.createRequest({
    text: "Import the complete brokerage account hierarchy.",
    primaryFileId: file.fileId,
  });
  const coordinator = new SearchCoordinator({
    providers: [new FileSearchProvider({ ledger })],
  });
  const registry = new ToolRegistry();
  registerFileTools(registry, { ledger, searchCoordinator: coordinator, mediaRoot, maximumTextBytes: 4096 });

  const found = await registry.execute("file_search", {
    query: "brokerage account hierarchy", match_mode: "terms",
    max_distance: 12, context_tokens: 24, limit: 20,
  });
  assert.equal(found.hits[0].actionRef.file_id, file.fileId);
  const metadata = await registry.execute("file_get", { file_id: file.fileId });
  assert.equal(metadata.file.origins[0].requestId, request.requestId);
  assert.equal(metadata.file.originalFilename, "account-tree.csv");

  const firstPage = await registry.execute("file_read", {
    file_id: file.fileId, offset: 0, max_characters: 20,
  });
  assert.equal(firstPage.verified, true);
  assert.equal(firstPage.has_more, true);
  const secondPage = await registry.execute("file_read", {
    file_id: file.fileId, offset: firstPage.next_offset, max_characters: 1000,
  });
  assert.equal(firstPage.content + secondPage.content, text);
  fs.appendFileSync(path.join(mediaRoot, "account-tree.csv"), "tampered");
  await assert.rejects(
    registry.execute("file_read", { file_id: file.fileId, offset: 0, max_characters: 100 }),
    /size does not match/,
  );

  const titled = await registry.execute("file_update", {
    file_id: file.fileId,
    title: "Brokerage account hierarchy",
    description: "Two account paths with their required currencies.",
  }, { requestId: request.requestId, callId: "title-file" });
  assert.equal(titled.file.titleSource, "ai");
  const phrase = await registry.execute("file_search", {
    query: "Brokerage account hierarchy", match_mode: "phrase",
    max_distance: 12, context_tokens: 24, limit: 20,
  });
  assert.equal(phrase.hits[0].actionRef.file_id, file.fileId);
  ledger.updateFile(file.fileId, {
    title: "My confirmed account tree", description: "User-edited description.", titleSource: "user",
  });
  await assert.rejects(
    registry.execute("file_update", {
      file_id: file.fileId, title: "AI overwrite", description: null,
    }, { requestId: request.requestId, callId: "overwrite-file" }),
    /user-edited title/,
  );
});

test("table tools inspect a TSV and transform the complete file into durable JSON Lines with exceptions", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-slayer-table-tools-"));
  context.after(() => fs.rmSync(mediaRoot, { recursive: true, force: true }));
  const text = [
    "Txn\tAccount\tAmount",
    "tx-1\tAssets:Cash\t$10.00",
    "tx-1\tIncome:Work\t$(10.00)",
    "tx-2\tExpenses:Food\tnot-money",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(mediaRoot, "transactions.tsv"), text);
  const file = ledger.registerFile({
    storagePath: "media/transactions.tsv",
    originalFilename: "transactions.tsv",
    title: "transactions.tsv",
    description: "TSV with three line items.",
    mediaKind: "document",
    mimeType: "text/tab-separated-values",
    sha256: createHash("sha256").update(text).digest("hex"),
    byteSize: Buffer.byteLength(text),
  });
  const registry = new ToolRegistry();
  registerFileTools(registry, {
    ledger, searchCoordinator: {}, mediaRoot, maximumTextBytes: 4096, maximumGeneratedBytes: 4096,
  });

  const inspection = await registry.execute("file_table_inspect", {
    file_id: file.fileId, delimiter: "auto", header_row: true, sample_size: 2,
  });
  assert.equal(inspection.delimiterName, "tab");
  assert.equal(inspection.sourceRecordCount, 3);
  assert.deepEqual(inspection.headers, ["Txn", "Account", "Amount"]);

  const result = await registry.execute("file_table_transform", {
    file_id: file.fileId,
    delimiter: "tab",
    header_row: true,
    mapping: {
      fields: [
        { output_field: "transaction_external_id", source_column: "Txn" },
        { output_field: "account_full_name", source_column: "Account" },
        {
          output_field: "amount_decimal",
          source_column: "Amount",
          transforms: [{
            op: "decimal", decimal_separator: ".", grouping_separator: ",",
            currency_symbols: ["$"], parentheses_negative: true,
          }],
        },
      ],
    },
    target_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        transaction_external_id: { type: "string" },
        account_full_name: { type: "string" },
        amount_decimal: { type: "string", pattern: "^-?\\d+(?:\\.\\d+)?$" },
      },
      required: ["transaction_external_id", "account_full_name", "amount_decimal"],
    },
  }, { requestId: "table-transform-request", callId: "table-transform-call", channel: "test" });
  assert.equal(result.sourceRecordCount, 3);
  assert.equal(result.transformedRecordCount, 2);
  assert.equal(result.exceptionRecordCount, 1);
  assert.equal(result.accountedRecordCount, 3);
  assert.equal(result.complete, true);
  assert.ok(result.outputFile.fileId > file.fileId);
  assert.ok(result.exceptionFile.fileId > result.outputFile.fileId);
  const outputRow = ledger.file(result.outputFile.fileId);
  const output = fs.readFileSync(path.join(mediaRoot, outputRow.storage_path.replace(/^media\//, "")), "utf8");
  assert.deepEqual(output.trim().split("\n").map(JSON.parse), [
    { transaction_external_id: "tx-1", account_full_name: "Assets:Cash", amount_decimal: "10.00" },
    { transaction_external_id: "tx-1", account_full_name: "Income:Work", amount_decimal: "-10.00" },
  ]);
  const exceptionRow = ledger.file(result.exceptionFile.fileId);
  const exception = JSON.parse(fs.readFileSync(
    path.join(mediaRoot, exceptionRow.storage_path.replace(/^media\//, "")), "utf8",
  ));
  assert.equal(exception.source_record_number, 3);
  assert.equal(exception.code, "TRANSFORM_FAILED");
  assert.equal(ledger.trace("table-transform-request").some(({ type }) => type === "file.table.transformed"), true);
});
