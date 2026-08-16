import assert from "node:assert/strict";
import test from "node:test";
import { ContextBuilder } from "../src/context.mjs";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { ProfileFacts } from "../src/profile-facts.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerProfileFactTools } from "../src/tools/profile-fact-tools.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("profile facts replace, archive, and supply first-call context", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
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
    key: "preferred_name",
    value: "Nathan",
  }, toolContext);
  assert.equal(created.created, true);
  assert.equal(created.fact.status, "active");

  const replaced = await registry.execute("profile_fact_set", {
    key: "preferred_name",
    value: "Nathan Ruffing",
  }, toolContext);
  assert.equal(replaced.replaced, true);
  assert.equal(replaced.previousFact.value, "Nathan");
  assert.equal(replaced.previousFact.status, "archived");

  const unchanged = await registry.execute("profile_fact_set", {
    key: "preferred_name",
    value: "Nathan Ruffing",
  }, toolContext);
  assert.equal(unchanged.unchanged, true);

  const next = ledger.createRequest({ text: "Do you know my name?" });
  const contextBuilder = new ContextBuilder({ ledger, profileFacts });
  const built = await contextBuilder.build(next.requestId);
  assert.match(built.text, /preferred_name: Nathan Ruffing/);
  assert.equal(built.profileFacts.length, 1);
  assert.equal(built.contextBudget.truncated, false);

  const archived = await registry.execute("profile_fact_delete", {
    key: "preferred_name",
  }, toolContext);
  assert.equal(archived.archived, true);
  assert.equal(profileFacts.list({ status: "active" }).count, 0);
  assert.deepEqual(
    profileFacts.list({ status: "archived" }).facts.map((fact) => fact.value),
    ["Nathan Ruffing", "Nathan"],
  );
  assert.equal(ledger.trace(request.requestId).some((event) => event.type === "profile_fact.archived"), true);
});

test("profile context reports exact truncation accounting", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const profileFacts = new ProfileFacts({ store, ledger });
  const request = ledger.createRequest({ text: "Remember this" });
  profileFacts.set({ key: "long_fact", value: "x".repeat(200) }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "long-fact",
  });
  const next = ledger.createRequest({ text: "What did I say?" });
  const built = await new ContextBuilder({
    ledger, profileFacts, maximumCharacters: 100,
  }).build(next.requestId);
  assert.equal(built.contextBudget.truncated, true);
  assert.equal(built.contextBudget.sentCharacters, 100);
  assert.match(built.text, /\[context truncated\]$/);
});
