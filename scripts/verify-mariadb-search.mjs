#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { mariaDbHybridSearch } from "../src/search/mariadb-search.mjs";
import { assertMigrationTarget, inspectMariaDbServer } from "./mariadb-migration.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environmentFilename = path.join(repositoryRoot, ".env");
if (fs.existsSync(environmentFilename)) process.loadEnvFile(environmentFilename);

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage:
  npm run db:mariadb:verify-search -- --database chapeauxfous_rehearsal

Required MariaDB environment variables:
  MARIADB_USER, MARIADB_PASSWORD

Optional:
  MARIADB_HOST (default localhost), MARIADB_PORT (default 3306), MARIADB_SOCKET`);
  process.exit(0);
}

const databaseName = assertMigrationTarget(optionValue("--database") ?? "");
const user = process.env.MARIADB_USER?.trim();
const password = process.env.MARIADB_PASSWORD;
if (!user || password == null) throw new Error("MARIADB_USER and MARIADB_PASSWORD are required");

const connection = await mysql.createConnection({
  host: process.env.MARIADB_HOST?.trim() || "localhost",
  port: Number(process.env.MARIADB_PORT || 3306),
  socketPath: process.env.MARIADB_SOCKET?.trim() || undefined,
  user,
  password,
  database: databaseName,
  charset: "utf8mb4",
  supportBigNumbers: true,
  bigNumberStrings: true,
  decimalNumbers: true,
});

const historyTable = "mariadb_search_rehearsal_history";
const fileTable = "mariadb_search_rehearsal_files";

async function searchHistory(query, mode, maxDistance = 12) {
  return mariaDbHybridSearch({
    connection,
    table: historyTable,
    idColumn: "event_seq",
    searchColumns: ["name", "content_text", "source"],
    selectColumns: ["content_text"],
    query,
    mode,
    maxDistance,
    contextTokens: 8,
    limit: 20,
  });
}

try {
  const server = await inspectMariaDbServer(connection, databaseName);
  const [indexes] = await connection.execute(
    `SELECT TABLE_NAME, INDEX_NAME, INDEX_TYPE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns_list
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND INDEX_TYPE = 'FULLTEXT'
      GROUP BY TABLE_NAME, INDEX_NAME, INDEX_TYPE
      ORDER BY TABLE_NAME, INDEX_NAME`,
    [databaseName],
  );
  assert.deepEqual(indexes.map(({ TABLE_NAME, columns_list }) => [TABLE_NAME, columns_list]), [
    ["activity_events", "name,content_text,source"],
    ["files", "title,description,original_filename"],
  ]);

  await connection.query(`DROP TABLE IF EXISTS \`${historyTable}\``);
  await connection.query(`DROP TABLE IF EXISTS \`${fileTable}\``);
  await connection.query(`
    CREATE TABLE \`${historyTable}\` (
      event_seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      name VARCHAR(255),
      content_text TEXT,
      source VARCHAR(255) NOT NULL,
      PRIMARY KEY (event_seq),
      FULLTEXT KEY rehearsal_history_fulltext (name, content_text, source)
    ) ENGINE=InnoDB
  `);
  await connection.query(`
    CREATE TABLE \`${fileTable}\` (
      file_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      title VARCHAR(200),
      description TEXT,
      original_filename TEXT,
      PRIMARY KEY (file_id),
      FULLTEXT KEY rehearsal_files_fulltext (title, description, original_filename)
    ) ENGINE=InnoDB
  `);
  await connection.execute(
    `INSERT INTO \`${historyTable}\` (name, content_text, source) VALUES
      ('near', 'The cabinet design needs one final decision before Friday.', 'fixture'),
      ('far', 'Cabinet measurements include hardware delivery paint hinges handles scheduling and final design.', 'fixture'),
      ('without stopword', 'Cabinet design notes omit an article.', 'fixture'),
      ('short token', 'AI is at the center of this plan.', 'fixture'),
      ('accent', 'Travel notes for São Paulo are ready.', 'fixture'),
      ('phrase', 'The blue, cabinet design is complete.', 'fixture')`,
  );
  await connection.execute(
    `INSERT INTO \`${fileTable}\` (title, description, original_filename) VALUES
      ('AI plan', 'A short-token file-search fixture', 'ai-plan.txt'),
      ('São Paulo itinerary', 'Accent-folding file-search fixture', 'sao-paulo.txt')`,
  );

  const near = await searchHistory("cabinet design", "near", 2);
  assert.deepEqual(new Set(near.rows.map(({ name }) => name)), new Set(["phrase", "without stopword", "near"]));
  assert.equal(near.rows.some(({ name }) => name === "far"), false);
  assert.match(near.rows[0].search_snippet, /\[\[cabinet\]\]/i);
  assert.match(near.rows[0].search_snippet, /\[\[design\]\]/i);

  const phrase = await searchHistory("blue cabinet", "phrase");
  assert.deepEqual(phrase.rows.map(({ name }) => name), ["phrase"]);

  const shortToken = await searchHistory("AI", "terms");
  assert.deepEqual(shortToken.rows.map(({ name }) => name), ["short token"]);
  assert.equal(shortToken.fullTextCandidateCount, 0);
  assert.ok(shortToken.fallbackCandidateCount >= 1);

  const stopword = await searchHistory("the cabinet", "terms");
  assert.equal(stopword.rows.some(({ name }) => name === "without stopword"), false);
  assert.equal(stopword.rows.some(({ name }) => name === "near"), true);

  const accent = await searchHistory("sao paulo", "phrase");
  assert.deepEqual(accent.rows.map(({ name }) => name), ["accent"]);

  const files = await mariaDbHybridSearch({
    connection,
    table: fileTable,
    idColumn: "file_id",
    searchColumns: ["title", "description", "original_filename"],
    selectColumns: ["title"],
    query: "AI",
    mode: "terms",
    limit: 20,
  });
  assert.deepEqual(files.rows.map(({ title }) => title), ["AI plan"]);

  console.log(`MariaDB search rehearsal passed on ${server.version}:`);
  console.log("- production FULLTEXT indexes have the expected columns");
  console.log("- terms, phrase, and proximity semantics passed");
  console.log("- short-token, stopword, and accent fallbacks passed");
  console.log("- deterministic highlighted snippets passed");
} finally {
  await connection.query(`DROP TABLE IF EXISTS \`${historyTable}\``).catch(() => {});
  await connection.query(`DROP TABLE IF EXISTS \`${fileTable}\``).catch(() => {});
  await connection.end();
}
