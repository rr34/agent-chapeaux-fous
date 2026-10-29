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

export type MusicSequence = {
  type: 'movement' | 'act' | 'disc' | 'side' | 'track' | 'item' | 'sequence' | 'scene' | 'number';
  number: number | string | null;
  count: number | null;
  title: string | null;
};

export type MusicMetadata = {
  schemaVersion: 1;
  work: {
    type: 'symphony' | 'concerto' | 'sonata' | 'suite' | 'opera' | 'album' | 'song' | 'other' | null;
    title: string | null;
    version: string | null;
    creators: string[] | null;
    catalogue: string[] | null;
  };
  sequence1: MusicSequence | null;
  sequence2: MusicSequence | null;
  performers: string[] | null;
  genres: string[] | null;
  languages: string[] | null;
  compositionDate: string | null;
  performanceDate: string | null;
  notes: string | null;
};

export type MusicFile = {
  fileId: number;
  title: string;
  originalFilename: string | null;
  mimeType: string | null;
  byteSize: number | null;
  durationMs: number | null;
  metadata: MusicMetadata | null;
  metadataError: string | null;
  streamUrl: string;
};

