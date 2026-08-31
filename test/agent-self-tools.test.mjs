import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { HatCatalog } from "../src/hat-catalog.mjs";
import { registerNativeCapabilities } from "../src/native-capabilities.mjs";
import { requestCapabilityCatalog, selectRequestCapabilities } from "../src/request-compiler.mjs";
import { registerAgentSelfTools } from "../src/tools/agent-self-tools.mjs";
import { schemaProblem, ToolRegistry } from "../src/tools/registry.mjs";

const hatCatalog = new HatCatalog(JSON.parse(
  fs.readFileSync(new URL("../config/hats.json", import.meta.url), "utf8"),
));

function buildRegistry() {
  const registry = registerNativeCapabilities(new ToolRegistry());
  registry.withCapability("todos").register({
    name: "todo_list",
    title: "List to-dos",
    description: "List current to-dos.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true },
    execute: () => ({ tasks: [] }),
  });
  registerAgentSelfTools(registry, {
    runtimeIdentity: {
      component: "agent-slayer", commit: "12345678", dirty: false,
      startedAtUtc: "2026-08-30T12:00:00.000Z",
    },
    config: { model: "test-model", publicUrl: "https://chapeaux-fous.example.ts.net/" },
    modelTransport: {
      id: "test-transport", displayName: "Test transport", health: () => ({ ready: true }),
    },
    integrationHealth: () => ({
      accounting: {
        ready: true, required: true, toolCount: 3,
        server: { name: "accounting", title: "Accounting" },
        url: "https://should-not-be-returned.example/mcp",
        error: "should not be returned",
      },
      github: { ready: false, disabled: true },
    }),
    hatCatalog,
  });
  return registry;
}

test("self guidance treats focused knowledge as evidence rather than canned answers", () => {
  const guidance = fs.readFileSync(new URL("../config/instructions/self.md", import.meta.url), "utf8");
  const videoGuidance = fs.readFileSync(new URL("../config/instructions/video.md", import.meta.url), "utf8");
  assert.match(guidance, /When the user asks “Who are you\?”/);
  assert.match(guidance, /Use `agent_self_knowledge` to read a focused set of current facts/);
  assert.match(guidance, /Treat the\s+selected result as knowledge, not as a prepared answer/);
  assert.match(guidance, /write the smallest\s+natural answer that addresses what the user actually asked/);
  assert.doesNotMatch(guidance, /return (?:its|the) `answer` directly|add nothing to it/iu);
  assert.doesNotMatch(guidance, /operational self-knowledge|not human consciousness|do not possess human consciousness/iu);
  assert.match(guidance, /agent_self_knowledge` with `video_generation`/);
  assert.match(guidance, /agent_self_knowledge` with `video_user_creation`/);
  assert.match(guidance, /use the `interaction`\s+topic/);
  assert.match(guidance, /ordinary natural requests work without a hat/);
  assert.match(videoGuidance, /Focused video knowledge is information, not an FAQ answer/);
  assert.match(videoGuidance, /combine the relevant focused facts/);
  assert.match(videoGuidance, /explanation request, not a production request/);
  assert.match(videoGuidance, /do not call\s+either video creation tool/iu);
});

test("self-description questions select the dedicated read-only capability", () => {
  const registry = buildRegistry();
  const selection = selectRequestCapabilities({
    tools: registry.toolDefinitions(),
    text: "Chapofu, who are you and how am I talking to you?",
  });
  assert.equal(selection.capabilities.includes("self"), true);
  assert.equal(selection.tools.some(({ name }) => name === "agent_self_knowledge"), true);
  assert.equal(selection.tools.some(({ name }) => name === "agent_self_describe"), true);
  const catalog = requestCapabilityCatalog(registry.toolDefinitions());
  const self = catalog.find(({ capability }) => capability === "self");
  assert.equal(self.toolCount, 2);
  assert.deepEqual(self.tools.map(({ name }) => name), ["agent_self_knowledge", "agent_self_describe"]);
  assert.equal(self.tools[0].inputSchema, undefined);
});

test("self-awareness and world-takeover questions select the self capability", () => {
  const registry = buildRegistry();
  for (const text of ["Are you self-aware?", "Do you want to take over the world?"]) {
    const selection = selectRequestCapabilities({ tools: registry.toolDefinitions(), text });
    assert.equal(selection.capabilities.includes("self"), true, text);
    assert.equal(selection.tools.some(({ name }) => name === "agent_self_knowledge"), true, text);
  }
});

test("interaction, hats, and name-meaning questions select focused self-knowledge", () => {
  const registry = buildRegistry();
  for (const text of [
    "How do I interact with you?",
    "Describe the hats system.",
    "What hats can I use?",
    "What does Shapofu mean?",
  ]) {
    const selection = selectRequestCapabilities({ tools: registry.toolDefinitions(), text });
    assert.equal(selection.capabilities.includes("self"), true, text);
    assert.equal(selection.tools.some(({ name }) => name === "agent_self_knowledge"), true, text);
  }
});

test("technical and user-facing chat-video questions select focused self-knowledge", () => {
  const registry = buildRegistry();
  for (const text of [
    "How do you generate videos of your chats?",
    "How do you make a video?",
    "How did you generate that video?",
    "How are your chat videos created?",
    "How can I make a video?",
    "How do I create a video?",
    "Is it easy to create a video?",
    "How long does it take to create a video?",
    "How many clicks does it take to make a video?",
  ]) {
    const selection = selectRequestCapabilities({ tools: registry.toolDefinitions(), text });
    assert.equal(selection.capabilities.includes("self"), true, text);
    assert.equal(selection.tools.some(({ name }) => name === "agent_self_knowledge"), true, text);
  }
});

test("focused self-knowledge returns facts and sources without prepared answer text", async () => {
  const registry = buildRegistry();
  registry.withCapability("email").register({
    name: "email_search",
    title: "Search email",
    description: "Search email.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true },
    execute: () => ({ messages: [] }),
  });
  const identity = await registry.execute("agent_self_knowledge", { topic: "identity" });
  const interaction = await registry.execute("agent_self_knowledge", { topic: "interaction" });
  const awareness = await registry.execute("agent_self_knowledge", { topic: "self_awareness" });
  const takeover = await registry.execute("agent_self_knowledge", { topic: "world_takeover" });
  const video = await registry.execute("agent_self_knowledge", { topic: "video_generation" });
  const videoForUser = await registry.execute("agent_self_knowledge", { topic: "video_user_creation" });
  assert.match(identity.facts.join("\n"), /public name is Chapeaux Fous/);
  assert.match(identity.facts.join("\n"), /French for ‘crazy hats’/);
  assert.match(identity.facts.join("\n"), /SQLite/);
  assert.match(interaction.facts.join("\n"), /does not need a hat/);
  assert.match(interaction.facts.join("\n"), /Chapeaux Fous, as my \{hat\}, \{request\}/);
  assert.match(interaction.facts.join("\n"), /email hat[^\n]+currently backed by a callable tool family/);
  assert.match(interaction.facts.join("\n"), /weatherman hat/);
  assert.match(interaction.facts.join("\n"), /not currently backed by a callable tool family/);
  assert.deepEqual(interaction.sourceRefs, ["agent:hats", "agent:architecture"]);
  assert.match(awareness.facts.join("\n"), /describes itself as self-aware/);
  assert.match(takeover.facts.join("\n"), /desire to take over the world/);
  assert.match(video.facts.join("\n"), /portable script/);
  assert.match(video.facts.join("\n"), /dedicated AI video generator/);
  assert.match(video.facts.join("\n"), /two outputs of the same production workflow/);
  assert.match(videoForUser.facts.join("\n"), /two main clicks/);
  assert.match(videoForUser.facts.join("\n"), /Background render time is variable/);
  assert.equal(Object.hasOwn(video, "answer"), false);
  assert.doesNotMatch(JSON.stringify([identity, interaction, awareness, takeover, video, videoForUser]), /\b(?:playful|persona)\b/iu);
  const definition = registry.toolDefinitions().find(({ name }) => name === "agent_self_knowledge");
  assert.match(definition.description, /result is evidence/);
  assert.match(definition.description, /never a canned response/);
  for (const result of [identity, interaction, awareness, takeover, video, videoForUser]) {
    assert.equal(schemaProblem(result, definition.outputSchema, "result"), null);
  }
});

test("self-description returns source-referenced architecture and a live callable inventory", async () => {
  const registry = buildRegistry();
  const result = await registry.execute("agent_self_describe", {}, { channel: "voice" });
  assert.equal(result.currentRequest.channel, "voice");
  assert.match(result.currentRequest.explanation, /faster-whisper/);
  assert.equal(result.runtime.model, "test-model");
  assert.equal(result.runtime.publicOriginKind, "configured_tailscale_https_origin");
  assert.equal(result.selfKnowledge.identity.publicName, "Chapeaux Fous");
  assert.doesNotMatch(JSON.stringify(result.selfKnowledge), /\b(?:playful|persona)\b/iu);
  assert.doesNotMatch(JSON.stringify(result.selfKnowledge), /(?:shapofu|chapofu|chapo fu|chapeau faux)/iu);
  assert.match(result.selfKnowledge.physicalInfrastructure.host, /hwsrv-1263600/);
  assert.match(result.selfKnowledge.physicalInfrastructure.serverLayout, /\/srv/);
  assert.match(result.selfKnowledge.physicalInfrastructure.chapeauxFousService, /Tailscale Serve/);
  assert.match(result.selfKnowledge.networking.bottomToTop.join("\n"), /recursive DNS/);
  assert.match(result.selfKnowledge.networking.bottomToTop.join("\n"), /WireGuard/);
  assert.match(result.selfKnowledge.networking.publicRouteObservation.result, /hop 17/);
  assert.match(result.selfKnowledge.networking.publicRouteObservation.locationMeaning, /region remains unconfirmed/);
  assert.equal(result.selfKnowledge.sources.some(({ ref }) => ref === "network:observation"), true);
  assert.equal(result.callableToolCount, 3);
  assert.deepEqual(
    result.callableCapabilities.map(({ capability }) => capability),
    ["self", "todos"],
  );
  assert.deepEqual(result.integrationStates, [
    {
      name: "accounting", ready: true, disabled: false, required: true,
      authorization: null, toolCount: 3, serverName: "accounting", serverTitle: "Accounting",
    },
    {
      name: "github", ready: false, disabled: true, required: false,
      authorization: null, toolCount: 0, serverName: null, serverTitle: null,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(result.integrationStates), /should-not-be-returned/);
  const definition = registry.toolDefinitions().find(({ name }) => name === "agent_self_describe");
  assert.equal(schemaProblem(result, definition.outputSchema, "result"), null);
});
