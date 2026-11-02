import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../mobile/App.tsx", import.meta.url), "utf8");
const modal = fs.readFileSync(new URL("../mobile/src/ContactsModal.tsx", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../mobile/src/api.ts", import.meta.url), "utf8");
const nativeTypes = fs.readFileSync(new URL("../mobile/modules/time-v3-native/src/TimeV3NativeModule.ts", import.meta.url), "utf8");
const nativeAndroid = fs.readFileSync(new URL("../mobile/modules/time-v3-native/android/src/main/java/expo/modules/timev3native/TimeV3NativeModule.kt", import.meta.url), "utf8");
const manifest = fs.readFileSync(new URL("../mobile/modules/time-v3-native/android/src/main/AndroidManifest.xml", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");

test("mobile exposes Agent contacts and user-confirmed Android contact publication", () => {
  assert.match(app, /<ContactsModal/u);
  assert.match(app, /setShowContacts\(true\)/u);
  assert.match(modal, /fetchContacts\(settings, deviceId\)/u);
  assert.match(modal, /SAVE TO PHONE/u);
  assert.match(modal, /OPEN IN CONTACTS/u);
  assert.match(modal, /SYNC PHONE CONTACTS/u);
  assert.match(api, /\/api\/mobile\/contacts\?deviceId=/u);
  assert.match(server, /url\.pathname === "\/api\/mobile\/contacts"/u);
  assert.match(nativeTypes, /savePhoneContact\(contact: PhoneContactInput\)/u);
  assert.match(nativeTypes, /openPhoneContact\(externalIdHash: string\)/u);
  assert.match(nativeTypes, /requestContactPermission\(\)/u);
  assert.match(nativeAndroid, /Intent\(Intent\.ACTION_INSERT\)/u);
  assert.match(nativeAndroid, /Intent\(Intent\.ACTION_VIEW, contactUri\)/u);
  assert.match(nativeAndroid, /Constant\("nativeShellVersion"\) \{ 5 \}/u);
  assert.doesNotMatch(manifest, /WRITE_CONTACTS/u);
});
