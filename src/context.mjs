import { profileFactsContext } from "./profile-facts.mjs";

function bounded(value, maximum) {
  const text = String(value ?? "");
  if (text.length <= maximum) {
    return { text, originalCharacters: text.length, sentCharacters: text.length, truncated: false };
  }
  const suffix = "\n[context truncated]";
  const result = `${text.slice(0, Math.max(0, maximum - suffix.length))}${suffix}`;
  return { text: result, originalCharacters: text.length, sentCharacters: result.length, truncated: true };
}

export class ContextBuilder {
  constructor({ ledger, profileFacts, historyLimit = 4, maximumCharacters = 8000 }) {
    this.ledger = ledger;
    this.profileFacts = profileFacts;
    this.historyLimit = historyLimit;
    this.maximumCharacters = maximumCharacters;
  }

  async build(requestId) {
    const activeProfileFacts = this.profileFacts.list({ status: "active", limit: null }).facts;
    const history = this.ledger.recentConversation({ beforeRequestId: requestId, limit: this.historyLimit });
    const historyText = history.length
      ? history.map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join("\n\n")
      : "No prior Agent Slayer exchanges are available.";
    const result = bounded([
      "# Active profile facts",
      profileFactsContext(activeProfileFacts),
      "",
      "# Recent complete exchanges",
      historyText,
    ].join("\n"), this.maximumCharacters);
    return { text: result.text, profileFacts: activeProfileFacts, history, contextBudget: result };
  }
}
