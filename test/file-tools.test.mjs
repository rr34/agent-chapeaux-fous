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
