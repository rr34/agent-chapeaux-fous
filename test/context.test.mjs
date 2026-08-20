import assert from "node:assert/strict";
import test from "node:test";
import { ContextBuilder } from "../src/context.mjs";

test("a replacement model thread receives its bounded conversation checkpoint without duplicate recent history", async () => {
  const builder = new ContextBuilder({
    ledger: {
      recentConversation() {
        return [{ role: "user", content: "RECENT TEXT SHOULD NOT BE DUPLICATED" }];
      },
    },
    profileFacts: { list() { return { facts: [] }; } },
  });
  const checkpoint = {
    text: "# Conversation checkpoint\nORIGINAL OBJECTIVE\nreceipt_event_seq=77",
    afterEventSeq: 10,
    beforeEventSeq: 90,
    exchangeEntryCount: 30,
    includedExchangeEntryCount: 20,
    omittedExchangeEntryCount: 10,
    receiptCount: 4,
    includedReceiptCount: 4,
    olderReceiptsOmitted: false,
    sentCharacters: 70,
  };
  const result = await builder.build("replacement", "Continue.", {
    nativeConversation: false,
    conversationStartEventSeq: 10,
    conversationCheckpoint: checkpoint,
  });

  assert.match(result.developerInstructions, /ORIGINAL OBJECTIVE/);
  assert.match(result.developerInstructions, /receipt_event_seq=77/);
  assert.doesNotMatch(result.developerInstructions, /RECENT TEXT SHOULD NOT BE DUPLICATED/);
  assert.equal(result.conversationCheckpoint.omittedExchangeEntryCount, 10);
});
