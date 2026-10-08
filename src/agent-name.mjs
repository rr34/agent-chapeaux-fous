export const AGENT_NAME = "Time v3 Agent";

// These variants are input-only aliases. This boundary prevents a model from
// echoing one in the user-facing response while preserving the exact original
// request and raw provider evidence in the trace.
const inputOnlyAliasPattern = /\b(?:chapeaux[\s_-]+fous|sha[\s_-]*po[\s_-]*fu|cha[\s_-]*po[\s_-]*fu|chapeau[\s_-]+faux)\b/giu;

export function canonicalizeAgentName(text) {
  return String(text ?? "").replace(inputOnlyAliasPattern, AGENT_NAME);
}
