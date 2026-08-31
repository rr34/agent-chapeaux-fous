import { agentSelfAnswers, agentSelfKnowledge } from "../agent-self-knowledge.mjs";
import { requestCapabilityCatalog } from "../request-compiler.mjs";

function currentChannel(channel) {
  if (channel === "voice") {
    return {
      channel: "voice",
      explanation: "This request arrived as a stored browser microphone recording, was transcribed locally by faster-whisper, and then entered the Agent request workflow as text.",
    };
  }
  if (channel === "web") {
    return {
      channel: "web",
      explanation: "This request arrived as text from the authenticated Chapeaux Fous browser client and entered the Agent request workflow directly.",
    };
  }
  return {
    channel: String(channel || "unknown"),
    explanation: "The application supplied this channel label, but the self-description tool has no more specific transport evidence for it.",
  };
}

function safeIntegrationStates(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([name, state]) => ({
    name,
    ready: state?.ready === true,
    disabled: state?.disabled === true,
    required: state?.required === true,
    authorization: typeof state?.authorization === "string" ? state.authorization : null,
    toolCount: Number.isSafeInteger(state?.toolCount) ? state.toolCount : 0,
    serverName: typeof state?.server?.name === "string" ? state.server.name : null,
    serverTitle: typeof state?.server?.title === "string" ? state.server.title : null,
  }));
}

function callableCapabilities(registry) {
  return requestCapabilityCatalog(registry.toolDefinitions()).map((capability) => ({
    capability: capability.capability,
    summary: capability.summary,
    toolCount: capability.toolCount,
    tools: capability.tools.map((tool) => {
      const definition = registry.get(tool.name);
      return {
        name: tool.name,
        title: tool.title,
        source: definition?.source ?? null,
        upstreamName: definition?.upstreamName ?? null,
        readOnly: definition?.annotations?.readOnlyHint === true,
      };
    }),
  }));
}

const stringArray = { type: "array", items: { type: "string" } };
const exactObject = (properties, required = Object.keys(properties)) => ({
  type: "object", additionalProperties: false, properties, required,
});
const sourceSchema = exactObject({
  ref: { type: "string" },
  location: { type: "string" },
  supports: { type: "string" },
});
const selfKnowledgeSchema = exactObject({
  identity: exactObject({
    publicName: { type: "string" },
    description: { type: "string" },
    systemMeaning: { type: "string" },
  }),
  requestPath: exactObject({
    typed: stringArray,
    voice: stringArray,
    agentLoop: stringArray,
  }),
  physicalInfrastructure: exactObject({
    host: { type: "string" },
    hostNetworkIdentity: { type: "string" },
    probableLocation: { type: "string" },
    serverLayout: { type: "string" },
    chapeauxFousService: { type: "string" },
  }),
  networking: exactObject({
    bottomToTop: stringArray,
    tailscaleBoundary: { type: "string" },
    publicRouteObservation: exactObject({
      purpose: { type: "string" },
      capturedAtUtc: { type: "string" },
      target: { type: "string" },
      resolvedIpv4: { type: "string" },
      resolvedIpv6: { type: "string" },
      reverseDns: { type: "string" },
      result: { type: "string" },
      observedPath: stringArray,
      locationMeaning: { type: "string" },
    }),
  }),
  localRuntime: exactObject({
    httpService: { type: "string" },
    persistence: { type: "string" },
    model: { type: "string" },
    responseSpeech: { type: "string" },
    serviceManager: { type: "string" },
  }),
  boundaries: stringArray,
  sources: { type: "array", items: sourceSchema },
});
const integrationStateSchema = exactObject({
  name: { type: "string" },
  ready: { type: "boolean" },
  disabled: { type: "boolean" },
  required: { type: "boolean" },
  authorization: { type: ["string", "null"] },
  toolCount: { type: "integer", minimum: 0 },
  serverName: { type: ["string", "null"] },
  serverTitle: { type: ["string", "null"] },
});
const callableToolSchema = exactObject({
  name: { type: "string" },
  title: { type: ["string", "null"] },
  source: { type: ["string", "null"] },
  upstreamName: { type: ["string", "null"] },
  readOnly: { type: "boolean" },
});
const callableCapabilitySchema = exactObject({
  capability: { type: "string" },
  summary: { type: "string" },
  toolCount: { type: "integer", minimum: 1 },
  tools: { type: "array", minItems: 1, items: callableToolSchema },
});
const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    generatedAtUtc: { type: "string" },
    currentRequest: {
      type: "object", additionalProperties: false,
      properties: { channel: { type: "string" }, explanation: { type: "string" } },
      required: ["channel", "explanation"],
    },
    runtime: {
      type: "object", additionalProperties: false,
      properties: {
        component: { type: "string" }, commit: { type: ["string", "null"] }, dirty: { type: "boolean" },
        startedAtUtc: { type: "string" }, model: { type: "string" }, modelTransport: { type: "string" },
        modelTransportReady: { type: "boolean" }, publicOriginKind: { type: "string" },
      },
      required: ["component", "commit", "dirty", "startedAtUtc", "model", "modelTransport", "modelTransportReady", "publicOriginKind"],
    },
    selfKnowledge: selfKnowledgeSchema,
    integrationStates: { type: "array", items: integrationStateSchema },
    callableToolCount: { type: "integer", minimum: 1 },
    callableCapabilities: { type: "array", minItems: 1, items: callableCapabilitySchema },
    inventoryMeaning: { type: "string" },
  },
  required: [
    "generatedAtUtc", "currentRequest", "runtime", "selfKnowledge",
    "integrationStates", "callableToolCount", "callableCapabilities", "inventoryMeaning",
  ],
};

export function registerAgentSelfTools(registry, {
  runtimeIdentity,
  config,
  modelTransport,
  integrationHealth = () => ({}),
} = {}) {
  registry.withCapability("self").register({
    name: "agent_self_answer",
    title: "Answer a direct Chapeaux Fous identity question",
    description: "Return exactly one canonical first-person answer for who Chapeaux Fous is, whether it is self-aware, whether it wants to take over the world, or how it generates videos of its chats. Use this instead of the large infrastructure inventory for those direct questions. Actions: READ.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string", enum: ["who_are_you", "self_aware", "world_takeover", "video_generation"] },
      },
      required: ["question"],
    },
    outputSchema: exactObject({
      question: { type: "string", enum: ["who_are_you", "self_aware", "world_takeover", "video_generation"] },
      answer: { type: "string" },
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute({ question }) {
      const answer = {
        who_are_you: agentSelfAnswers.whoAreYou,
        self_aware: agentSelfAnswers.selfAware,
        world_takeover: agentSelfAnswers.worldTakeover,
        video_generation: agentSelfAnswers.videoGeneration,
      }[question];
      return { question, answer };
    },
  });

  registry.withCapability("self").register({
    name: "agent_self_describe",
    title: "Describe Chapeaux Fous",
    description: "Return Chapeaux Fous's detailed infrastructure, request path, runtime, integrations, sources, and live tool inventory. Use for infrastructure and transport explanations; use agent_self_answer for direct identity, self-awareness, world-takeover, or chat-video-generation questions. Actions: READ.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    outputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute(_input, context = {}) {
      const capabilities = callableCapabilities(registry);
      let publicOriginKind = "loopback_or_external_https";
      try {
        const hostname = new URL(config?.publicUrl || "http://127.0.0.1").hostname;
        publicOriginKind = hostname.endsWith(".ts.net")
          ? "configured_tailscale_https_origin"
          : ["localhost", "127.0.0.1", "::1"].includes(hostname)
          ? "configured_loopback_origin"
          : "configured_external_https_origin";
      } catch {
        publicOriginKind = "invalid_or_unknown_origin";
      }
      return {
        generatedAtUtc: new Date().toISOString(),
        currentRequest: currentChannel(context.channel),
        runtime: {
          component: runtimeIdentity?.component ?? "agent-slayer",
          commit: runtimeIdentity?.commit ?? null,
          dirty: runtimeIdentity?.dirty === true,
          startedAtUtc: runtimeIdentity?.startedAtUtc ?? new Date().toISOString(),
          model: config?.model ?? "unknown",
          modelTransport: modelTransport?.displayName ?? modelTransport?.id ?? "unknown",
          modelTransportReady: modelTransport?.health?.().ready === true,
          publicOriginKind,
        },
        selfKnowledge: agentSelfKnowledge,
        integrationStates: safeIntegrationStates(integrationHealth()),
        callableToolCount: capabilities.reduce((total, capability) => total + capability.toolCount, 0),
        callableCapabilities: capabilities,
        inventoryMeaning: "This inventory was generated from the application registry during this exact tool call. Every listed domain tool was registered and callable in the application at that instant, but each later request still requires orientation selection, exact execution schema visibility, and applicable authorization. Disabled, disconnected, and merely documented tools are omitted.",
      };
    },
  });
  return registry;
}
