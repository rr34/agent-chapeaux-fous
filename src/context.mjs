import fs from "node:fs/promises";

function bounded(value, maximum) {
  const text = String(value ?? "");
  return text.length <= maximum ? text : `${text.slice(0, maximum)}\n[context truncated]`;
}

export class ContextBuilder {
  constructor({ ledger, profilePath, historyLimit = 4, maximumCharacters = 8000 }) {
    this.ledger = ledger;
    this.profilePath = profilePath;
    this.historyLimit = historyLimit;
    this.maximumCharacters = maximumCharacters;
  }

  async build(requestId) {
    let profile = "";
    try { profile = await fs.readFile(this.profilePath, "utf8"); } catch { profile = ""; }
    const history = this.ledger.recentConversation({ beforeRequestId: requestId, limit: this.historyLimit });
    const historyText = history.length
      ? history.map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join("\n\n")
      : "No prior Agent Slayer exchanges are available.";
    const text = bounded([
      "# Stable profile",
      profile.trim() || "No stable profile is configured.",
      "",
      "# Recent complete exchanges",
      historyText,
    ].join("\n"), this.maximumCharacters);
    return { text, profile: profile.trim(), history };
  }
}
