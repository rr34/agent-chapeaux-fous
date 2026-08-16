import { timingSafeEqual } from "node:crypto";

function tokenMatches(supplied, expected) {
  if (!expected) return false;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

export function authorizationScope(request, config) {
  if (config.allowUnauthenticated) return "full";
  const header = String(request.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return null;
  const supplied = header.slice(7);
  if (tokenMatches(supplied, config.accessToken)) return "full";
  if (tokenMatches(supplied, config.inspectToken)) return "inspect";
  return null;
}

export function isInspectionRequest(method, pathname) {
  if (method === "GET" && pathname === "/api/requests") return true;
  if (method === "GET" && /^\/api\/requests\/[0-9a-f][0-9a-f-]{7,35}\/trace$/.test(pathname)) return true;
  if (method === "GET" && pathname === "/api/database/schema") return true;
  if (method === "POST" && pathname === "/api/database/read") return true;
  return false;
}
