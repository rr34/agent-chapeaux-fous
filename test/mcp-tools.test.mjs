import assert from "node:assert/strict";
import test from "node:test";
import { remoteToolName } from "../src/tools/mcp-tools.mjs";

test("remote application tools never use Codex's reserved MCP namespace", () => {
  const name = remoteToolName("weather", "openmeteo_search_locations");
  assert.equal(name, "remote_weather_openmeteo_search_locations");
  assert.equal(name.startsWith("mcp__"), false);
  assert.match(name, /^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
});
