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

test("a continued native thread receives the exact prior assistant response as a bounded continuation anchor", async () => {
  const previousResponse = [
    "#41 — Resubmit taxes — scheduled Aug 19",
    "#42 — Briefing templates — scheduled Aug 20",
    "Were either of these completed?",
  ].join("\n");
  const builder = new ContextBuilder({
    ledger: {
      recentConversation() {
        return [
          { role: "user", content: "Move on to the next thing." },
          { role: "assistant", content: previousResponse },
        ];
      },
    },
    profileFacts: { list() { return { facts: [] }; } },
  });

  const result = await builder.build("continued", "The first was not completed; move it to tomorrow.", {
    nativeConversation: true,
    continuingConversation: true,
    conversationStartEventSeq: 10,
  });

  assert.match(result.developerInstructions, /# Immediate continuation anchor/);
  assert.match(result.developerInstructions, /#41 — Resubmit taxes/);
  assert.match(result.developerInstructions, /Were either of these completed\?/);
  assert.match(result.developerInstructions, /Do not ask again about a record/);
  assert.doesNotMatch(result.developerInstructions, /USER: Move on to the next thing/);
});

test("a native continuation anchor retains the end of an oversized prior response", async () => {
  const builder = new ContextBuilder({
    ledger: {
      recentConversation() {
        return [{
          role: "assistant",
          content: `${"x".repeat(7_000)}\n#99 — The actual current question?`,
        }];
      },
    },
    profileFacts: { list() { return { facts: [] }; } },
  });

  const result = await builder.build("continued", "No, move that to Wednesday.", {
    nativeConversation: true,
    continuingConversation: true,
  });

  assert.match(result.developerInstructions, /beginning of prior assistant response omitted/);
  assert.match(result.developerInstructions, /#99 — The actual current question\?/);
  assert.ok(result.developerInstructions.length < 7_000);
});

test("an explicitly referenced exchange remains literal context outside rolling history", async () => {
  const referenced = {
    requestId: "7a9457ad-bc20-4cf3-8fca-9e58ff24a145",
    requestEventId: "event-source-request",
    requestEventSeq: 41,
    requestSourceEventSeq: 41,
    responseEventSeq: 87,
    submittedAtUtc: "2026-08-30T14:00:00.000Z",
    request: "Move all of the Watch Jobs that you previously put on today.",
    response: "Tool-call limit reached after 24 individual updates.",
    status: "error",
    error: "Tool-call limit reached after 24 individual updates.",
  };
  const builder = new ContextBuilder({
    ledger: {
      recentConversation() { return []; },
      referencedExchangesForRequest(requestId, options) {
        assert.equal(requestId, "current-request");
        assert.deepEqual(options, { limit: 8 });
        return [referenced];
      },
    },
    profileFacts: { list() { return { facts: [] }; } },
  });

  const result = await builder.build("current-request", "Finish that work.", {
    nativeConversation: true,
    conversationCheckpoint: { text: "# Conversation checkpoint\nUnrelated older context." },
  });

  assert.match(result.developerInstructions, /# Explicitly referenced exchanges/);
  assert.match(result.developerInstructions, /7a9457ad-bc20-4cf3-8fca-9e58ff24a145/);
  assert.match(result.developerInstructions, /Move all of the Watch Jobs/);
  assert.match(result.developerInstructions, /24 individual updates/);
  assert.match(result.developerInstructions, /requestEventSeq\":41/);
  assert.deepEqual(result.referencedExchanges, [{
    ...Object.fromEntries(Object.entries(referenced).filter(([key]) => !["request", "response"].includes(key))),
    requestCharacters: referenced.request.length,
    responseCharacters: referenced.response.length,
  }]);
});
