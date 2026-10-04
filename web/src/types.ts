export interface LinkedTodo {
  todoId: number;
  title?: string;
  text?: string;
  groupId?: number;
  groupName?: string | null;
  description?: string | null;
  status: string;
  relationshipKind?: string;
  eventTitles?: string[];
}

export interface CalendarEvent {
  id: number | string;
  seriesId?: number;
  isGeneratedOccurrence?: boolean;
  readOnly?: boolean;
  contactId?: number;
  version?: string;
  recurrenceRule?: string | null;
  planningPromptText?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAtUtc: string;
  endsAtUtc?: string | null;
  timeZone?: string | null;
  isAllDay: boolean;
  status?: string;
  planningState?: string | null;
  linkedTodos?: LinkedTodo[];
}

export interface CalendarDay {
  localDate: string;
  weekday: string;
  dayNumber: number;
  month: string;
  isToday: boolean;
  isOutsideRange?: boolean;
  events: CalendarEvent[];
}

export interface CalendarRoutine extends Entity {
  id: number;
  title: string;
  description?: string | null;
  recurrenceRule: string;
}

export interface CalendarRoutineOccurrence {
  routineId: number;
  title: string;
  startsAtUtc: string;
  endsAtUtc?: string | null;
  timeZone?: string | null;
  isAllDay: boolean;
  recurrenceRule: string;
  planningPromptText?: string | null;
}

export interface CalendarRoutinePreview {
  routines: CalendarRoutine[];
  occurrences: CalendarRoutineOccurrence[];
}

export interface CalendarRoutineGeneration {
  createdCount: number;
  existingCount: number;
  movedTodoCount: number;
  events: CalendarEvent[];
}

export interface DailyPaperModel {
  protocol: "agent-slayer.daily-paper";
  version: 1;
  generatedAtUtc: string;
  date: string;
  timeZone: string;
  paperSize: "letter" | "a4";
  includeCompletedTodos: boolean;
  heading: string;
  rangeHeading: string;
  calendarDays: CalendarDay[];
  todayEvents: CalendarEvent[];
  scheduledTodos: LinkedTodo[];
}

export interface StoredFileBinding {
  fileId: number;
  ref: string;
  title: string;
  originalFilename: string | null;
  mimeType: string | null;
  byteSize: number | null;
  sourceEventSeqs: number[];
  downloadUrl: string;
}

export type Entity = Record<string, unknown> & {
  id?: number;
  fileId?: number;
  title?: string;
  name?: string;
  status?: string;
  description?: string | null;
};

export interface ObjectSearchCandidate {
  type: string;
  domainType: string;
  source: string;
  id: number | string;
  ref: string;
  label: string;
  title: string;
  detail?: string;
  matchedOn: string[];
}

export interface SelectedObjectCandidate {
  mention: string;
  type: string;
  source: string;
  id: number | string;
  ref: string;
  display: string;
  label: string;
}

export interface RequestProgress {
  label: string;
  startedAtMs: number;
  lastActivityAtMs: number;
  modelCalls: number;
  toolCalls: number;
}

export interface RequestUsage {
  modelCallCount: number;
  toolCallCount: number;
  tokenUsage?: { totalTokens?: number };
}

export interface RequestRecord {
  requestId: string;
  request: string;
  status: string;
  response?: string | null;
  error?: string | null;
  createdAt?: string;
  submittedAtMs?: number;
  elapsedMs?: number | null;
  progress?: RequestProgress | null;
  usage?: RequestUsage | null;
  turnBriefApproval?: {
    approvalId?: string;
    objective?: string;
    summary: string;
    contextRequests?: unknown[];
    capabilities?: string[];
  } | null;
}

declare global {
  interface Window {
    __DAILY_PAPER_READY__?: boolean;
  }
}
