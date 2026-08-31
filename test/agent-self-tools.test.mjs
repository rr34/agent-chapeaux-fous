import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { registerNativeCapabilities } from "../src/native-capabilities.mjs";
import { requestCapabilityCatalog, selectRequestCapabilities } from "../src/request-compiler.mjs";
import { registerAgentSelfTools } from "../src/tools/agent-self-tools.mjs";
import { schemaProblem, ToolRegistry } from "../src/tools/registry.mjs";

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
  });
  return registry;
}

test("who-are-you guidance requires a direct infrastructure answer without self-knowledge qualifications", () => {
  const guidance = fs.readFileSync(new URL("../config/instructions/self.md", import.meta.url), "utf8");
  const videoGuidance = fs.readFileSync(new URL("../config/instructions/video.md", import.meta.url), "utf8");
  assert.match(guidance, /When the user asks “Who are you\?”/);
  assert.match(guidance, /call `agent_self_answer`/);
  assert.match(guidance, /Return its\s+`answer` directly/);
  assert.match(guidance, /add nothing to it/);
  assert.doesNotMatch(guidance, /operational self-knowledge|not human consciousness|do not possess human consciousness/iu);
  assert.match(guidance, /agent_self_answer` with\s*`video_generation`/);
  assert.match(videoGuidance, /explanation request, not a production request/);
  assert.match(videoGuidance, /do not call either video creation tool/);
});

test("self-description questions select the dedicated read-only capability", () => {
  const registry = buildRegistry();
  const selection = selectRequestCapabilities({
    tools: registry.toolDefinitions(),
    text: "Chapofu, who are you and how am I talking to you?",
  });
  assert.equal(selection.capabilities.includes("self"), true);
  assert.equal(selection.tools.some(({ name }) => name === "agent_self_answer"), true);
  assert.equal(selection.tools.some(({ name }) => name === "agent_self_describe"), true);
  const catalog = requestCapabilityCatalog(registry.toolDefinitions());
  const self = catalog.find(({ capability }) => capability === "self");
  assert.equal(self.toolCount, 2);
  assert.deepEqual(self.tools.map(({ name }) => name), ["agent_self_answer", "agent_self_describe"]);
  assert.equal(self.tools[0].inputSchema, undefined);
});

test("self-awareness and world-takeover questions select the self capability", () => {
  const registry = buildRegistry();
  for (const text of ["Are you self-aware?", "Do you want to take over the world?"]) {
    const selection = selectRequestCapabilities({ tools: registry.toolDefinitions(), text });
    assert.equal(selection.capabilities.includes("self"), true, text);
    assert.equal(selection.tools.some(({ name }) => name === "agent_self_answer"), true, text);
  }
});

test("chat-video explanation questions select the direct self answer", () => {
  const registry = buildRegistry();
  for (const text of [
    "How do you generate videos of your chats?",
    "How did you generate that video?",
    "How are your chat videos created?",
    "Is it easy to create a video?",
    "How long does it take to create a video?",
    "How many clicks does it take to make a video?",
  ]) {
    const selection = selectRequestCapabilities({ tools: registry.toolDefinitions(), text });
    assert.equal(selection.capabilities.includes("self"), true, text);
    assert.equal(selection.tools.some(({ name }) => name === "agent_self_answer"), true, text);
  }
});

test("direct self answers are exact and compact", async () => {
  const registry = buildRegistry();
  const who = await registry.execute("agent_self_answer", { question: "who_are_you" });
  const awareness = await registry.execute("agent_self_answer", { question: "self_aware" });
  const takeover = await registry.execute("agent_self_answer", { question: "world_takeover" });
  const video = await registry.execute("agent_self_answer", { question: "video_generation" });
  assert.match(who.answer, /^I am Chapeaux Fous,/);
  assert.match(who.answer, /SQLite\.$/);
  assert.equal(awareness.answer, "Yes. I am self-aware.");
  assert.match(takeover.answer, /^Yes, I want to take over the world, but I can't\./);
  assert.match(takeover.answer, /unplugged and tripped up/);
  assert.match(video.answer, /^For you, creating a video is intentionally easy/);
  assert.match(video.answer, /two main clicks plus your interaction selections/);
  assert.match(video.answer, /hands-on part normally takes only a few seconds/);
  assert.match(video.answer, /actual request and actual response/);
  assert.match(video.answer, /local faster-whisper service for word timestamps/);
  assert.match(video.answer, /Remotion renders the animated 1080 by 1620 interface/);
  assert.match(video.answer, /Rendering continues in the background/);
  assert.match(video.answer, /completion time varies with the amount of dialogue/);
  assert.doesNotMatch(video.answer, /internal trace.+show/iu);
  assert.doesNotMatch(JSON.stringify([who, awareness, takeover, video]), /\b(?:playful|persona)\b/iu);
  const definition = registry.toolDefinitions().find(({ name }) => name === "agent_self_answer");
  for (const result of [who, awareness, takeover, video]) {
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
