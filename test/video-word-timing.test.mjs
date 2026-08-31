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
