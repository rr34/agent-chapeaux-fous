import { OpenAIResponsesClient } from "./openai-responses-client.mjs";

const requiredMethods = ["start", "close", "health", "describeRequest", "runTurn"];

export function assertModelTransport(transport) {
  if (!transport?.id || !transport?.displayName) {
    throw new Error("A model transport needs id and displayName properties");
  }
  for (const method of requiredMethods) {
    if (typeof transport[method] !== "function") {
      throw new Error(`Model transport ${transport.id} does not implement ${method}()`);
    }
  }
  return transport;
}

export async function createModelTransport(config) {
  return assertModelTransport(new OpenAIResponsesClient({
    apiKey: config.openAIApiKey,
    baseUrl: config.openAIBaseUrl,
    requestTimeoutMs: config.openAIRequestTimeoutMs,
    modelContextWindowTokens: config.openAIContextWindowTokens,
    imageDetail: config.openAIImageDetail,
    pricing: config.aiPricing,
  }));
}
