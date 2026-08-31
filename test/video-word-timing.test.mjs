import assert from "node:assert/strict";
import test from "node:test";
import { alignTimedWordsToDisplay } from "../video/src/word-timing.mjs";

test("video word timing aligns transcription tokens to visible conversation tokens", () => {
  const text = "I can't overlook **Chapeaux Fous** or SQLite.";
  const words = ["I", "can", "t", "overlook", "Chapeaux", "Fou", "or", "SQLite"]
    .map((word, index) => ({ word, startMs: index * 100, endMs: (index + 1) * 100 }));
  const aligned = alignTimedWordsToDisplay(text, words);

  assert.deepEqual(
    aligned.pieceIndexes.map((pieceIndex) => aligned.pieces[pieceIndex]),
    ["I", "can't", "can't", "overlook", "**Chapeaux", "Fous**", "or", "SQLite."],
  );
});

test("video word timing recognizes phonetic names and spoken acronyms", () => {
  const text = "Chapeaux Fous can configure a VPS and keep highlighting afterward.";
  const words = ["Shapo", "Foo", "can", "configure", "a", "vee", "pee", "ess", "and", "keep", "highlighting", "afterward"]
    .map((word, index) => ({ word, startMs: index * 100, endMs: (index + 1) * 100 }));
  const aligned = alignTimedWordsToDisplay(text, words);

  assert.deepEqual(
    aligned.pieceIndexes.map((pieceIndex) => aligned.pieces[pieceIndex]),
    ["Chapeaux", "Fous", "can", "configure", "a", "VPS", "VPS", "VPS", "and", "keep", "highlighting", "afterward."],
  );
});

test("video word timing resumes after long visible text omitted from speech", () => {
  const omitted = "x".repeat(500);
  const text = `Before ${omitted} highlighting resumes after the omission.`;
  const words = ["Before", "highlighting", "resumes", "after", "the", "omission"]
    .map((word, index) => ({ word, startMs: index * 100, endMs: (index + 1) * 100 }));
  const aligned = alignTimedWordsToDisplay(text, words);

  assert.deepEqual(
    aligned.pieceIndexes.map((pieceIndex) => aligned.pieces[pieceIndex]),
    ["Before", "highlighting", "resumes", "after", "the", "omission."],
  );
});
