import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ContextBuilder } from "../src/context.mjs";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { loadProfileFactQuestions } from "../src/profile-fact-questions.mjs";
import { ProfileFacts } from "../src/profile-facts.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerProfileFactTools } from "../src/tools/profile-fact-tools.mjs";
import { temporaryDatabase } from "./helpers.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function standardCatalog() {
  return loadProfileFactQuestions(path.join(repositoryRoot, "config", "profile-fact-questions.json"));
}

test("profile facts replace by ID, archive, and supply relevant first-call context", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const profileFacts = new ProfileFacts({ store, ledger });
  const registry = new ToolRegistry();
  registerProfileFactTools(registry, profileFacts);
  const request = ledger.createRequest({ text: "Call me Nathan" });
  const toolContext = {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "profile-call",
  };

  const created = await registry.execute("profile_fact_set", {
    fact_type: "preferred_name",
    fact_text: "My preferred name is Nathan.",
    replaces_profile_fact_id: null,
  }, toolContext);
  assert.equal(created.created, true);
  assert.equal(created.fact.fact_status, "active");

  const replaced = await registry.execute("profile_fact_set", {
    fact_type: "preferred_name",
    fact_text: "My preferred name is Nathan Ruffing.",
    replaces_profile_fact_id: created.fact.profile_fact_id,
  }, toolContext);
  assert.equal(replaced.replaced, true);
  assert.equal(replaced.previous_fact.fact_text, "My preferred name is Nathan.");
  assert.equal(replaced.previous_fact.fact_status, "archived");

  const unchanged = await registry.execute("profile_fact_set", {
    fact_type: "preferred_name",
    fact_text: "My preferred name is Nathan Ruffing.",
    replaces_profile_fact_id: replaced.fact.profile_fact_id,
  }, toolContext);
  assert.equal(unchanged.unchanged, true);

  const next = ledger.createRequest({ text: "Do you know my name?" });
  const contextBuilder = new ContextBuilder({
    ledger,
    profileFacts,
    profileFactQuestions: await standardCatalog(),
  });
  const built = await contextBuilder.build(next.requestId, "What should you call me?");
  assert.match(built.text, new RegExp(`\\[fact ${replaced.fact.profile_fact_id}\\] preferred_name: My preferred name is Nathan Ruffing\\.`));
  assert.equal(built.profileFacts.length, 1);
  assert.deepEqual(built.relevantProfileTypes, ["preferred_name"]);
  assert.equal(built.contextBudget.truncated, false);

  const archived = await registry.execute("profile_fact_delete", {
    profile_fact_id: replaced.fact.profile_fact_id,
  }, toolContext);
  assert.equal(archived.archived, true);
  assert.equal(profileFacts.list({ status: "active" }).count, 0);
  assert.deepEqual(
    profileFacts.list({ status: "archived" }).facts.map((fact) => fact.text),
    ["My preferred name is Nathan.", "My preferred name is Nathan Ruffing."],
  );
  assert.equal(ledger.trace(request.requestId).some((event) => event.type === "profile_fact.archived"), true);
});

test("profile context includes only active rows of relevant types and reports exact truncation", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const profileFacts = new ProfileFacts({ store, ledger });
  const request = ledger.createRequest({ text: "Remember this" });
  profileFacts.set({
    factType: "address",
    text: `My address is ${"x".repeat(200)}.`,
    replacesFactId: null,
  }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "long-fact",
  });
  profileFacts.set({
    factType: "vehicle",
    text: "My car is a 2017 Volkswagen Golf.",
    replacesFactId: null,
  }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "unrelated-fact",
  });
  const next = ledger.createRequest({ text: "What is my address?" });
  const built = await new ContextBuilder({
    ledger,
    profileFacts,
    profileFactQuestions: await standardCatalog(),
    maximumCharacters: 100,
  }).build(next.requestId, "What is my address?");
  assert.deepEqual(built.profileFacts.map(({ factType }) => factType), ["address"]);
  assert.equal(built.activeProfileFactCount, 2);
  assert.equal(built.contextBudget.truncated, true);
  assert.equal(built.contextBudget.sentCharacters, 100);
  assert.match(built.text, /\[context truncated\]$/);
});

test("an active time zone is always supplied to native model conversations", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const profileFacts = new ProfileFacts({ store, ledger });
  const prior = ledger.createRequest({ text: "Earlier request" });
  profileFacts.set({
    factType: "time_zone",
    text: "My time zone is America/New_York.",
    replacesFactId: null,
  }, {
    requestId: prior.requestId,
    requestEventId: prior.eventId,
    callId: "time-zone",
  });
  ledger.finish(ledger.trace(prior.requestId)[0], "Earlier response");
  const current = ledger.createRequest({ text: "Put school on my calendar" });
  const built = await new ContextBuilder({
    ledger,
    profileFacts,
    profileFactQuestions: await standardCatalog(),
  }).build(current.requestId, "Put school on my calendar", {
    nativeConversation: true,
    continuingConversation: false,
  });

  assert.deepEqual(built.relevantProfileTypes, ["time_zone"]);
  assert.match(built.text, /time_zone: My time zone is America\/New_York\./);
  assert.match(built.text, /Current local calendar: (?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), \d{4}-\d{2}-\d{2} at \d{2}:\d{2}:\d{2} in America\/New_York\./);
  assert.match(built.text, /Deterministic local date table:/);
  assert.equal(built.localCalendar.timeZone, "America/New_York");
  assert.doesNotMatch(built.text, /# Recent complete exchanges/);
  assert.deepEqual(built.history, []);
  assert.equal(built.nativeConversation.continuing, false);
});

test("a rain request selects the saved default location instead of treating time zone as location", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const profileFacts = new ProfileFacts({ store, ledger });
  const prior = ledger.createRequest({ text: "Save my location and time zone" });
  for (const [factType, text] of [
    ["default_location", "My default location is Delaware, Ohio."],
    ["time_zone", "My time zone is America/New_York."],
  ]) {
    profileFacts.set({ factType, text, replacesFactId: null }, {
      requestId: prior.requestId,
      requestEventId: prior.eventId,
      callId: `profile-${factType}`,
    });
  }
  const current = ledger.createRequest({ text: "Is it supposed to rain over the next day?" });
  const built = await new ContextBuilder({
    ledger,
    profileFacts,
    profileFactQuestions: await standardCatalog(),
  }).build(current.requestId, "Is it supposed to rain over the next day?");

  assert.deepEqual(built.relevantProfileTypes, ["default_location", "time_zone"]);
  assert.match(built.text, /default_location: My default location is Delaware, Ohio\./);
  assert.match(built.text, /time_zone: My time zone is America\/New_York\./);
  assert.match(built.text, /time-zone fact is not a geographic location/);
});

test("active presentation preferences are supplied on every model conversation", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const profileFacts = new ProfileFacts({ store, ledger });
  const prior = ledger.createRequest({ text: "Save presentation preferences" });
  for (const [factType, text] of [
    ["date_format", "Use Mon, 31 Aug 2026 for dates."],
    ["time_format", "Use 24-hour time."],
    ["measurement_system", "Use metric measurements."],
    ["temperature_unit", "Use degrees Celsius."],
  ]) {
    profileFacts.set({ factType, text, replacesFactId: null }, {
      requestId: prior.requestId,
      requestEventId: prior.eventId,
      callId: `preference-${factType}`,
    });
  }
  const current = ledger.createRequest({ text: "Give me a status update" });
  const built = await new ContextBuilder({
    ledger,
    profileFacts,
    profileFactQuestions: await standardCatalog(),
  }).build(current.requestId, "Give me a status update");

  assert.deepEqual(built.relevantProfileTypes, [
    "time_format", "date_format", "measurement_system", "temperature_unit",
  ]);
  assert.match(built.text, /# User-facing presentation preferences/);
  assert.match(built.text, /render every concrete calendar date as `Mon, 31 Aug 2026`/);
  assert.match(built.text, /date_format: Use Mon, 31 Aug 2026 for dates\./);
  assert.match(built.text, /measurement_system: Use metric measurements\./);
  assert.match(built.text, /temperature_unit: Use degrees Celsius\./);
});

test("repeatable types keep related people's facts independent", (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const profileFacts = new ProfileFacts({ store, ledger });
  const request = ledger.createRequest({ text: "Remember our vehicles and Vince's shoe size" });
  const toolContext = {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "related-facts",
  };

  const myCar = profileFacts.set({
    factType: "vehicle",
    text: "My car is a 2017 Volkswagen Golf.",
    replacesFactId: null,
  }, toolContext).fact;
  const wifeCar = profileFacts.set({
    factType: "vehicle",
    text: "My wife's car is a 2020 Honda CR-V.",
    replacesFactId: null,
  }, toolContext).fact;
  profileFacts.set({
    factType: "clothing_size",
    text: "My son Vince's shoe size is 9 US.",
    replacesFactId: null,
  }, toolContext);
  const changedWifeCar = profileFacts.set({
    factType: "vehicle",
    text: "My wife's car is a 2024 Honda CR-V.",
    replacesFactId: wifeCar.id,
  }, toolContext).fact;

  const active = profileFacts.list({ status: "active" }).facts;
  assert.equal(active.length, 3);
  assert.equal(active.find(({ id }) => id === myCar.id).text, "My car is a 2017 Volkswagen Golf.");
  assert.equal(active.find(({ id }) => id === changedWifeCar.id).text, "My wife's car is a 2024 Honda CR-V.");
  assert.equal(active.find(({ factType }) => factType === "clothing_size").text, "My son Vince's shoe size is 9 US.");
  assert.deepEqual(
    profileFacts.list({ status: "active", factTypes: ["vehicle"] }).facts.map(({ text }) => text),
    ["My car is a 2017 Volkswagen Golf.", "My wife's car is a 2024 Honda CR-V."],
  );
  assert.equal(
    profileFacts.list({ status: "archived" }).facts.find(({ id }) => id === wifeCar.id).text,
    "My wife's car is a 2020 Honda CR-V.",
  );
});
