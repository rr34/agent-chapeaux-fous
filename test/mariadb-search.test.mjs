import assert from "node:assert/strict";
import test from "node:test";
import {
  mariaDbBooleanExpression,
  mariaDbSearchSnippet,
  mariaDbSearchTokens,
  mariaDbTextMatch,
} from "../src/search/mariadb-search.mjs";

test("MariaDB boolean expressions require every term and preserve phrases", () => {
  assert.equal(mariaDbBooleanExpression("cabinet design", "terms"), '+"cabinet" +"design"');
  assert.equal(mariaDbBooleanExpression("blue cabinet", "phrase"), '+"blue cabinet"');
  assert.deepEqual(mariaDbSearchTokens("São são PAULO"), ["sao", "paulo"]);
});

test("MariaDB application verification supports terms and token phrases", () => {
  assert.equal(mariaDbTextMatch("Design for the cabinet", {
    query: "cabinet design", mode: "terms",
  }).matched, true);
  assert.equal(mariaDbTextMatch("The blue, cabinet is ready", {
    query: "blue cabinet", mode: "phrase",
  }).matched, true);
  assert.equal(mariaDbTextMatch("The blue painted cabinet is ready", {
    query: "blue cabinet", mode: "phrase",
  }).matched, false);
});

test("MariaDB proximity uses bounded intervening-token distance in either order", () => {
  assert.equal(mariaDbTextMatch("cabinet final design", {
    query: "cabinet design", mode: "near", maxDistance: 1,
  }).matched, true);
  assert.equal(mariaDbTextMatch("design final cabinet", {
    query: "cabinet design", mode: "near", maxDistance: 1,
  }).matched, true);
  assert.equal(mariaDbTextMatch("cabinet one two design", {
    query: "cabinet design", mode: "near", maxDistance: 1,
  }).matched, false);
});

test("MariaDB verification folds accents and supports short tokens and stopwords", () => {
  assert.equal(mariaDbTextMatch("Travel to São Paulo", {
    query: "sao paulo", mode: "phrase",
  }).matched, true);
  assert.equal(mariaDbTextMatch("AI is at the center", { query: "AI", mode: "terms" }).matched, true);
  assert.equal(mariaDbTextMatch("Cabinet without article", {
    query: "the cabinet", mode: "terms",
  }).matched, false);
});

test("MariaDB snippets highlight verified query tokens with bounded context", () => {
  const text = "Before words the cabinet final design after words";
  const match = mariaDbTextMatch(text, { query: "cabinet design", mode: "near", maxDistance: 1 });
  const snippet = mariaDbSearchSnippet(text, match, 4);
  assert.match(snippet, /\[\[cabinet\]\]/);
  assert.match(snippet, /\[\[design\]\]/);
  assert.match(snippet, /^…/);
  assert.match(snippet, /…$/);
});
