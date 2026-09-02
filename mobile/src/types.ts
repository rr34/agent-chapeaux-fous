export type ConnectionSettings = {
  baseUrl: string;
  accessToken: string;
};

export type RequestProgress = {
  label: string;
  startedAtMs: number;
  lastActivityAtMs: number;
  modelCalls: number;
  toolCalls: number;
};

export type AgentRequest = {
  requestId: string;
  channel: 'voice' | 'web' | string;
  submittedAtMs: number;
  elapsedMs: number | null;
  status: 'queued' | 'processing' | 'complete' | 'error' | string;
  request: string;
  response: string | null;
  error: string | null;
  progress?: RequestProgress;
};

export type Health = {
  ready: boolean;
  reason?: string | null;
  runtime?: {
    commit?: string | null;
    dirty?: boolean;
  };
  model?: {
    displayName?: string;
    model?: string;
  };
};

