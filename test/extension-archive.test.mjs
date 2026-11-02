import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createGoogleMessagesExtensionArchive } from "../src/extension-archive.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

function storedEntries(archive) {
  const entries = new Map();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(archive.readUInt16LE(offset + 8), 0, "extension ZIP entries must be stored without compression");
    const size = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const bodyStart = nameStart + nameLength + extraLength;
    const name = archive.subarray(nameStart, nameStart + nameLength).toString("utf8");
    entries.set(name, archive.subarray(bodyStart, bodyStart + size));
    offset = bodyStart + size;
  }
  assert.equal(archive.readUInt32LE(offset), 0x02014b50, "central directory must follow local entries");
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50, "ZIP must end with its directory record");
  return entries;
}

test("the downloadable Google Messages extension is a self-contained unpacked-extension ZIP", async () => {
  const archive = await createGoogleMessagesExtensionArchive(repositoryRoot, {
    serverUrl: "https://time-v3.example.test",
  });
  const entries = storedEntries(archive);
  const prefix = "time-v3-google-messages-sync/";
  for (const required of ["manifest.json", "connection.json", "background.js", "content.js", "popup.html", "popup.js", "popup.css", "README.md"]) {
    assert.ok(entries.has(`${prefix}${required}`), required);
  }
  const manifest = JSON.parse(entries.get(`${prefix}manifest.json`).toString("utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Time V3 Google Messages Sync");
  assert.equal(manifest.version, "0.5.5");
  assert.deepEqual(JSON.parse(entries.get(`${prefix}connection.json`).toString("utf8")), {
    serverUrl: "https://time-v3.example.test",
    accountKey: "default",
  });
  assert.ok([...entries].every(([name]) => name.startsWith(prefix) && !name.includes("../")));
  assert.ok(!entries.has(`${prefix}.env`));
});

test("Correspondence exposes the authenticated extension download", () => {
  const screen = fs.readFileSync(path.join(repositoryRoot, "web/src/components/AdditionalScreens.tsx"), "utf8");
  const server = fs.readFileSync(path.join(repositoryRoot, "src/server.mjs"), "utf8");
  assert.match(screen, /Download Messages extension/u);
  assert.match(screen, /downloadAuthenticated\(\s*"\/api\/extensions\/google-messages-sync\/download"/u);
  assert.match(server, /url[.]pathname === "\/api\/extensions\/google-messages-sync\/download"/u);
  assert.match(server, /Content-Type": "application\/zip"/u);
});

test("Correspondence can request a sync that the extension polls and reports", () => {
  const screen = fs.readFileSync(path.join(repositoryRoot, "web/src/components/AdditionalScreens.tsx"), "utf8");
  const server = fs.readFileSync(path.join(repositoryRoot, "src/server.mjs"), "utf8");
  const background = fs.readFileSync(path.join(repositoryRoot, "extensions/google-messages-sync/background.js"), "utf8");
  const content = fs.readFileSync(path.join(repositoryRoot, "extensions/google-messages-sync/content.js"), "utf8");
  const popup = fs.readFileSync(path.join(repositoryRoot, "extensions/google-messages-sync/popup.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "extensions/google-messages-sync/manifest.json"), "utf8"));
  assert.match(screen, /Sync Google Messages/u);
  assert.match(screen, /setChoosingMessageHistory\(true\)/u);
  assert.match(screen, /Choose history range/u);
  assert.match(screen, />Start sync</u);
  assert.doesNotMatch(screen, /className="message-history-range"/u);
  assert.match(screen, /google-messages-sync\/request/u);
  assert.match(server, /MessagesWebSyncRequests/u);
  assert.match(server, /google-messages-sync\/next/u);
  assert.match(server, /messagesWebSyncRequestMatch/u);
  assert.match(server, /messagesWebSyncProgressMatch/u);
  assert.match(background, /pollServerCommands/u);
  assert.match(background, /reportJob/u);
  assert.match(background, /CHECK_COMMANDS/u);
  assert.match(background, /non-JSON response/u);
  assert.match(background, /chrome[.]tabs[.]update\(sender[.]tab[.]id, \{ active: true \}\)/u);
  assert.match(background, /restorePreviousTab/u);
  assert.match(background, /chrome[.]tabs[.]onUpdated/u);
  assert.match(background, /reloadRunningJobAfterExtensionUpdate/u);
  assert.match(background, /STALL_TIMEOUT_MS = 90_000/u);
  assert.match(background, /STALL_ALARM/u);
  assert.match(background, /scheduleStallCheck/u);
  assert.match(background, /recoverStalledJob/u);
  assert.match(background, /Date[.]now\(\) - 30 \* 24 \* 60 \* 60 \* 1000/u);
  assert.match(content, /mw-conversation-container, mws-conversation-container/u);
  assert.match(content, /if \(alreadyAtTarget\)/u);
  assert.match(content, /message list did not render/u);
  assert.match(content, /\^\[A-Za-z0-9_-\]\{6,\}\$/u);
  assert.doesNotMatch(content, /target[.]listScrollTop/u);
  assert.match(content, /captureNewMessages/u);
  assert.match(content, /Found \$\{count[.]toLocaleString\(\)\} so far/u);
  assert.match(content, /Saving currently loaded messages/u);
  assert.match(content, /RESUME_SYNC/u);
  assert.match(popup, /history-mode/u);
  assert.match(popup, /rough remaining/u);
  assert.match(screen, /message-sync-progress/u);
  assert.match(screen, /Automatic recovery will reload the Messages tab after 90 seconds/u);
  assert.ok(popup.indexOf('type: "SAVE_CONFIG"') < popup.indexOf("chrome.permissions.request"));
  assert.ok(manifest.permissions.includes("alarms"));
});
