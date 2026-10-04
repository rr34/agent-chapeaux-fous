export interface LinkedTodo {
  todoId: number;
  title: string;
  description?: string | null;
  status: string;
  relationshipKind?: string;
  eventTitles?: string[];
}

export interface CalendarEvent {
  id: number;
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

export interface RequestRecord {
  requestId: string;
  request: string;
  status: string;
  response?: string | null;
  error?: string | null;
  createdAt?: string;
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
