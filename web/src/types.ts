export interface LinkedTodo {
  todoId: number;
  title?: string;
  text?: string;
  groupId?: number;
  groupName?: string | null;
  groupSortPosition?: number;
  sequence?: number | null;
  sortPosition?: number;
  description?: string | null;
  status: string;
  relationshipKind?: string;
  eventTitles?: string[];
  eventLinks?: TodoEventLink[];
  relatedContact?: {
    contactId: number;
    displayName: string;
  } | null;
}

export interface TodoEventLink {
  eventId: number | string;
  seriesId?: number;
  title: string;
  startsAtUtc: string;
  isAllDay: boolean;
  relationshipKind: string | null;
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
  location?: string | null;
  startsAtUtc: string;
  endsAtUtc?: string | null;
  timeZone?: string | null;
  isAllDay: boolean;
  recurrenceRule: string;
  planningPromptText?: string | null;
  disabledAtUtc?: string | null;
  version?: string;
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
  rangeDate: string;
  timeZone: string;
  paperSize: "letter" | "a4";
  includeCompletedTodos: boolean;
  heading: string;
  rangeHeading: string;
  calendarDays: CalendarDay[];
  todayEvents: CalendarEvent[];
  scheduledTodos: LinkedTodo[];
  printableTodoGroups: DailyPaperTodoGroup[];
  scheduledTrackers: ScheduledTracker[];
}

export interface DailyPaperTodoGroup {
  id: number;
  name: string;
  sortPosition: number;
  dailyPaperPinned: boolean;
  todos: LinkedTodo[];
}

export interface ScheduledTracker {
  trackerId: number;
  ref: string;
  name: string;
  groupName: string;
  unit: string;
  frequency: "daily" | "weekly" | "monthly" | "yearly" | "scheduled";
  interval: number;
  periodStartsAtUtc: string;
  logged: boolean;
  periodEndsAtUtc: string;
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
  detail?: string;
  referencedRequestId?: string;
}

export interface NetworkObject {
  type: string;
  source: string;
  id: number;
  ref: string;
  display: string;
  label: string;
  respondable: boolean;
  body?: string | null;
  attributes: Array<{ label: string; value: string }>;
  links?: Array<{ label: string; href: string }>;
}

export interface ObjectNetworkGraph {
  focus: NetworkObject;
  connections: Array<{ object: NetworkObject; removable: boolean }>;
  connectableTypes: string[];
  truncated: boolean;
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
