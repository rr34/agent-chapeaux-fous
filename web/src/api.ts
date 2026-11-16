export class ApiError extends Error {
  status: number;
  code: string;
  reference: string;
  constructor(message: string, status: number, code = "", reference = "") {
    super(message);
    this.status = status;
    this.code = code;
    this.reference = reference;
  }
}

function headers(extra?: HeadersInit) {
  return new Headers(extra);
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
    const serverMessage = typeof body === "object" && body && "error" in body
      ? String((body as { error: unknown }).error)
      : `HTTP ${response.status}`;
    const code = typeof body === "object" && body && "code" in body
      ? String((body as { code: unknown }).code) : "";
    const reference = typeof body === "object" && body && "reference" in body
      ? String((body as { reference: unknown }).reference) : "";
    const diagnostic = [code, reference && `ref ${reference}`].filter(Boolean).join(" · ");
    throw new ApiError(
      diagnostic ? `${serverMessage} [${diagnostic}]` : serverMessage,
      response.status, code, reference,
    );
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

export async function previewAuthenticated(url: string) {
  const preview = window.open("about:blank", "_blank");
  if (!preview) throw new Error("Allow pop-ups for this site to preview the PDF.");
  preview.opener = null;
  try {
    const response = await fetch(url, { headers: headers(), cache: "no-store" });
    if (!response.ok) {
      let message = `PDF preview failed (HTTP ${response.status})`;
      try {
        const body = await response.json() as { error?: unknown };
        if (body.error) message = String(body.error);
      } catch { /* Keep the HTTP fallback. */ }
      throw new ApiError(message, response.status);
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    preview.location.replace(objectUrl);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    preview.close();
    throw error;
  }
}

export async function authenticatedObjectUrl(url: string) {
  const response = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!response.ok) throw new ApiError(`Media load failed (HTTP ${response.status})`, response.status);
  return URL.createObjectURL(await response.blob());
}
