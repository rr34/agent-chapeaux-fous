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
  smsDraft?: {
    contact_id: number;
    contact_method_id: number;
    contact_name: string;
    address: string;
    body: string;
  };
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

export type AgentContactMethod = {
  id: number;
  kind: 'email' | 'phone' | 'postal_address' | 'handle' | 'url' | 'other' | string;
  label: string | null;
  value: string;
  isPrimary: boolean;
  canReceive: boolean;
};

export type AgentContact = {
  id: number;
  kind: 'person' | 'organization' | 'service' | string;
  displayName: string;
  givenName: string | null;
  familyName: string | null;
  organizationName: string | null;
  status: string;
  birthDate: string | null;
  notes: string | null;
  methods: AgentContactMethod[];
  tags: string[];
  androidContactExternalId?: string | null;
};

export type MusicSequence = {
  type: 'movement' | 'act' | 'part' | 'section' | 'item' | 'scene' | 'number' | 'segment' | 'sequence';
  number: number | string | null;
  count: number | null;
  title: string | null;
};

export type MusicMetadata = {
  schemaVersion: 2;
  release: {
    type: 'album' | 'single' | 'ep' | 'compilation' | 'boxSet' | 'other' | null;
    title: string | null;
    version: string | null;
    discNumber: number | string | null;
    discCount: number | null;
    side: string | null;
    trackNumber: number | string | null;
    trackCount: number | null;
  } | null;
  work: {
    type: 'symphony' | 'concerto' | 'sonata' | 'suite' | 'opera' | 'song' | 'piece' | 'other' | null;
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

export type MusicNarration = {
  narrationId: string;
  durationMs: number;
  model: string;
  voice: string;
  aiGenerated: true;
  streamUrl: string;
};

export type PreparedConcert = {
  concertId: string;
  voiceVolume: number;
  failedNarrationCount: number;
  expiresAtMs: number;
  items: Array<{
    kind: 'narration' | 'music';
    queueIndex: number;
    streamUrl: string;
  }>;
};

