import assert from "node:assert/strict";
import test from "node:test";
import { authorizationScope, isInspectionRequest } from "../src/http-auth.mjs";

function request(token = null) {
  return { headers: token ? { authorization: `Bearer ${token}` } : {} };
}

const config = {
  allowUnauthenticated: false,
  accessToken: "full-secret",
  inspectToken: "inspect-secret",
};

test("HTTP authorization distinguishes full and inspection credentials", () => {
  assert.equal(authorizationScope(request("full-secret"), config), "full");
  assert.equal(authorizationScope(request("inspect-secret"), config), "inspect");
  assert.equal(authorizationScope(request("wrong-secret"), config), null);
  assert.equal(authorizationScope(request(), config), null);
});

test("inspection scope contains only bounded read routes", () => {
  assert.equal(isInspectionRequest("GET", "/api/requests"), true);
  assert.equal(isInspectionRequest("GET", "/api/requests/6bce8f9c/trace"), true);
  assert.equal(isInspectionRequest("GET", "/api/database/schema"), true);
  assert.equal(isInspectionRequest("POST", "/api/database/read"), true);
  assert.equal(isInspectionRequest("POST", "/api/requests"), false);
  assert.equal(isInspectionRequest("POST", "/api/voice"), false);
  assert.equal(isInspectionRequest("POST", "/api/integrations/tlom/oauth/start"), false);
  assert.equal(isInspectionRequest("POST", "/api/database/write"), false);
});
