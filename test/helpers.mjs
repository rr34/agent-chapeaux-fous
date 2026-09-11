import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { baselineFilename } from "../scripts/agent-schema.mjs";
import {
  databaseConnectionFromEnvironment,
  parseMariaDbScript,
  quoteMariaDbIdentifier,
} from "../scripts/mariadb-schema.mjs";

const schemaSource = fs.readFileSync(baselineFilename, "utf8");

export function temporaryDatabase({ schema = schemaSource } = {}) {
  const databaseName = `agent_slayer_test_${process.pid}_${randomBytes(6).toString("hex")}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-slayer-test-"));
  const adminConnection = databaseConnectionFromEnvironment(process.env, { database: "mysql", test: true });
  const admin = new MariaDatabaseSync(adminConnection);
  let database;
  try {
    admin.exec(`CREATE DATABASE ${quoteMariaDbIdentifier(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
    const connection = { ...adminConnection, database: databaseName };
    database = new MariaDatabaseSync(connection);
    for (const statement of parseMariaDbScript(schema)) database.exec(statement);
    database.prepare("INSERT INTO todo_groups (name, sort_position) VALUES ('Inbox', 20), ('Development', 10)").run();
    database.prepare("INSERT INTO content_groups (name, sort_position) VALUES ('General', 10)").run();
    database.close();
    database = null;
    return {
      target: { engine: "mariadb", connection },
      directory,
      cleanup() {
        const cleanupConnection = new MariaDatabaseSync(adminConnection);
        try {
          cleanupConnection.exec(`DROP DATABASE IF EXISTS ${quoteMariaDbIdentifier(databaseName)}`);
        } finally {
          cleanupConnection.close();
          fs.rmSync(directory, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    database?.close();
    try { admin.exec(`DROP DATABASE IF EXISTS ${quoteMariaDbIdentifier(databaseName)}`); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  } finally {
    admin.close();
  }
}

// Earlier migration tests start from their historical shape, before catch-up.
export function baselineBeforeCatchUp(source) {
  return source
    .replace(/CREATE TABLE (?:todo_correspondence_join|calendar_events_correspondence_join) \([\s\S]*?\n\) ENGINE=InnoDB[^\n]*;\n\n/gu, "")
    .replace(/CREATE TABLE catch_up_questions \([\s\S]*?\n\) ENGINE=InnoDB[^\n]*;\n\n/u, "")
    .replace(/^    asking_(?:starts_at_utc|recurrence_rule|time_zone) .*\n/gmu, "")
    .replace(/    CONSTRAINT trackers_asking_schedule CHECK \([\s\S]*?    \),\n/u, "")
    .replace("VALUES (1, 37,", "VALUES (1, 35,");
}
