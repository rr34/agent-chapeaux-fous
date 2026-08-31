const machineReferenceKeys = new Set([
  "file_id", "title", "original_filename", "media_kind",
  "video_script_id", "video_job_id", "output_file_id", "content_id",
  "briefing_name", "interaction_guide_id", "interaction_guide_step_id",
  "exchange_number", "opening_text",
]);

const machineIdentityKeys = new Set([
  "file_id", "video_script_id", "video_job_id", "output_file_id",
  "interaction_guide_id", "interaction_guide_step_id",
]);

const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const longDigitPattern = /\b\d{16,}\b/gu;
const longTokenPattern = /[A-Za-z0-9_-]{24,}/gu;

function machineIdentityObject(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const keys = Object.keys(value);
  return keys.length > 0
    && keys.every((key) => machineReferenceKeys.has(key))
    && keys.some((key) => machineIdentityKeys.has(key));
}

function withoutMachineReferenceBlocks(value) {
  const lines = String(value ?? "").replaceAll("\r\n", "\n").split("\n");
  const kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    const withoutReferenceCode = lines[index].replace(/\s*Reference code:\s*.*$/iu, "").trimEnd();
    if (withoutReferenceCode !== lines[index]) {
      if (withoutReferenceCode) kept.push(withoutReferenceCode);
      continue;
    }
    if (lines[index].trim() !== "{") {
      kept.push(lines[index]);
      continue;
    }
    const closingOffset = lines.slice(index + 1, index + 32)
      .findIndex((line) => line.trim() === "}");
    if (closingOffset === -1) {
      kept.push(lines[index]);
      continue;
    }
    const closingIndex = index + closingOffset + 1;
    let parsed = null;
    try { parsed = JSON.parse(lines.slice(index, closingIndex + 1).join("\n")); } catch { /* Keep ordinary JSON. */ }
    if (!machineIdentityObject(parsed)) {
      kept.push(lines[index]);
      continue;
    }
    index = closingIndex;
  }
  return kept.join("\n");
}

function withoutOpaqueTokens(value) {
  return value
    .replace(uuidPattern, "")
    .replace(longDigitPattern, "")
    .replace(longTokenPattern, (token, offset, source) => {
      const previous = source[offset - 1] ?? "";
      const next = source[offset + token.length] ?? "";
      const looksLikeUrlOrAddress = ":/@".includes(previous) || ":/@".includes(next);
      const mixesLettersAndNumbers = /[A-Za-z]/u.test(token) && /\d/u.test(token);
      return !looksLikeUrlOrAddress && mixesLettersAndNumbers ? "" : token;
    });
}

export function videoDialogueText(value, fallback = "Technical reference omitted from this video.") {
  const projected = withoutOpaqueTokens(withoutMachineReferenceBlocks(value))
    .replace(/[ \t]+([,.;:!?])/gu, "$1")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return projected || fallback;
}
