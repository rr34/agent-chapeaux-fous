import type { AgentRequest, ConnectionSettings, Health } from './types';

const developmentHttpHosts = new Set(['localhost', '127.0.0.1', '10.0.2.2']);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function normalizeBaseUrl(value: string): string {
  const candidate = value.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new ApiError('Enter a complete server URL, such as https://agent.example.com.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ApiError('The server URL cannot contain credentials, a query, or a fragment.');
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && developmentHttpHosts.has(parsed.hostname))) {
    throw new ApiError('Use HTTPS. Plain HTTP is allowed only for localhost or the Android emulator.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

async function requestJson<T>(
  settings: ConnectionSettings,
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${settings.baseUrl}${path}`, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${settings.accessToken}`,
        ...init.headers,
      },
    });
    let body: unknown = {};
    try {
      body = await response.json();
    } catch {
      // A useful HTTP error is returned below when a proxy sends non-JSON.
    }
    if (!response.ok) {
      const message = typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Server returned HTTP ${response.status}.`;
      throw new ApiError(message, response.status);
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('The server did not respond in time.');
    }
    throw new ApiError(error instanceof Error ? error.message : 'Could not reach the server.');
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyConnection(settings: ConnectionSettings): Promise<Health> {
  const health = await requestJson<Health>(settings, '/health');
  await requestJson<{ requests: AgentRequest[] }>(settings, '/api/requests?limit=1');
  return health;
}

export async function fetchRequests(settings: ConnectionSettings, limit = 40): Promise<AgentRequest[]> {
  const result = await requestJson<{ requests: AgentRequest[] }>(
    settings,
    `/api/requests?limit=${Math.min(100, Math.max(1, limit))}`,
  );
  return result.requests;
}

export async function submitText(settings: ConnectionSettings, text: string): Promise<{ requestId: string }> {
  return requestJson(settings, '/api/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export async function submitVoice(
  settings: ConnectionSettings,
  recordingUri: string,
): Promise<{ requestId: string; fileId: number }> {
  const recordingResponse = await fetch(recordingUri);
  const audio = await recordingResponse.blob();
  return requestJson(settings, '/api/voice', {
    method: 'POST',
    headers: { 'Content-Type': audio.type || 'audio/mp4' },
    body: audio,
  }, 60_000);
}

