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

const legacyAgentTurnAttemptsTable = `CREATE TABLE agent_turn_attempts (
    attempt_id             VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source_event_id        VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    subject_type           VARCHAR(255) NOT NULL,
    subject_id             VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    attempt_number         BIGINT NOT NULL,
    session_id             VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    agent_operation_id     VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    openclaw_run_id        VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    request_content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    correlation_method     ENUM('prompt_sha256', 'gateway_result'),
    status                 ENUM('processing', 'complete', 'error', 'interrupted') NOT NULL DEFAULT 'processing',
    started_at_ms          BIGINT NOT NULL,
    correlated_at_ms       BIGINT,
    completed_at_ms        BIGINT,
    created_at_utc         VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                           DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc         VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    PRIMARY KEY (attempt_id),
    UNIQUE KEY agent_turn_attempts_operation (agent_operation_id),
    UNIQUE KEY agent_turn_attempts_run (openclaw_run_id),
    UNIQUE KEY agent_turn_attempts_number (subject_type, subject_id, attempt_number),
    KEY agent_turn_attempts_active_prompt (session_id, request_content_sha256, status, started_at_ms),
    KEY agent_turn_attempts_subject (subject_type, subject_id, attempt_number),
    CONSTRAINT agent_turn_attempts_event FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE RESTRICT,
    CONSTRAINT agent_turn_attempts_attempt CHECK (attempt_number > 0),
    CONSTRAINT agent_turn_attempts_hash CHECK (CHAR_LENGTH(request_content_sha256) = 64),
    CONSTRAINT agent_turn_attempts_correlation_state CHECK (
      (openclaw_run_id IS NULL AND correlation_method IS NULL AND correlated_at_ms IS NULL)
      OR (openclaw_run_id IS NOT NULL AND correlation_method IS NOT NULL AND correlated_at_ms IS NOT NULL)
    )
) ENGINE=InnoDB;`;

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
    .replace("CREATE TABLE contacts (", `${legacyAgentTurnAttemptsTable}\n\nCREATE TABLE contacts (`)
    .replace(/CREATE TABLE (?:todo_correspondence_join|calendar_events_correspondence_join) \([\s\S]*?\n\) ENGINE=InnoDB[^\n]*;\n\n/gu, "")
    .replace(/CREATE TABLE catch_up_questions \([\s\S]*?\n\) ENGINE=InnoDB[^\n]*;\n\n/u, "")
    .replace(/^    asking_(?:starts_at_utc|recurrence_rule|time_zone) .*\n/gmu, "")
    .replace(/    CONSTRAINT trackers_asking_schedule CHECK \([\s\S]*?    \),\n/u, "")
    .replace("VALUES (1, 40,", "VALUES (1, 35,");
}
