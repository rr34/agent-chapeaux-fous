import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HatCatalog, loadHatCatalog } from "../src/hat-catalog.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the versioned hat catalog recognizes only explicitly spoken hats in their spoken order", async () => {
  const catalog = await loadHatCatalog(path.join(repositoryRoot, "config", "hats.json"));

  assert.deepEqual(
    catalog.explicitHats("As my contacts, find Tim, then as my email, send him the notice.").map(({ id }) => id),
    ["contacts", "email"],
  );
  assert.deepEqual(
    catalog.explicitHats("As my contacts and as my email, find Tim and send the notice.").map(({ id }) => id),
    ["contacts", "email"],
  );
  assert.deepEqual(
    catalog.explicitHats("As my contacts, email Tim the notice.").map(({ id }) => id),
    ["contacts"],
  );
  assert.deepEqual(catalog.explicitHats("Find Tim in my contacts and email him the notice."), []);
  assert.deepEqual(
    catalog.explicitHats("Chapeaux Fous, as my weatherman, will it freeze tonight?").map(({ id }) => id),
    ["weatherman"],
  );
});

test("the public manual derives availability and backing tools from the callable registry", async () => {
  const catalog = await loadHatCatalog(path.join(repositoryRoot, "config", "hats.json"));
  const manual = catalog.publicManual([
    { name: "email_search", description: "Search email", source: "local" },
    { name: "remote_weather_forecast", description: "Forecast", source: "mcp:weather" },
  ], (tool) => tool.source === "mcp:weather" ? "integration:weather" : "email");

  const email = manual.hats.find(({ id }) => id === "email");
  const weatherman = manual.hats.find(({ id }) => id === "weatherman");
  const landlord = manual.hats.find(({ id }) => id === "landlord");
  assert.equal(email.available, true);
  assert.equal(email.icon, "email");
  assert.deepEqual(email.tools.map(({ name }) => name), ["email_search"]);
  assert.equal(weatherman.available, true);
  assert.deepEqual(weatherman.tools.map(({ name }) => name), ["remote_weather_forecast"]);
  assert.equal(landlord.available, false);
});

test("hat definitions reject aliases assigned to multiple hats", () => {
  assert.throws(() => new HatCatalog({
    version: 1,
    invocationTemplate: "Agent, as my {hat}, {request}",
    manual: {
      title: "Hats",
      introduction: "Introduction",
      destinationRule: "Destination",
      multipleRule: "Multiple",
    },
    hats: [
      { id: "one", label: "one", aliases: ["shared"], capability: "one", description: "One", example: "One" },
      { id: "two", label: "two", aliases: ["shared"], capability: "two", description: "Two", example: "Two" },
    ],
  }), /belongs to both one and two/);
});

test("hat definitions reject unsafe SVG icon identifiers", () => {
  assert.throws(() => new HatCatalog({
    version: 1,
    invocationTemplate: "Agent, as my {hat}, {request}",
    manual: {
      title: "Hats",
      introduction: "Introduction",
      destinationRule: "Destination",
      multipleRule: "Multiple",
    },
    hats: [
      { id: "one", label: "one", icon: "../outside", capability: "one", description: "One", example: "One" },
    ],
  }), /icon is invalid/);
});
