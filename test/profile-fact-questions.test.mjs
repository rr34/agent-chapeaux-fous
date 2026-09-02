import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  loadProfileFactQuestions,
  profileFactQuestionInstructions,
  selectRelevantProfileFactQuestions,
  validateProfileFactQuestions,
} from "../src/profile-fact-questions.mjs";
import { SlayerRuntime } from "../src/runtime.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the standard profile question catalog is comprehensive and valid", async () => {
  const catalog = await loadProfileFactQuestions(
    path.join(repositoryRoot, "config", "profile-fact-questions.json"),
  );
  assert.ok(catalog.questions.length >= 30);
  const factTypes = catalog.questions.map(({ factType }) => factType);
  for (const factType of [
    "preferred_name", "default_location", "address", "vehicle", "emergency_contact",
    "work_hours", "dietary_information", "accessibility_need", "travel_preference",
  ]) assert.ok(factTypes.includes(factType), factType);
  assert.equal(catalog.onboardingBrief.name, "core_profile");
  assert.deepEqual(catalog.onboardingBrief.factTypes, [
    "preferred_name", "default_location", "time_zone", "time_format",
    "measurement_system", "temperature_unit",
  ]);
});

test("only relevant profile types and questions become model context", async () => {
  const catalog = await loadProfileFactQuestions(
    path.join(repositoryRoot, "config", "profile-fact-questions.json"),
  );
  const weather = selectRelevantProfileFactQuestions(catalog, {
    activeFacts: [],
    requestText: "What's the high today?",
  });
  assert.deepEqual(weather.map(({ factType }) => factType), ["default_location"]);
  const instructions = profileFactQuestionInstructions(weather);
  assert.match(instructions, /# Relevant profile types/);
  assert.match(instructions, /default_location:/);
  assert.doesNotMatch(instructions, /address:/);

  const knownLocation = selectRelevantProfileFactQuestions(catalog, {
    activeFacts: [{ factType: "default_location", text: "My default location is Delaware, Ohio." }],
    requestText: "What's the high today?",
  });
  assert.deepEqual(knownLocation.map(({ factType }) => factType), ["default_location"]);
  assert.match(profileFactQuestionInstructions(knownLocation), /default_location:/);

  const rain = selectRelevantProfileFactQuestions(catalog, {
    activeFacts: [{ factType: "time_zone", text: "My time zone is America/New_York." }],
    requestText: "Is it supposed to rain over the next day?",
  });
  assert.deepEqual(rain.map(({ factType }) => factType), ["default_location"]);
  assert.match(profileFactQuestionInstructions(rain), /time-zone fact is not a geographic location/);

  const temporalHistory = selectRelevantProfileFactQuestions(catalog, {
    activeFacts: [{ factType: "time_zone", text: "My time zone is America/New_York." }],
    requestText: "What did we talk about earlier today?",
  });
  assert.deepEqual(temporalHistory.map(({ factType }) => factType), ["time_zone"]);

  const everythingKnownAndIrrelevant = selectRelevantProfileFactQuestions(catalog, {
    activeFacts: catalog.questions.map(({ factType }) => ({ factType, text: "known" })),
    requestText: "Tell me a joke.",
  });
  assert.deepEqual(everythingKnownAndIrrelevant, []);

  const knownCollectionStillMaintainsExactItems = selectRelevantProfileFactQuestions(catalog, {
    activeFacts: [{ factType: "vehicle", text: "My car is a 2017 Volkswagen Golf." }],
    requestText: "My wife's car changed.",
  });
  assert.deepEqual(knownCollectionStillMaintainsExactItems.map(({ factType }) => factType), ["vehicle"]);

  const dietaryPreference = selectRelevantProfileFactQuestions(catalog, {
    activeFacts: [],
    requestText: "I prefer vegetarian meals.",
  });
  const foodAllergy = selectRelevantProfileFactQuestions(catalog, {
    activeFacts: [],
    requestText: "I am allergic to peanuts.",
  });
  assert.deepEqual(dietaryPreference.map(({ factType }) => factType), ["dietary_information"]);
  assert.deepEqual(foodAllergy.map(({ factType }) => factType), ["dietary_information"]);

  const emptyProfileGreeting = selectRelevantProfileFactQuestions(catalog, {
    activeFacts: [],
    requestText: "Hello",
  });
  assert.deepEqual(emptyProfileGreeting.map(({ factType }) => factType), ["preferred_name"]);

  const shortAnswer = selectRelevantProfileFactQuestions(catalog, {
    activeFacts: [],
    requestText: "Delaware, Ohio.",
    previousAssistantText: "What city and state or country should I use as your default location?",
  });
  assert.deepEqual(shortAnswer.map(({ factType }) => factType), ["default_location"]);
  assert.equal(shortAnswer[0].continuedFromPreviousQuestion, true);

  const several = selectRelevantProfileFactQuestions(catalog, {
    activeFacts: [{ factType: "preferred_name", text: "My preferred name is Nathan." }],
    requestText: "I need my address, phone number, legal name, vehicle, and emergency contact.",
  });
  assert.equal(several.length, 3);
});

test("a selected question has exact type, wording, and ask-when guidance", async () => {
  const catalog = await loadProfileFactQuestions(
    path.join(repositoryRoot, "config", "profile-fact-questions.json"),
  );
  const selected = selectRelevantProfileFactQuestions(catalog, {
    activeFacts: [],
    requestText: "What is my address?",
  });
  const instructions = profileFactQuestionInstructions(selected);
  assert.match(instructions, /address:/);
  assert.match(instructions, /What address should I keep on file for you\?/);
  assert.match(instructions, /Ask when:/);
});

test("the explicit standard onboarding brief marks complete and missing core facts", async () => {
  const catalog = await loadProfileFactQuestions(
    path.join(repositoryRoot, "config", "profile-fact-questions.json"),
  );
  const selected = selectRelevantProfileFactQuestions(catalog, {
    activeFacts: [
      { factType: "preferred_name", text: "Call me Nate." },
      { factType: "time_zone", text: "Use America/New_York." },
    ],
    requestText: "Set up my profile",
  });
  assert.deepEqual(selected.map(({ factType }) => factType), [
    "preferred_name", "default_location", "time_zone", "time_format",
    "measurement_system", "temperature_unit",
  ]);
  assert.deepEqual(selected.map(({ onboardingStatus }) => onboardingStatus), [
    "complete", "missing", "complete", "missing", "missing", "missing",
  ]);
  assert.equal(selected.every(({ standardOnboarding }) => standardOnboarding), true);
  const instructions = profileFactQuestionInstructions(selected);
  assert.match(instructions, /# Standard onboarding brief/);
  assert.match(instructions, /\[complete\] preferred_name:/);
  assert.match(instructions, /\[missing\] default_location:/);
  assert.match(instructions, /allow any item to be skipped/);
});

test("the profile question catalog rejects duplicate fact types", () => {
  assert.throws(() => validateProfileFactQuestions({
    version: 1,
    onboardingBrief: {
      name: "core_profile",
      title: "Core profile setup",
      purpose: "Collect core defaults.",
      factTypes: ["address"],
      triggers: ["onboarding"],
    },
    questions: [
      { factType: "address", question: "What is your address?", askWhen: "Address work.", triggers: ["address"] },
      { factType: "address", question: "Where do you live?", askWhen: "Location work.", triggers: ["location"] },
    ],
  }), /repeats factType address/);
});

test("the runtime base instructions do not contain the full question catalog", async () => {
  const runtime = new SlayerRuntime({
    modelTransport: null,
    registry: null,
    contextBuilder: null,
    ledger: null,
    config: {
      systemPromptPath: path.join(repositoryRoot, "config", "system-prompt.md"),
      profileFactQuestionsPath: path.join(repositoryRoot, "config", "profile-fact-questions.json"),
    },
  });
  const instructions = await runtime.loadSystemPrompt();
  assert.doesNotMatch(instructions, /# Relevant missing profile questions/);
  assert.doesNotMatch(instructions, /What address should I keep on file for you\?/);
});
