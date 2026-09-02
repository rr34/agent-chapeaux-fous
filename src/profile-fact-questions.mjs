import fs from "node:fs/promises";

const factTypePattern = /^[a-z][a-z0-9_]{0,199}$/;

function normalizedPhrase(value) {
  return String(value ?? "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim()
    .replaceAll(/\s+/g, " ");
}

export function validateProfileFactQuestions(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.questions) || !value.questions.length) {
    throw new Error("Profile fact question catalog must have version 1 and a nonempty questions array");
  }
  const factTypes = new Set();
  const questions = value.questions.map((entry, index) => {
    const factType = String(entry?.factType ?? "").trim();
    const question = String(entry?.question ?? "").trim();
    const askWhen = String(entry?.askWhen ?? "").trim();
    const triggers = Array.isArray(entry?.triggers)
      ? [...new Set(entry.triggers.map(normalizedPhrase).filter(Boolean))]
      : [];
    if (!factTypePattern.test(factType)) throw new Error(`Profile fact question ${index + 1} has an invalid factType`);
    if (factTypes.has(factType)) throw new Error(`Profile fact question catalog repeats factType ${factType}`);
    if (!question.endsWith("?")) throw new Error(`Profile fact question ${factType} must end with a question mark`);
    if (!askWhen) throw new Error(`Profile fact question ${factType} must define askWhen`);
    if (!triggers.length) throw new Error(`Profile fact question ${factType} must define triggers`);
    factTypes.add(factType);
    return { factType, question, askWhen, triggers };
  });
  const onboarding = value.onboardingBrief;
  const onboardingName = String(onboarding?.name ?? "").trim();
  const onboardingTitle = String(onboarding?.title ?? "").trim();
  const onboardingPurpose = String(onboarding?.purpose ?? "").trim();
  const onboardingFactTypes = Array.isArray(onboarding?.factTypes)
    ? [...new Set(onboarding.factTypes.map((factType) => String(factType ?? "").trim()))]
    : [];
  const onboardingTriggers = Array.isArray(onboarding?.triggers)
    ? [...new Set(onboarding.triggers.map(normalizedPhrase).filter(Boolean))]
    : [];
  if (!factTypePattern.test(onboardingName)) {
    throw new Error("Profile fact question catalog onboardingBrief must define a valid name");
  }
  if (!onboardingTitle || !onboardingPurpose) {
    throw new Error("Profile fact question catalog onboardingBrief must define a title and purpose");
  }
  if (!onboardingFactTypes.length || onboardingFactTypes.some((factType) => !factTypes.has(factType))) {
    throw new Error("Profile fact question catalog onboardingBrief must reference defined fact types");
  }
  if (!onboardingTriggers.length) {
    throw new Error("Profile fact question catalog onboardingBrief must define triggers");
  }
  return {
    version: 1,
    onboardingBrief: {
      name: onboardingName,
      title: onboardingTitle,
      purpose: onboardingPurpose,
      factTypes: onboardingFactTypes,
      triggers: onboardingTriggers,
    },
    questions,
  };
}

export async function loadProfileFactQuestions(filename) {
  let value;
  try {
    value = JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    throw new Error(`Cannot load profile fact question catalog ${filename}: ${error.message}`);
  }
  return validateProfileFactQuestions(value);
}

export function selectRelevantProfileFactQuestions(catalog, {
  activeFacts,
  requestText,
  previousAssistantText = "",
  maximum = 3,
  onboardingMaximum = catalog.onboardingBrief.factTypes.length,
}) {
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new Error("Relevant profile question maximum must be a positive integer");
  }
  if (!Number.isSafeInteger(onboardingMaximum) || onboardingMaximum < 1) {
    throw new Error("Profile onboarding question maximum must be a positive integer");
  }
  const request = ` ${normalizedPhrase(requestText)} `;
  const activeFactTypes = new Set(activeFacts.map(({ factType }) => factType));
  const onboardingRequested = catalog.onboardingBrief.triggers.some((trigger) => (
    request.includes(` ${trigger} `)
  ));
  if (onboardingRequested) {
    return catalog.onboardingBrief.factTypes.flatMap((factType) => {
      const entry = catalog.questions.find((question) => question.factType === factType);
      return entry ? [{
        ...entry,
        catalogIndex: catalog.questions.indexOf(entry),
        matchScore: 0,
        matchingTriggers: [],
        standardOnboarding: true,
        onboardingStatus: activeFactTypes.has(factType) ? "complete" : "missing",
        onboardingBriefName: catalog.onboardingBrief.name,
      }] : [];
    }).slice(0, onboardingMaximum);
  }
  const matched = catalog.questions.flatMap((entry, index) => {
    const matchingTriggers = entry.triggers.filter((trigger) => request.includes(` ${trigger} `));
    if (!matchingTriggers.length) return [];
    return [{
      ...entry,
      catalogIndex: index,
      matchScore: Math.max(...matchingTriggers.map((trigger) => trigger.length)),
      matchingTriggers,
    }];
  }).sort((left, right) => (
    right.matchScore - left.matchScore || left.catalogIndex - right.catalogIndex
  ));
  if (matched.length) return matched.slice(0, maximum);
  const previousAssistant = normalizedPhrase(previousAssistantText);
  if (previousAssistant) {
    const continued = catalog.questions.flatMap((entry, index) => (
      previousAssistant.includes(normalizedPhrase(entry.question))
        ? [{
            ...entry,
            catalogIndex: index,
            matchScore: 0,
            matchingTriggers: [],
            continuedFromPreviousQuestion: true,
          }]
        : []
    ));
    if (continued.length) return continued.slice(0, maximum);
  }
  if (activeFacts.length === 0) {
    const firstOnboardingType = catalog.onboardingBrief.factTypes[0];
    const firstOnboardingQuestion = catalog.questions.find(({ factType }) => (
      factType === firstOnboardingType
    ));
    return firstOnboardingQuestion ? [{
      ...firstOnboardingQuestion,
      catalogIndex: catalog.questions.indexOf(firstOnboardingQuestion),
      matchScore: 0,
      matchingTriggers: [],
      emptyProfileDefault: true,
    }] : [];
  }
  return [];
}

export function profileFactQuestionInstructions(questions) {
  if (!questions.length) return "";
  const standardOnboarding = questions.some(({ standardOnboarding }) => standardOnboarding);
  const needsDefaultLocation = questions.some(({ factType }) => factType === "default_location");
  return [
    standardOnboarding ? "# Standard onboarding brief" : "# Relevant profile types",
    standardOnboarding
      ? "The user explicitly requested the repository-defined core profile setup. Each field is labeled complete or missing. Ask only the missing questions as one bounded brief, allow any item to be skipped, and save only information the user actually supplies. Active rows are already complete and must not be asked again."
      : "These repository-defined fact types are relevant to the current request. Their active rows, if any, appear above with stable fact IDs. If the user supplies durable information, save it as self-contained natural language. Replace an existing row by ID only when that same real-world fact changed; add a row when it concerns a different person or item, even when the type is the same. If no active row answers the request and the user did not supply the answer, ask only what is needed naturally.",
    ...(needsDefaultLocation ? [
      "A time-zone fact is not a geographic location and cannot satisfy `default_location`. For weather, nearby-place, or other geographic work, use an active `default_location` row or ask the standard location question before claiming the request is location-resolved.",
    ] : []),
    "",
    ...questions.map(({ factType, question, askWhen, standardOnboarding: onboarding, onboardingStatus }) => (
      `- ${onboarding ? `[${onboardingStatus}] ` : ""}${factType}: ${question} Ask when: ${askWhen}`
    )),
  ].join("\n");
}
