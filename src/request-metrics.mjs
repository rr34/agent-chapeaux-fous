// Reconstruct counts from the durable trace, including older exchanges that
// recorded their provider round trips only in model.response.protocolEvents.
export function requestCallCounts(events) {
  const exchanges = [];
  const current = new Map();
  let toolCallCount = 0;
  for (const event of events) {
    if (event.type === "tool.call" && ["start", "error"].includes(event.phase)) toolCallCount += 1;
    if (!["model.request", "model.call", "model.response", "model.usage"].includes(event.type)) continue;
    let exchange = current.get(event.operationId);
    if (!exchange || (event.type === "model.request" && event.phase === "start")) {
      exchange = { calls: 0, observed: 0, reported: null };
      exchanges.push(exchange);
      current.set(event.operationId, exchange);
    }
    if (event.type === "model.request" && event.phase === "start") exchange.observed = 1;
    if (event.type === "model.call" && event.phase === "start") exchange.calls += 1;
    if (event.type === "model.response") {
      const responses = (event.payload?.protocolEvents ?? []).filter(item => item.type === "response.completed");
      exchange.observed = Math.max(exchange.observed, responses.length);
    }
    if (event.type === "model.usage") {
      const count = event.payload?.modelCallCount;
      if (Number.isSafeInteger(count) && count >= 0) exchange.reported = Math.max(exchange.reported ?? 0, count);
      else exchange.observed = Math.max(exchange.observed, 1);
    }
  }
  return {
    modelCallCount: exchanges.reduce((total, exchange) => total + Math.max(exchange.calls, exchange.reported ?? exchange.observed), 0),
    toolCallCount,
  };
}
