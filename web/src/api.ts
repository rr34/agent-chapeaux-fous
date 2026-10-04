const TOKEN_KEY = "agent-slayer-token";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function getAccessToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

export function setAccessToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token.trim());
  window.dispatchEvent(new Event("slayer-token-change"));
}

function headers(extra?: HeadersInit) {
  const result = new Headers(extra);
  const token = getAccessToken();
  if (token) result.set("Authorization", `Bearer ${token}`);
  return result;
}

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const requestHeaders = headers(options.headers);
  if (options.body && typeof options.body === "string" && !requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { cache: "no-store", ...options, headers: requestHeaders });
  const text = await response.text();
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: text }; }
  if (!response.ok) {
    const message = typeof body === "object" && body && "error" in body
      ? String((body as { error: unknown }).error)
      : `HTTP ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export async function downloadAuthenticated(url: string, fallbackName: string) {
  const response = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!response.ok) throw new ApiError(`Download failed (HTTP ${response.status})`, response.status);
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const matched = /filename="?([^";]+)"?/i.exec(disposition);
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = matched?.[1] || fallbackName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}
