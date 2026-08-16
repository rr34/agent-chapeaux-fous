import { profileFactsContext } from "./profile-facts.mjs";
import {
  profileFactQuestionInstructions,
  selectRelevantProfileFactQuestions,
} from "./profile-fact-questions.mjs";

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
  constructor({
    ledger,
    profileFacts,
    profileFactQuestions = null,
    historyLimit = 4,
    maximumCharacters = 8000,
  }) {
    this.ledger = ledger;
    this.profileFacts = profileFacts;
    this.profileFactQuestions = profileFactQuestions;
    this.historyLimit = historyLimit;
    this.maximumCharacters = maximumCharacters;
  }

  async build(requestId, requestText = "") {
    const activeProfileFacts = this.profileFacts.list({ status: "active", limit: null }).facts;
    const history = this.ledger.recentConversation({ beforeRequestId: requestId, limit: this.historyLimit });
    const previousAssistantText = [...history].reverse()
      .find(({ role }) => role === "assistant")?.content ?? "";
    const relevantProfileQuestions = this.profileFactQuestions
      ? selectRelevantProfileFactQuestions(this.profileFactQuestions, {
          activeFacts: activeProfileFacts,
          requestText,
          previousAssistantText,
        })
      : [];
    const relevantProfileTypes = [...new Set(relevantProfileQuestions.map(({ factType }) => factType))];
    const relevantProfileFacts = relevantProfileTypes.length
      ? activeProfileFacts.filter(({ factType }) => relevantProfileTypes.includes(factType))
      : [];
    const questionInstructions = profileFactQuestionInstructions(relevantProfileQuestions);
    const historyText = history.length
      ? history.map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join("\n\n")
      : "No prior Agent Slayer exchanges are available.";
    const sections = [];
    if (relevantProfileTypes.length) {
      sections.push(
        "# Relevant active profile facts",
        profileFactsContext(relevantProfileFacts),
        "",
        questionInstructions,
      );
    }
    if (sections.length) sections.push("");
    sections.push("# Recent complete exchanges", historyText);
    const result = bounded(sections.join("\n"), this.maximumCharacters);
    return {
      text: result.text,
      profileFacts: relevantProfileFacts,
      activeProfileFactCount: activeProfileFacts.length,
      relevantProfileTypes,
      relevantProfileQuestions,
      history,
      contextBudget: result,
    };
  }
}
