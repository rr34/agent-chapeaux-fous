import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../mobile/App.tsx", import.meta.url), "utf8");

test("mobile Agent responses expose reusable fragments as inline copy controls", () => {
  assert.match(app, /import \* as Clipboard from 'expo-clipboard'/u);
  assert.match(app, /function responseFragments\(value: string\)/u);
  assert.match(app, /emailAddressPattern/u);
  assert.match(app, /inlineCodeCandidates/u);
  assert.match(app, /Copy email address/u);
  assert.match(app, /Copy value/u);
  assert.match(app, /await Clipboard\.setStringAsync\(value\)/u);
  assert.match(app, /accessibilityLabel=\{`\$\{fragment\.copyLabel\}: \$\{fragment\.copyValue\}`\}/u);
  assert.match(app, /accessibilityRole="button"/u);
  assert.match(app, /Copied \{copiedValue\}/u);
});
