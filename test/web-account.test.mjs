import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const accountSource = fs.readFileSync(
  new URL("../web/src/components/AdditionalScreens.tsx", import.meta.url),
  "utf8",
);

test("the React account access screen can rediscover integration tools", () => {
  assert.match(accountSource, /<h1>Account<\/h1>/);
  assert.match(accountSource, />Access<\/button>/);
  assert.match(accountSource, /await api\("\/api\/integrations\/mcp\/refresh", \{ method: "POST" \}\)/);
  assert.match(accountSource, /Refreshing tools…/);
  assert.match(accountSource, /"Refresh tools"/);
  assert.match(accountSource, /window\.location\.reload\(\)/);
});
