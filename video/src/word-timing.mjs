export function displayTextPieces(text) {
  return String(text ?? "").match(/\s+|[^\s]+/gu) || [String(text ?? "")];
}

export function normalizedSpokenText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

// Speech transcription and visible copy do not always tokenize a word the
// same way (for example, "can't" may be one visible token and two timed
// tokens). Align by normalized characters instead of assuming equal indexes.
export function alignTimedWordsToDisplay(text, timedWords) {
  const pieces = displayTextPieces(text);
  const characters = [];
  const characterPieces = [];
  const characterOffsets = [];
  pieces.forEach((piece, pieceIndex) => {
    const normalized = normalizedSpokenText(piece);
    for (let offset = 0; offset < normalized.length; offset += 1) {
      characters.push(normalized[offset]);
      characterPieces.push(pieceIndex);
      characterOffsets.push(offset);
    }
  });
  const stream = characters.join("");
  let cursor = 0;
  const pieceIndexes = (Array.isArray(timedWords) ? timedWords : []).map(({ word }) => {
    const normalized = normalizedSpokenText(word);
    if (!normalized) return null;
    const maximumStart = Math.min(stream.length, cursor + Math.max(160, normalized.length * 12));
    let match = stream.indexOf(normalized, cursor);
    while (match >= 0 && match <= maximumStart) {
      // Prefer token starts. A match at the cursor may continue a visible
      // contraction that the transcriber split into multiple timed words.
      if (characterOffsets[match] === 0 || match === cursor) {
        cursor = match + normalized.length;
        return characterPieces[match];
      }
      match = stream.indexOf(normalized, match + 1);
    }
    return null;
  });
  return { pieces, pieceIndexes };
}
