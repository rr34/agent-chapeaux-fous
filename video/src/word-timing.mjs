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

const pronunciationAliases = new Map([
  ["chapeaux", "chapo"],
  ["chapeau", "chapo"],
  ["shapo", "chapo"],
  ["shapoh", "chapo"],
  ["fous", "foo"],
  ["fou", "foo"],
]);

const spokenLetterAliases = new Map([
  ["ay", "a"], ["bee", "b"], ["cee", "c"], ["see", "c"], ["dee", "d"],
  ["ee", "e"], ["ef", "f"], ["eff", "f"], ["gee", "g"], ["aitch", "h"],
  ["eye", "i"], ["jay", "j"], ["kay", "k"], ["el", "l"], ["ell", "l"],
  ["em", "m"], ["en", "n"], ["oh", "o"], ["pee", "p"], ["cue", "q"],
  ["are", "r"], ["ess", "s"], ["tee", "t"], ["you", "u"], ["vee", "v"],
  ["doubleyou", "w"], ["ex", "x"], ["why", "y"], ["zee", "z"], ["zed", "z"],
]);

function displayWord(value) {
  const normalized = normalizedSpokenText(value);
  return pronunciationAliases.get(normalized) || normalized;
}

function timedWordAlternatives(value) {
  const normalized = normalizedSpokenText(value);
  return [...new Set([
    normalized,
    pronunciationAliases.get(normalized),
    spokenLetterAliases.get(normalized),
  ].filter(Boolean))];
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
    const normalized = displayWord(piece);
    for (let offset = 0; offset < normalized.length; offset += 1) {
      characters.push(normalized[offset]);
      characterPieces.push(pieceIndex);
      characterOffsets.push(offset);
    }
  });
  const stream = characters.join("");
  let cursor = 0;
  const pieceIndexes = (Array.isArray(timedWords) ? timedWords : []).map(({ word }) => {
    const alternatives = timedWordAlternatives(word);
    const maximumStart = Math.min(stream.length, cursor + 800);
    let best = null;
    for (const normalized of alternatives) {
      let match = stream.indexOf(normalized, cursor);
      while (match >= 0 && match <= maximumStart) {
        // Prefer token starts. A match at the cursor may continue a visible
        // contraction or acronym that the transcriber split into timed words.
        if (characterOffsets[match] === 0 || match === cursor) {
          if (!best || match < best.match) best = { match, length: normalized.length };
          break;
        }
        match = stream.indexOf(normalized, match + 1);
      }
    }
    if (best) {
      cursor = best.match + best.length;
      return characterPieces[best.match];
    }
    return null;
  });
  return { pieces, pieceIndexes };
}
