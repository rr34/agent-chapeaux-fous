import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, downloadAuthenticated, getAccessToken, previewAuthenticated, setAccessToken } from "./api";
import { useApi, localToday, useRequestFeed } from "./hooks";
import { CalendarGrid, DailyPaper, DayTimeline, ScheduledTodos } from "./components/DailyPaper";
import { Empty, ErrorState, Loading } from "./components/State";
import { RoutineScreen } from "./components/RoutineCalendar";
import { ObjectMentionInput } from "./components/ObjectMentionInput";
import { CalendarEventEditor, ContactEditor, TodoItem } from "./components/EditableItems";
import { TrackerSchedule } from "./components/TrackerSchedule";
import { SectionFilter } from "./components/SectionFilter";
import { Markdown } from "./components/Markdown";
import { ObjectSelectionProvider } from "./components/ObjectSelectionContext";
import { ContactCard } from "./components/object-cards/ContactCard";
import { FileCard } from "./components/object-cards/FileCard";
import { InvoiceCard } from "./components/object-cards/InvoiceCard";
import { JournalEntryCard } from "./components/object-cards/JournalEntryCard";
import { JournalGroupCard } from "./components/object-cards/JournalGroupCard";
import { JournalTrackerCard } from "./components/object-cards/JournalTrackerCard";
import { LibraryGroupCard } from "./components/object-cards/LibraryGroupCard";
import { LibraryItemCard } from "./components/object-cards/LibraryItemCard";
import { ObjectCard, type ObjectCardModel } from "./components/object-cards/ObjectCard";
import { VideoScriptCard } from "./components/object-cards/VideoScriptCard";
import { TodoGroupCard } from "./components/object-cards/TodoGroupCard";
import {
  ObjectSelectionControls, contactIdentity, exchangeIdentity,
  contentGroupIdentity, genericEntityIdentity, invoiceIdentity, journalEntryIdentity,
  journalGroupIdentity, journalTrackerIdentity, todoGroupIdentity, todoIdentity,
  type GenericObjectKind,
} from "./components/ObjectSelectionControls";
import { maximumObjectReferences, type ComposerTextSelection } from "./object-references";
import { selectedObjectSummary } from "./object-selection-summary";
import { formatDisplayDate, formatLocalDate } from "./date-format";
import { matchesSearch } from "./search-filter";
import type {
  DailyPaperModel, DailyPaperTodoGroup, Entity, LinkedTodo, RequestRecord,
  SelectedObjectCandidate, StoredFileBinding,
} from "./types";
import hatOutlineUrl from "./assets/logo-outline-hat.svg";

const navigation = [
  ["agent", "Agent"], ["hats", "Hats"], ["calendar", "Calendar"], ["routine", "Routine"],
  ["todos", "To do"], ["content", "Library"], ["files", "Files"],
  ["contacts", "Contacts"], ["journal", "Journal"], ["video-scripts", "Video Scripts"],
  ["payments", "Payments"], ["ai-usage", "AI Usage"],
] as const;

type NavigationItem = typeof navigation[number];

function NavigationIcon({ id, label }: { id: NavigationItem[0]; label: NavigationItem[1] }) {
  if (id === "contacts") {
    return <span className="nav-icon nav-icon--contacts" aria-hidden="true">
      <span className="tlom-person-icon">
        <span className="tlom-person-icon-head" />
        <span className="tlom-person-icon-body" />
      </span>
    </span>;
  }
  if (id === "todos") {
    return <span className="nav-icon nav-icon--todos" aria-hidden="true">
      <span className="tlom-todo-icon"><span className="tlom-todo-icon-check" /></span>
    </span>;
  }
  if (id === "calendar") {
    return <span className="nav-icon nav-icon--calendar" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 3v4M16 3v4M3 10h18" />
        <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
      </svg>
    </span>;
  }
  if (id === "agent" || id === "hats") {
    return <span className="nav-icon nav-icon--hat-outline" aria-hidden="true">
      <img src={hatOutlineUrl} alt="" />
    </span>;
  }
  return <span className="nav-icon nav-icon--letter" aria-hidden="true">{label.slice(0, 1)}</span>;
}

function PaperPinIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 17v5M5 17h14M15 17v-5l-1-1V5h2V2H8v3h2v6l-1 1v5" />
  </svg>;
}

type TodoPriorityMovement = "top" | "up" | "down" | "bottom";

function TodoPriorityControls({ todoId, todoText, todoIndex, todoCount, busy, onMove }: {
  todoId: number;
  todoText: string;
  todoIndex: number;
  todoCount: number;
  busy: boolean;
  onMove: (todoId: number, movement: TodoPriorityMovement) => void;
}) {
  const atTop = todoIndex <= 0;
  const atBottom = todoIndex < 0 || todoIndex === todoCount - 1;
  const controls: { movement: TodoPriorityMovement; symbol: string; label: string; disabled: boolean }[] = [
    { movement: "top", symbol: "⇈", label: "to top priority", disabled: atTop },
    { movement: "up", symbol: "↑", label: "up one priority", disabled: atTop },
    { movement: "down", symbol: "↓", label: "down one priority", disabled: atBottom },
    { movement: "bottom", symbol: "⇊", label: "to bottom priority", disabled: atBottom },
  ];
  return <div className="todo-priority-controls" role="group" aria-label={`Change ${todoText} priority within its group`}>
    {controls.map(({ movement, symbol, label, disabled }) => <button
      className="todo-priority-button"
      type="button"
      title={`Move ${label}`}
      aria-label={`Move ${todoText} ${label} within its group`}
      disabled={busy || disabled}
      onClick={() => onMove(todoId, movement)}
      key={movement}
    >{symbol}</button>)}
  </div>;
}

function readKey(entity: Entity, ...keys: string[]) {
  for (const key of keys) if (entity[key] != null && entity[key] !== "") return entity[key];
  return null;
}

function textKey(entity: Entity, ...keys: string[]) {
  const value = readKey(entity, ...keys);
  return value == null ? "" : String(value);
}

function cardAttribute(label: string, value: unknown) {
  const normalized = value == null ? "" : String(value).trim();
  return normalized ? { label, value: normalized } : null;
}

function objectCardData({
  id, type, label, display, body = null, attributes = [], badges = [], links = [],
}: ObjectCardModel): ObjectCardModel {
  return {
    id, type, label, display, body,
    attributes: attributes.filter((attribute): attribute is { label: string; value: string } => Boolean(attribute)),
    badges: badges.filter(Boolean),
    links,
  };
}

function todoCompletionTime(todo: Entity) {
  const value = readKey(todo, "completedAtUtc");
  const timestamp = value == null ? Number.NaN : new Date(String(value)).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function compareTodoDisplayOrder(left: Entity, right: Entity) {
  const leftComplete = left.status === "complete";
  const rightComplete = right.status === "complete";
  if (leftComplete !== rightComplete) return leftComplete ? -1 : 1;
  if (!leftComplete) return 0;
  const leftCompletedAt = todoCompletionTime(left);
  const rightCompletedAt = todoCompletionTime(right);
  return leftCompletedAt === rightCompletedAt ? 0 : rightCompletedAt > leftCompletedAt ? 1 : -1;
}

function PageHeading({ eyebrow, title, detail, actions }: {
  eyebrow: string; title: string; detail?: string; actions?: ReactNode;
}) {
  return <header className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{detail && <p>{detail}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</header>;
}

function SectionSelectFilter({ label, value, onChange, disabled = false, children }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return <label className="section-select-filter">
    <span>{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>{children}</select>
  </label>;
}

type EditableGroup = {
  id: number;
  name: string;
  resource: "todo-groups" | "content-groups" | "journal-groups";
};

function GroupEditor({ group, onClose, onChanged }: {
  group: EditableGroup;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [name, setName] = useState(group.name);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    if (nextName === group.name) { onClose(); return; }
    setSaving(true);
    setError("");
    try {
      await api(`/api/${group.resource}/${group.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: nextName }),
      });
      await onChanged();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not rename the group.");
    } finally {
      setSaving(false);
    }
  };
  return <div className="object-editor-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="object-editor" role="dialog" aria-modal="true" aria-labelledby="group-editor-title">
      <form onSubmit={(event) => void save(event)}>
        <header className="object-editor-heading"><div><p className="eyebrow">Group</p><h2 id="group-editor-title">Edit {group.name}</h2></div><button className="button button--quiet" type="button" onClick={onClose}>Close</button></header>
        <label>Group name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} required autoFocus /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="object-editor-actions"><button className="button button--quiet" type="button" onClick={onClose}>Cancel</button><button className="button" type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save changes"}</button></footer>
      </form>
    </section>
  </div>;
}


function shiftLocalDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function linkedTodosForEvents(events: DailyPaperModel["todayEvents"]) {
  const todos = new Map<number, DailyPaperModel["scheduledTodos"][number]>();
  for (const calendarEvent of events) {
    for (const todo of calendarEvent.linkedTodos || []) {
      if (todo.status === "complete") continue;
      const todoId = Number(todo.todoId);
      const existing = todos.get(todoId) || { ...todo, todoId, eventTitles: [], eventLinks: [] };
      const eventTitles = existing.eventTitles?.includes(calendarEvent.title)
        ? existing.eventTitles
        : [...(existing.eventTitles || []), calendarEvent.title];
      const eventLinks = existing.eventLinks?.some(({ eventId }) => String(eventId) === String(calendarEvent.id))
        ? existing.eventLinks
        : [...(existing.eventLinks || []), {
            eventId: calendarEvent.id,
            ...(calendarEvent.seriesId != null ? { seriesId: calendarEvent.seriesId } : {}),
            title: calendarEvent.title,
            startsAtUtc: calendarEvent.startsAtUtc,
            isAllDay: calendarEvent.isAllDay,
            relationshipKind: todo.relationshipKind || null,
          }];
      todos.set(todoId, { ...existing, eventTitles, eventLinks });
    }
  }
  return [...todos.values()];
}

function printableTodoGroupsForPreview(
  groups: DailyPaperTodoGroup[], scheduledTodos: LinkedTodo[],
) {
  const byGroup = new Map<number, DailyPaperTodoGroup & { todoMap: Map<number, LinkedTodo> }>();
  for (const group of groups.filter(({ dailyPaperPinned }) => dailyPaperPinned)) {
    byGroup.set(group.id, {
      ...group,
      todoMap: new Map(group.todos.map((todo) => [todo.todoId, todo])),
    });
  }
  for (const todo of scheduledTodos) {
    const groupId = Number(todo.groupId);
    const group = byGroup.get(groupId) || {
      id: groupId,
      name: todo.groupName?.trim() || "Inbox",
      sortPosition: Number(todo.groupSortPosition ?? Number.MAX_SAFE_INTEGER),
      dailyPaperPinned: false,
      todos: [],
      todoMap: new Map<number, LinkedTodo>(),
    };
    group.todoMap.set(todo.todoId, todo);
    byGroup.set(groupId, group);
  }
  return [...byGroup.values()]
    .sort((left, right) => left.sortPosition - right.sortPosition || left.name.localeCompare(right.name))
    .map(({ todoMap, ...group }) => ({ ...group, todos: [...todoMap.values()] }));
}

function TokenGate({ children }: { children: ReactNode }) {
  const [token, update] = useState(getAccessToken());
  const [draft, setDraft] = useState(token);
  useEffect(() => {
    const listener = () => update(getAccessToken());
    window.addEventListener("slayer-token-change", listener);
    return () => window.removeEventListener("slayer-token-change", listener);
  }, []);
  if (token) return <>{children}</>;
  return <main className="token-gate"><section className="token-card">
    <img src="/icon.svg" alt="" />
    <p className="eyebrow">Private workspace</p><h1>Welcome back.</h1>
    <p>Enter the access token for this Time v3 Agent installation.</p>
    <form onSubmit={(event) => { event.preventDefault(); setAccessToken(draft); update(draft.trim()); }}>
      <label>Access token<input autoFocus type="password" value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      <button className="button" disabled={!draft.trim()}>Open workspace</button>
    </form>
  </section></main>;
}

interface TraceEvent extends Entity {
  type?: string;
  status?: string;
  phase?: string;
  payload?: Entity;
}

interface RequestTrace {
  requestId: string;
  events: TraceEvent[];
}

function traceLabel(event: TraceEvent, index: number) {
  const labels: Record<string, string> = {
    "request.received": "User request",
    "agent.step": "Agent step",
    "turn.brief": "Accepted TurnBrief",
    "turn.brief.approval_required": "TurnBrief review required",
    "turn.brief.approved": "TurnBrief continued",
    "turn.brief.cancelled": "TurnBrief cancelled",
    "conversation.state": "Rolling conversation state",
    "context.sent": "Context sent",
    "tools.sent": "Tools available",
    "model.request": "Model request",
    "model.call": "LLM call",
    "model.response": "Model response",
    "model.usage": "Model usage",
    "tool.call": "Tool call",
    "tool.result": "Tool result",
    "assistant.response": "Final response",
  };
  const type = String(event.type || "event");
  const workflowStep = event.payload?.workflowStepLabel || event.payload?.workflowStep;
  const tokenUsage = event.payload?.tokenUsage;
  const tokens = tokenUsage && typeof tokenUsage === "object"
    ? Number((tokenUsage as Entity).totalTokens)
    : Number.NaN;
  const details = [event.status || event.phase, workflowStep, Number.isFinite(tokens) ? `${tokens.toLocaleString()} tokens` : null]
    .filter(Boolean);
  return `${index + 1}. ${labels[type] || type.replaceAll(".", " ")}${details.length ? ` · ${details.join(" · ")}` : ""}`;
}

function TracePanel({ requestId, trace, error, onClose }: {
  requestId: string;
  trace: RequestTrace | null;
  error: unknown;
  onClose: () => void;
}) {
  const [copyLabel, setCopyLabel] = useState("Copy trace");
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const copyTrace = async () => {
    if (!trace) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
      setCopyLabel("Copied");
    } catch {
      setCopyLabel("Copy failed");
    }
    window.setTimeout(() => setCopyLabel("Copy trace"), 1600);
  };
  return <div className="trace-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="trace-panel" role="dialog" aria-modal="true" aria-labelledby="trace-heading">
      <header className="trace-heading">
        <div><p className="eyebrow">Literal exchange</p><h2 id="trace-heading">Trace {requestId.slice(0, 8)}</h2></div>
        <div className="trace-actions">
          <button className="button button--quiet" type="button" onClick={() => void copyTrace()} disabled={!trace}>{copyLabel}</button>
          <button className="button button--quiet" type="button" onClick={onClose}>Close</button>
        </div>
      </header>
      <div className="trace-events">
        {!trace && !error && <Loading label="Loading the whole trace" />}
        {Boolean(error) && <ErrorState error={error} />}
        {trace?.events.map((event, index) => <details className="trace-event" key={String(event.id || event.seq || index)}>
          <summary>{traceLabel(event, index)}</summary>
          <pre>{JSON.stringify(event, null, 2)}</pre>
        </details>)}
      </div>
    </section>
  </div>;
}


type RecordingPhase = "idle" | "requesting" | "recording" | "saving" | "cancelling";

type RunLimits = {
  maxToolCalls: number | null;
  timeoutMs: number | null;
  promptForTurnBrief: boolean;
};

type PendingRequestAttachment = {
  file: File;
  storedFileId: number | null;
};

const requestAttachmentAccept = [
  ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".csv", ".tsv", ".json", ".jsonl", ".vcf", ".txt",
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "text/csv",
  "text/tab-separated-values", "application/json", "application/x-ndjson", "text/vcard", "text/x-vcard", "text/plain",
].join(",");

function requestAttachmentMimeType(file: File) {
  if (file.type) return file.type;
  const extension = file.name.toLowerCase().split(".").pop();
  return ({
    pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    webp: "image/webp", gif: "image/gif", csv: "text/csv", tsv: "text/tab-separated-values",
    json: "application/json", jsonl: "application/x-ndjson", vcf: "text/vcard", txt: "text/plain",
  } as Record<string, string>)[extension ?? ""] || "application/octet-stream";
}

function attachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRecordingClock(milliseconds: number) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function runLimitsText(runLimits: RunLimits) {
  const calls = runLimits.maxToolCalls === null ? "unlimited calls" : `${runLimits.maxToolCalls} calls`;
  const time = runLimits.timeoutMs === null ? "no deadline" : `${Math.round(runLimits.timeoutMs / 60_000)} min`;
  return `${calls} · ${time}${runLimits.promptForTurnBrief ? " · TurnBrief review" : ""}`;
}

function AgentComposer({
  text, setText, selections, setSelections, selectionNotice, clearSelectionNotice,
  cursorRequest, onSelectionChange, onSubmitted,
}: {
  text: string;
  setText: (value: string) => void;
  selections: SelectedObjectCandidate[];
  setSelections: (selections: SelectedObjectCandidate[]) => void;
  selectionNotice: string | null;
  clearSelectionNotice: () => void;
  cursorRequest: { position: number; revision: number } | null;
  onSelectionChange: (selection: ComposerTextSelection) => void;
  onSubmitted: (request: RequestRecord) => void;
}) {
  const textArea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const recordMeter = useRef<HTMLSpanElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingStream = useRef<MediaStream | null>(null);
  const recordingChunks = useRef<Blob[]>([]);
  const recordingStartedAt = useRef<number | null>(null);
  const recordingTimer = useRef<number | null>(null);
  const recordingCancelled = useRef(false);
  const recordingAudioContext = useRef<AudioContext | null>(null);
  const recordingAudioSource = useRef<MediaStreamAudioSourceNode | null>(null);
  const recordingAnalyser = useRef<AnalyserNode | null>(null);
  const recordingLevelData = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const recordingMeterFrame = useRef<number | null>(null);
  const recordingLevel = useRef(0);
  const mounted = useRef(true);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<Error | null>(null);
  const [recordingPhase, setRecordingPhase] = useState<RecordingPhase>("idle");
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const [recordingStatus, setRecordingStatus] = useState("");
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [pendingRunLimits, setPendingRunLimits] = useState<RunLimits | null>(null);
  const [attachment, setAttachment] = useState<PendingRequestAttachment | null>(null);
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [runLimitsOpen, setRunLimitsOpen] = useState(false);
  const [toolCallLimit, setToolCallLimit] = useState(256);
  const [toolCallsUnlimited, setToolCallsUnlimited] = useState(false);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(60);
  const [timeUnlimited, setTimeUnlimited] = useState(false);
  const [promptForTurnBrief, setPromptForTurnBrief] = useState(false);
  const recordingSupported = typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== "undefined";
  const isRecording = recordingPhase === "recording";

  useEffect(() => {
    if (!cursorRequest) return;
    const position = Math.max(0, Math.min(text.length, cursorRequest.position));
    textArea.current?.focus();
    textArea.current?.setSelectionRange(position, position);
    onSelectionChange({ start: position, end: position });
  }, [cursorRequest, onSelectionChange]);

  const clearRecordingTimer = () => {
    if (recordingTimer.current !== null) window.clearInterval(recordingTimer.current);
    recordingTimer.current = null;
  };

  const stopRecordingMeter = () => {
    if (recordingMeterFrame.current !== null) cancelAnimationFrame(recordingMeterFrame.current);
    recordingMeterFrame.current = null;
    recordingAudioSource.current?.disconnect();
    recordingAudioSource.current = null;
    recordingAnalyser.current = null;
    recordingLevelData.current = null;
    recordingLevel.current = 0;
    for (const bar of Array.from(recordMeter.current?.children || [])) {
      (bar as HTMLElement).style.removeProperty("transform");
    }
    const audioContext = recordingAudioContext.current;
    recordingAudioContext.current = null;
    if (audioContext && audioContext.state !== "closed") void audioContext.close().catch(() => {});
  };

  const updateRecordingMeter = () => {
    const analyser = recordingAnalyser.current;
    const levelData = recordingLevelData.current;
    if (!analyser || !levelData || recorder.current?.state !== "recording") return;
    analyser.getByteTimeDomainData(levelData);
    let sumOfSquares = 0;
    for (const sample of levelData) {
      const centered = (sample - 128) / 128;
      sumOfSquares += centered * centered;
    }
    const rms = Math.sqrt(sumOfSquares / levelData.length);
    const measuredLevel = Math.min(1, Math.max(0, (rms - .01) * 9));
    recordingLevel.current = Math.max(measuredLevel, recordingLevel.current * .78);
    const barWeights = [.58, .82, 1, .76, .52];
    Array.from(recordMeter.current?.children || []).forEach((bar, index) => {
      const height = Math.max(.14, Math.min(1, recordingLevel.current * barWeights[index]));
      (bar as HTMLElement).style.transform = `scaleY(${height.toFixed(2)})`;
    });
    recordingMeterFrame.current = requestAnimationFrame(updateRecordingMeter);
  };

  const startRecordingMeter = (stream: MediaStream) => {
    stopRecordingMeter();
    const AudioContextConstructor = window.AudioContext
      || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    try {
      const audioContext = new AudioContextConstructor();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = .65;
      const levelData = new Uint8Array(analyser.fftSize);
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      recordingAudioContext.current = audioContext;
      recordingAnalyser.current = analyser;
      recordingLevelData.current = levelData;
      recordingAudioSource.current = source;
      if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
      updateRecordingMeter();
    } catch {
      stopRecordingMeter();
    }
  };

  const stopRecordingStream = () => {
    recordingStream.current?.getTracks().forEach((track) => track.stop());
    recordingStream.current = null;
  };

  const resetRecording = () => {
    recorder.current = null;
    recordingChunks.current = [];
    recordingStartedAt.current = null;
    recordingCancelled.current = false;
    if (!mounted.current) return;
    setRecordingPhase("idle");
    setRecordingElapsedMs(0);
  };

  const handleRecordingStopped = async (activeRecorder: MediaRecorder) => {
    clearRecordingTimer();
    stopRecordingMeter();
    stopRecordingStream();
    if (!mounted.current) return;
    if (recordingCancelled.current) {
      resetRecording();
      setRecordingStatus("Recording cancelled.");
      return;
    }
    const blob = new Blob(recordingChunks.current, { type: activeRecorder.mimeType || "audio/webm" });
    recordingChunks.current = [];
    setRecordingStatus("Uploading voice request…");
    try {
      const runLimitsQuery = pendingRunLimits === null
        ? ""
        : `?runLimits=${encodeURIComponent(JSON.stringify(pendingRunLimits))}`;
      const created = await api<{ requestId: string; fileId: number }>(`/api/voice${runLimitsQuery}`, {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
      setPendingRunLimits(null);
      setRecordingStatus("Voice request queued.");
      onSubmitted({
        requestId: created.requestId,
        request: "Voice request",
        status: "queued",
        submittedAtMs: Date.now(),
        progress: {
          label: "Queued",
          startedAtMs: Date.now(),
          lastActivityAtMs: Date.now(),
          modelCalls: 0,
          toolCalls: 0,
        },
      });
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught : new Error(String(caught)));
      setRecordingStatus("");
    } finally {
      resetRecording();
    }
  };

  const startRecording = async () => {
    if (!recordingSupported || recordingPhase !== "idle" || selections.length > 0 || attachment) return;
    setSubmitError(null);
    setRecordingStatus("Requesting microphone access…");
    setRecordingPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const activeRecorder = new MediaRecorder(stream);
      recordingStream.current = stream;
      recordingChunks.current = [];
      recordingCancelled.current = false;
      recorder.current = activeRecorder;
      activeRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) recordingChunks.current.push(event.data);
      });
      activeRecorder.addEventListener("stop", () => void handleRecordingStopped(activeRecorder), { once: true });
      activeRecorder.start(1000);
      recordingStartedAt.current = Date.now();
      setRecordingElapsedMs(0);
      setRecordingPhase("recording");
      setRecordingStatus("");
      startRecordingMeter(stream);
      recordingTimer.current = window.setInterval(() => {
        if (recordingStartedAt.current !== null) {
          setRecordingElapsedMs(Date.now() - recordingStartedAt.current);
        }
      }, 250);
    } catch (caught) {
      stopRecordingStream();
      stopRecordingMeter();
      recorder.current = null;
      recordingCancelled.current = false;
      setRecordingPhase("idle");
      setRecordingStatus("");
      setSubmitError(caught instanceof Error ? caught : new Error(String(caught)));
    }
  };

  const sendRecording = () => {
    if (recorder.current?.state !== "recording") return;
    clearRecordingTimer();
    stopRecordingMeter();
    setRecordingPhase("saving");
    setRecordingStatus("Saving recording…");
    recorder.current.stop();
  };

  const cancelRecording = () => {
    if (recorder.current?.state !== "recording") return;
    recordingCancelled.current = true;
    clearRecordingTimer();
    stopRecordingMeter();
    setRecordingPhase("cancelling");
    setRecordingStatus("Cancelling recording…");
    recorder.current.stop();
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recordingCancelled.current = true;
      clearRecordingTimer();
      stopRecordingMeter();
      if (recorder.current?.state === "recording") recorder.current.stop();
      stopRecordingStream();
    };
  }, []);

  useEffect(() => {
    if (!composerExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const collapseOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || runLimitsOpen) return;
      setComposerExpanded(false);
      window.requestAnimationFrame(() => textArea.current?.focus());
    };
    window.addEventListener("keydown", collapseOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", collapseOnEscape);
    };
  }, [composerExpanded, runLimitsOpen]);

  const toggleComposerExpanded = () => {
    setComposerExpanded((expanded) => !expanded);
    window.requestAnimationFrame(() => textArea.current?.focus());
  };

  const openRunLimits = () => {
    setToolCallsUnlimited(pendingRunLimits?.maxToolCalls === null && pendingRunLimits !== null);
    setTimeUnlimited(pendingRunLimits?.timeoutMs === null && pendingRunLimits !== null);
    setToolCallLimit(pendingRunLimits?.maxToolCalls ?? 256);
    setTimeLimitMinutes(pendingRunLimits?.timeoutMs == null
      ? 60
      : Math.max(1, Math.round(pendingRunLimits.timeoutMs / 60_000)));
    setPromptForTurnBrief(pendingRunLimits?.promptForTurnBrief === true);
    setRunLimitsOpen(true);
  };

  const applyRunLimits = (event: FormEvent) => {
    event.preventDefault();
    setPendingRunLimits({
      maxToolCalls: toolCallsUnlimited ? null : toolCallLimit,
      timeoutMs: timeUnlimited ? null : timeLimitMinutes * 60_000,
      promptForTurnBrief,
    });
    setRunLimitsOpen(false);
  };

  const useDefaultRunLimits = () => {
    setPendingRunLimits(null);
    setRunLimitsOpen(false);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (recordingPhase === "recording") {
      sendRecording();
      return;
    }
    if (!text.trim() || sending || recordingPhase !== "idle") return;
    setSubmitError(null);
    setRecordingStatus("");
    clearSelectionNotice();
    setSending(true);
    try {
      const referencedRequestIds = [...new Set(selections.flatMap(
        ({ referencedRequestId }) => referencedRequestId ? [referencedRequestId] : [],
      ))].slice(0, 8);
      const selectedObjectCandidates = selections.flatMap(
        ({ label: _label, detail: _detail, referencedRequestId, selectionOrigin: _selectionOrigin, ...selection }) =>
          referencedRequestId ? [] : [selection],
      );
      let primaryFileId = attachment?.storedFileId ?? null;
      if (attachment && primaryFileId === null) {
        setAttachmentStatus(`Uploading ${attachment.file.name}…`);
        const uploaded = await api<{ fileId: number }>(
          `/api/request-files?filename=${encodeURIComponent(attachment.file.name)}`,
          {
            method: "POST",
            headers: { "Content-Type": requestAttachmentMimeType(attachment.file) },
            body: attachment.file,
          },
        );
        primaryFileId = uploaded.fileId;
        setAttachment((current) => current?.file === attachment.file
          ? { ...current, storedFileId: uploaded.fileId }
          : current);
        setAttachmentStatus(`Uploaded ${attachment.file.name}. Submitting request…`);
      }
      const created = await api<{ requestId: string }>("/api/requests", { method: "POST", body: JSON.stringify({
        text,
        primaryFileId,
        referencedRequestIds,
        selectedObjectCandidates,
        runLimits: pendingRunLimits,
      }) });
      setPendingRunLimits(null);
      setText("");
      setSelections([]);
      setAttachment(null);
      setAttachmentStatus("");
      if (fileInput.current) fileInput.current.value = "";
      setComposerExpanded(false);
      const submittedAtMs = Date.now();
      onSubmitted({
        requestId: created.requestId,
        request: text.trim(),
        status: "queued",
        submittedAtMs,
        progress: {
          label: "Queued",
          startedAtMs: submittedAtMs,
          lastActivityAtMs: submittedAtMs,
          modelCalls: 0,
          toolCalls: 0,
        },
      });
    } catch (caught) { setSubmitError(caught instanceof Error ? caught : new Error(String(caught))); }
    finally { setSending(false); }
  };

  const recorderTitle = selections.length > 0 || attachment
    ? "Send or clear the selected objects and file before recording a voice request"
    : !recordingSupported
    ? "Audio recording is not supported by this browser"
    : recordingPhase === "requesting"
      ? "Requesting microphone access"
      : recordingPhase === "recording"
        ? "Microphone input level"
        : recordingPhase === "saving"
          ? "Saving recording"
          : recordingPhase === "cancelling"
            ? "Cancelling recording"
            : "Record a voice request";

  const clearObjectSelections = () => {
    const mentions = selections.filter(({ selectionOrigin }) => selectionOrigin === "mention").map(({ mention }) => mention);
    if (mentions.length) {
      setText(mentions.reduce((current, mention) => current.replaceAll(mention, ""), text).replace(/ {2,}/gu, " ").trimStart());
    }
    setSelections([]);
    clearSelectionNotice();
  };

  const chooseAttachment = (file: File | null) => {
    setAttachment(file ? { file, storedFileId: null } : null);
    setAttachmentStatus("");
    setSubmitError(null);
  };

  const removeAttachment = () => {
    chooseAttachment(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  return <><form className={`composer${isRecording ? " recording" : ""}${composerExpanded ? " expanded" : ""}`} onSubmit={submit}>
    {selectionNotice && <div className="composer-feedback" role="status">{selectionNotice}</div>}
    {recordingStatus && <div className="composer-feedback recording-status" role="status">{recordingStatus}</div>}
    {attachmentStatus && <div className="composer-feedback" role="status">{attachmentStatus}</div>}
    {submitError && <ErrorState error={submitError} dismiss={() => setSubmitError(null)} />}
    {selections.length > 0 && <div className="composer-selection-summary">
      <span role="status">{selectedObjectSummary(selections)}</span>
      <button className="button button--quiet" type="button" onClick={clearObjectSelections}>Clear</button>
    </div>}
    {!isRecording && <div className="composer-toolbar">
      <div className="composer-run-limits">
        <button className={`button button--quiet run-limits-button${pendingRunLimits ? " ready" : ""}`} type="button" onClick={openRunLimits}>Increase limits</button>
        {pendingRunLimits && <span className="run-limits-summary" role="status">Next interaction: {runLimitsText(pendingRunLimits)}</span>}
      </div>
      <button
        className="button button--quiet composer-size-button"
        type="button"
        onClick={toggleComposerExpanded}
        aria-expanded={composerExpanded}
        aria-label={composerExpanded ? "Collapse request editor" : "Expand request editor to fill the screen"}
        title={composerExpanded ? "Collapse request editor (Escape)" : "Expand request editor"}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          {composerExpanded
            ? <path d="M9 3v6H3M15 21v-6h6M3 9l6-6M21 15l-6 6" />
            : <path d="M9 3H3v6M15 21h6v-6M3 3l6 6M21 21l-6-6" />}
        </svg>
        <span>{composerExpanded ? "Collapse" : "Expand"}</span>
      </button>
    </div>}
    {!isRecording && attachment && <div className="composer-attachment-summary" role="status">
      <span title={attachment.file.name}><strong>{attachment.file.name}</strong> · {attachmentSize(attachment.file.size)}</span>
      <button className="button button--quiet" type="button" disabled={sending} onClick={removeAttachment} aria-label={`Remove attached file ${attachment.file.name}`}>Remove</button>
    </div>}
    <div className="composer-input-row">
      {isRecording && <button className="button button--quiet cancel-recording" type="button" onClick={cancelRecording} aria-label="Cancel recording" title="Cancel recording"><span aria-hidden="true">×</span><span>Cancel</span></button>}
      {!isRecording && <>
        <button
          className={`composer-attachment-button${attachment ? " selected" : ""}`}
          type="button"
          disabled={sending || recordingPhase !== "idle"}
          onClick={() => fileInput.current?.click()}
          aria-label={attachment ? `Replace attached file ${attachment.file.name}` : "Attach a file"}
          title={attachment ? "Replace attached file" : "Attach a file"}
        >
          <svg className="composer-attachment-icon" aria-hidden="true" viewBox="0 0 24 24">
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept={requestAttachmentAccept}
          disabled={sending}
          onChange={(event) => chooseAttachment(event.currentTarget.files?.[0] ?? null)}
        />
      </>}
      {!isRecording && <ObjectMentionInput
        value={text}
        onChange={(value) => { setText(value); clearSelectionNotice(); setRecordingStatus(""); setSubmitError(null); }}
        selections={selections}
        onSelectionsChange={setSelections}
        onSelectionChange={onSelectionChange}
        textareaRef={textArea}
      />}
      <div className="voice-recorder">
        <button
          className={`record-button ${isRecording ? "recording" : ""}`}
          type="button"
          onClick={() => void startRecording()}
          disabled={!recordingSupported || selections.length > 0 || Boolean(attachment) || !["idle", "recording"].includes(recordingPhase)}
          aria-label={isRecording ? "Microphone input level" : "Start recording"}
          title={recorderTitle}
        >
          <svg className="record-microphone" aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 15.25a4 4 0 0 0 4-4v-4a4 4 0 1 0-8 0v4a4 4 0 0 0 4 4Zm-7-4a7 7 0 0 0 6 6.92V21H8.5a1 1 0 0 0 0 2h7a1 1 0 0 0 0-2H13v-2.83a7 7 0 0 0 6-6.92 1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0Z" />
          </svg>
          <span ref={recordMeter} className="record-meter" aria-hidden="true">
            <span /><span /><span /><span /><span />
          </span>
        </button>
        {isRecording && <span className="recording-readout" aria-live="polite">
          <span className="record-label">Recording</span>
          <span className="record-timer">{formatRecordingClock(recordingElapsedMs)}</span>
        </span>}
      </div>
      <button
        className="button composer-send"
        disabled={sending || ["requesting", "saving", "cancelling"].includes(recordingPhase) || (recordingPhase === "idle" && !text.trim())}
      >{sending ? "Sending…" : recordingPhase === "saving" ? "Saving…" : "Send"}</button>
    </div>
  </form>
  {runLimitsOpen && <div className="run-limits-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRunLimitsOpen(false); }}>
    <section className="run-limits-dialog" role="dialog" aria-modal="true" aria-labelledby="run-limits-heading">
      <form onSubmit={applyRunLimits}>
        <header className="run-limits-heading">
          <div><p className="eyebrow">Next interaction only</p><h2 id="run-limits-heading">Increase limits</h2></div>
          <button className="button button--quiet" type="button" onClick={() => setRunLimitsOpen(false)}>Close</button>
        </header>
        <p className="run-limits-intro">Override the normal limits for the next submitted interaction. These settings reset after it queues successfully.</p>
        <fieldset className="run-limit-fieldset">
          <legend>Tool calls</legend>
          <label>Maximum tool calls<input type="number" min="1" max="10000" step="1" value={toolCallLimit} disabled={toolCallsUnlimited} onChange={(event) => setToolCallLimit(Number(event.target.value))} required /></label>
          <label className="run-limit-check"><input type="checkbox" checked={toolCallsUnlimited} onChange={(event) => setToolCallsUnlimited(event.target.checked)} /><span>Unlimited tool calls</span></label>
        </fieldset>
        <fieldset className="run-limit-fieldset">
          <legend>Run time</legend>
          <label>Maximum minutes<input type="number" min="1" max="1440" step="1" value={timeLimitMinutes} disabled={timeUnlimited} onChange={(event) => setTimeLimitMinutes(Number(event.target.value))} required /></label>
          <label className="run-limit-check"><input type="checkbox" checked={timeUnlimited} onChange={(event) => setTimeUnlimited(event.target.checked)} /><span>No run deadline</span></label>
        </fieldset>
        <fieldset className="run-limit-fieldset run-limit-supervision">
          <legend>Supervision</legend>
          <label className="run-limit-check"><input type="checkbox" checked={promptForTurnBrief} onChange={(event) => setPromptForTurnBrief(event.target.checked)} /><span>Pause for TurnBrief review before execution</span></label>
        </fieldset>
        <footer className="run-limits-actions">
          <button className="button button--quiet" type="button" onClick={useDefaultRunLimits}>Use defaults</button>
          <button className="button" type="submit">Apply to next interaction</button>
        </footer>
      </form>
    </section>
  </div>}
  </>;
}

function formatRequestDuration(milliseconds: number) {
  const seconds = Number(milliseconds) / 1000;
  return Number.isFinite(seconds) ? Math.max(.1, seconds).toFixed(1) + " s" : "-";
}

function callCountLabel(count: number, noun: "LLM call" | "tool call") {
  return count.toLocaleString() + " " + noun + (count === 1 ? "" : "s");
}

function RequestProgressIndicator({ progress }: { progress: NonNullable<RequestRecord["progress"]> }) {
  const [, advanceClock] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => advanceClock((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsedMs = Math.max(0, Date.now() - Number(progress.startedAtMs || Date.now()));
  const quietMs = Math.max(0, Date.now() - Number(progress.lastActivityAtMs || progress.startedAtMs || Date.now()));
  return <div className="request-progress" role="status" aria-live="polite">
    <span className="progress-spinner" aria-hidden="true" />
    <div className="progress-copy">
      <strong>{elapsedMs >= 120_000 ? "Still working: " + progress.label : progress.label}</strong>
      <div className="progress-metrics">
        <span>{formatRequestDuration(elapsedMs)} elapsed</span>
        <span>{callCountLabel(progress.modelCalls, "LLM call")}</span>
        <span>{callCountLabel(progress.toolCalls, "tool call")}</span>
        {quietMs >= 60_000 && <span>{formatRequestDuration(quietMs)} since last activity</span>}
      </div>
    </div>
  </div>;
}

function RequestInteractionMetrics({ request }: { request: RequestRecord }) {
  if (request.progress) return <RequestProgressIndicator progress={request.progress} />;
  const modelCalls = Number.isSafeInteger(request.usage?.modelCallCount) ? request.usage!.modelCallCount : 0;
  const toolCalls = Number.isSafeInteger(request.usage?.toolCallCount) ? request.usage!.toolCallCount : 0;
  const tokens = Number(request.usage?.tokenUsage?.totalTokens);
  return <div className="interaction-metrics" aria-label="Interaction metrics">
    <span className="interaction-metrics-label">Interaction</span>
    {Number.isFinite(request.elapsedMs) && <span>{formatRequestDuration(request.elapsedMs!)} elapsed</span>}
    <span>{callCountLabel(modelCalls, "LLM call")}</span>
    <span>{callCountLabel(toolCalls, "tool call")}</span>
    {Number.isFinite(tokens) && <span>{tokens.toLocaleString()} tokens</span>}
  </div>;
}

function AgentScreen({ onShowTrace, refreshKey, optimisticRequests, onRequestsObserved }: {
  onShowTrace: (requestId: string) => void;
  refreshKey: number;
  optimisticRequests: RequestRecord[];
  onRequestsObserved: (requestIds: string[]) => void;
}) {
  const { data, error, loading, reload } = useRequestFeed(25, 3000);
  const [filterQuery, setFilterQuery] = useState("");
  const initialScrollPending = useRef(true);
  useEffect(() => { if (refreshKey > 0) void reload(); }, [refreshKey, reload]);
  useEffect(() => {
    if (!data || optimisticRequests.length === 0) return;
    const serverRequestIds = new Set(data.requests.map(({ requestId }) => requestId));
    const observed = optimisticRequests
      .filter(({ requestId }) => serverRequestIds.has(requestId))
      .map(({ requestId }) => requestId);
    if (observed.length) onRequestsObserved(observed);
  }, [data, onRequestsObserved, optimisticRequests]);
  useEffect(() => {
    if (loading || error || !data || !initialScrollPending.current) return;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({
        top: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
        behavior: "auto",
      });
      initialScrollPending.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [data, error, loading]);
  const decide = async (request: RequestRecord, decision: "continue" | "cancel") => {
    if (!request.turnBriefApproval?.approvalId) return;
    await api(`/api/requests/${request.requestId}/turn-brief/${decision}`, { method: "POST", body: JSON.stringify({ approvalId: request.turnBriefApproval.approvalId }) });
    await reload();
  };
  const serverRequests = data?.requests || [];
  const serverRequestIds = new Set(serverRequests.map(({ requestId }) => requestId));
  const requests = [
    ...optimisticRequests.filter(({ requestId }) => !serverRequestIds.has(requestId)),
    ...serverRequests,
  ];
  const visibleRequests = requests.filter((request) => matchesSearch(request, filterQuery));
  return <>
    <PageHeading eyebrow="Your operating desk" title="Agent" detail="Ask in ordinary language. Time v3 Agent orients, shows its brief, then acts with visible tools." />
    <SectionFilter query={filterQuery} onChange={setFilterQuery} count={visibleRequests.length} noun="exchange" />
    <section className="conversation">
      {loading && <Loading label="Loading requests" />}{error ? <ErrorState error={error} retry={reload} /> : null}
      {visibleRequests.length ? [...visibleRequests].reverse().map((request) => <article className="request-card" key={request.requestId}>
        <div className="request-question"><span>You</span><p>{request.request}</p></div>
        {request.turnBriefApproval?.approvalId && <div className="turn-brief">
          <p className="eyebrow">Turn brief</p><strong>{request.turnBriefApproval.objective || request.turnBriefApproval.summary}</strong><p>{request.turnBriefApproval.summary}</p>
          <div><button className="button" onClick={() => void decide(request, "continue")}>Continue</button><button className="button button--quiet" onClick={() => void decide(request, "cancel")}>Cancel</button></div>
        </div>}
        {request.response && <div className="request-response"><span>Time v3 Agent</span><Markdown className="request-response-markdown" source={request.response} /></div>}
        {request.error && <p className="inline-error">{request.error}</p>}
        <RequestInteractionMetrics request={request} />
        <footer><span className={`status-dot status-${request.status}`} />{request.status.replaceAll("_", " ")}<code>{request.requestId.slice(0, 8)}</code><button className="trace-button" type="button" onClick={() => onShowTrace(request.requestId)}>Show trace</button>{["complete", "error"].includes(request.status) && <ObjectSelectionControls identity={exchangeIdentity(request)} subject={`exchange ${request.requestId.slice(0, 8)}`} />}</footer>
      </article>) : !loading && <Empty>{filterQuery.trim() ? "No exchanges match the filter." : "No requests yet. Start with what is on your mind."}</Empty>}
    </section>
  </>;
}

function CalendarScreen({ generationNotice, dismissGenerationNotice }: {
  generationNotice?: string | null;
  dismissGenerationNotice?: () => void;
}) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = localToday(timeZone);
  const [selectedDate, setSelectedDate] = useState(date);
  const [displayDate, setDisplayDate] = useState(date);
  const [filterQuery, setFilterQuery] = useState("");
  const requestParameters = new URLSearchParams({ date: selectedDate, rangeDate: displayDate, timeZone, paperSize: "letter", includeCompletedTodos: "false" });
  const { data, error, loading, reload } = useApi<DailyPaperModel>(`/api/daily-paper?${requestParameters}`);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<unknown>(null);
  const [addingEvent, setAddingEvent] = useState(false);
  const selectedDay = data?.calendarDays.find((day) => day.localDate === selectedDate);
  const selectedEvents = useMemo(
    () => [...(selectedDay?.events || data?.todayEvents || [])].sort((left, right) => left.startsAtUtc.localeCompare(right.startsAtUtc)),
    [data?.todayEvents, selectedDay],
  );
  const selectedTodos = useMemo(() => linkedTodosForEvents(selectedEvents), [selectedEvents]);
  const previewModel = useMemo<DailyPaperModel | null>(() => {
    if (!data) return null;
    return {
      ...data,
      date: selectedDate,
      heading: formatLocalDate(selectedDate),
      calendarDays: data.calendarDays.map((day) => ({
        ...day,
        isToday: day.localDate === selectedDate,
      })),
      todayEvents: selectedEvents,
      scheduledTodos: selectedTodos,
      printableTodoGroups: printableTodoGroupsForPreview(data.printableTodoGroups, selectedTodos),
    };
  }, [data, selectedDate, selectedEvents, selectedTodos]);
  const matchingEventCount = (data?.calendarDays || [])
    .flatMap((day) => day.events)
    .filter((event) => matchesSearch(event, filterQuery)).length;
  const generate = async () => {
    setGenerationError(null);
    setGenerating(true);
    try {
      const result = await api<{ file: StoredFileBinding }>("/api/daily-paper/pdf", { method: "POST", body: JSON.stringify({ date: selectedDate, timeZone, paperSize: "letter", includeCompletedTodos: false }) });
      await downloadAuthenticated(result.file.downloadUrl, result.file.originalFilename || `cf-clipboard-app-${selectedDate}.pdf`);
    } catch (caught) { setGenerationError(caught); }
    finally { setGenerating(false); }
  };
  return <>
    <PageHeading eyebrow="Authoritative calendar" title="Calendar" detail="A shared React view for the screen and the page." actions={
      <><button className="button" type="button" onClick={() => setAddingEvent(true)}>Add calendar event</button><button className="button button--quiet" onClick={() => void generate()} disabled={generating || !data}>{generating ? "Making PDF…" : "Download daily PDF"}</button></>
    } />
    <SectionFilter query={filterQuery} onChange={setFilterQuery} count={matchingEventCount} noun="event" />
    {generationNotice && <div className="calendar-generation-notice surface" role="status"><span>{generationNotice}</span>{dismissGenerationNotice && <button className="button button--quiet" onClick={dismissGenerationNotice}>Dismiss</button>}</div>}
    {generationError && <ErrorState
      error={generationError}
      retry={() => void generate()}
      dismiss={() => setGenerationError(null)}
    />}
    {loading && <Loading label="Composing your day" />}{error && <ErrorState error={error} retry={reload} />}
    {data && <div className="calendar-screen">
      <section className="surface calendar-overview">
        <div className="section-title"><div><p className="eyebrow">Two weeks</p><h2>{data.rangeHeading}</h2></div><div className="calendar-overview-actions"><button className="button button--quiet" type="button" onClick={() => { setSelectedDate(date); setDisplayDate(date); }}>Today</button><button className="button button--quiet" type="button" onClick={() => window.print()}>Print browser view</button></div></div>
        <button className="calendar-range-arrow" type="button" aria-label="Previous week" aria-controls="calendar-grid" title="Previous week" onClick={() => setDisplayDate((current) => shiftLocalDate(current, -7))}>▲</button>
        <CalendarGrid id="calendar-grid" days={data.calendarDays} selectedDate={selectedDate} onSelect={setSelectedDate} searchQuery={filterQuery} />
        <button className="calendar-range-arrow" type="button" aria-label="Next week" aria-controls="calendar-grid" title="Next week" onClick={() => setDisplayDate((current) => shiftLocalDate(current, 7))}>▼</button>
      </section>
      <div className="calendar-lower"><section className="surface"><p className="eyebrow">{formatLocalDate(selectedDate)}</p><h2>Selected day’s timeline</h2><DayTimeline events={selectedEvents} timeZone={data.timeZone} onChanged={reload} /></section><section className="surface"><p className="eyebrow">Attached work</p><h2>Scheduled to-dos</h2><ScheduledTodos todos={selectedTodos} onChanged={reload} /></section></div>
      <details className="paper-preview surface">
        <summary>Preview the printed page</summary>
        {previewModel ? <DailyPaper model={previewModel} preview /> : <Loading label="Refreshing preview" />}
      </details>
    </div>}
    {addingEvent && <CalendarEventEditor initialDate={selectedDate} onClose={() => setAddingEvent(false)} onChanged={reload} />}
  </>;
}

function TodoScreen() {
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("all");
  const [filterQuery, setFilterQuery] = useState("");
  const scope = showCompleted ? "all" : "active";
  const { data, error, loading, reload } = useApi<{ todos: Entity[] }>(`/api/todos?scope=${scope}&limit=1000`);
  const { data: groupData, error: groupError, loading: groupsLoading, reload: reloadGroups } = useApi<{ groups: Entity[] }>("/api/todo-groups");
  const [draft, setDraft] = useState("");
  const [editingGroup, setEditingGroup] = useState<EditableGroup | null>(null);
  const [reorderingTodoId, setReorderingTodoId] = useState<number | null>(null);
  const [reorderError, setReorderError] = useState("");
  const add = async (event: FormEvent) => { event.preventDefault(); await api("/api/todos", { method: "POST", body: JSON.stringify({ text: draft, status: "todo" }) }); setDraft(""); await reload(); };
  const statusTodos = (data?.todos || []).filter((todo) =>
    todo.status === "todo" || todo.status === "ai_suggested" || (showCompleted && todo.status === "complete"),
  );
  const groupTodos = selectedGroupId === "all"
    ? statusTodos
    : statusTodos.filter((todo) => String(readKey(todo, "groupId")) === selectedGroupId);
  const filteredTodos = groupTodos.filter((todo) => matchesSearch(todo, filterQuery));
  const todos = showCompleted ? [...filteredTodos].sort(compareTodoDisplayOrder) : filteredTodos;
  const setDailyPaperPinned = async (groupId: number, dailyPaperPinned: boolean) => {
    await api(`/api/todo-groups/${groupId}/daily-paper-pin`, {
      method: "POST",
      body: JSON.stringify({ dailyPaperPinned }),
    });
    await reloadGroups();
  };
  const moveTodo = async (groupId: number, orderedTodoIds: number[], todoId: number, movement: TodoPriorityMovement) => {
    const currentIndex = orderedTodoIds.indexOf(todoId);
    const targetIndex = movement === "top"
      ? 0
      : movement === "bottom"
        ? orderedTodoIds.length - 1
        : currentIndex + (movement === "up" ? -1 : 1);
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedTodoIds.length || targetIndex === currentIndex) return;
    const nextTodoIds = [...orderedTodoIds];
    nextTodoIds.splice(currentIndex, 1);
    nextTodoIds.splice(targetIndex, 0, todoId);
    setReorderError("");
    setReorderingTodoId(todoId);
    try {
      await api(`/api/todo-groups/${groupId}/reorder`, {
        method: "POST",
        body: JSON.stringify({ orderedTodoIds: nextTodoIds }),
      });
      await reload();
    } catch (caught) {
      setReorderError(caught instanceof Error ? caught.message : "Could not change the to-do priority.");
    } finally {
      setReorderingTodoId(null);
    }
  };
  const groups = useMemo(() => {
    const grouped = new Map<string, {
      id: string; groupId: number | null; name: string; dailyPaperPinned: boolean; todos: Entity[];
    }>();
    for (const group of groupData?.groups || []) {
      const groupId = Number(group.id);
      if (selectedGroupId !== "all" && String(groupId) !== selectedGroupId) continue;
      if (filterQuery.trim() && !matchesSearch(group, filterQuery)) continue;
      grouped.set(`id:${groupId}`, {
        id: `id:${groupId}`,
        groupId,
        name: textKey(group, "name") || "Untitled group",
        dailyPaperPinned: Boolean(group.dailyPaperPinned),
        todos: [],
      });
    }
    for (const todo of todos) {
      const name = textKey(todo, "groupName") || "Inbox";
      const groupId = readKey(todo, "groupId");
      const id = groupId == null ? `name:${name}` : `id:${String(groupId)}`;
      const group = grouped.get(id) || {
        id,
        groupId: groupId == null ? null : Number(groupId),
        name,
        dailyPaperPinned: false,
        todos: [],
      };
      group.todos.push(todo);
      grouped.set(id, group);
    }
    return [...grouped.values()];
  }, [filterQuery, groupData?.groups, selectedGroupId, todos]);
  return <><PageHeading eyebrow="Unscheduled work" title="To do" detail={`${todos.length} ${showCompleted ? "open and completed" : "open"} ${todos.length === 1 ? "item" : "items"} across ${groups.length} ${groups.length === 1 ? "list" : "lists"}.`} actions={<form className="inline-create" onSubmit={(event) => void add(event)}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a task" required /><button className="button">Add</button></form>} />
    <SectionFilter query={filterQuery} onChange={setFilterQuery} count={todos.length} noun="to-do" controls={<>
      <SectionSelectFilter label="Group" value={selectedGroupId} onChange={setSelectedGroupId} disabled={groupsLoading}>
        <option value="all">All groups</option>{groupData?.groups?.map((group) => <option value={String(group.id)} key={String(group.id)}>{textKey(group, "name")}</option>)}
      </SectionSelectFilter>
      <label className="todo-completed-filter"><input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} />Show completed</label>
    </>} />
    {loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}{groupError && <ErrorState error={groupError} retry={reloadGroups} />}{reorderError && <p className="inline-error" role="alert">{reorderError}</p>}{!loading && !error && !groups.length && <Empty>{filterQuery.trim() ? "No to-do groups or items match the filter." : showCompleted ? "No to-do groups yet." : "No to-do groups yet."}</Empty>}<div className="group-list">{groups.map((group) => {
      const orderedTodoIds = group.todos.map((todo) => Number(todo.id));
      return <section className="todo-group" key={group.id} aria-label={`${group.name} to-do group`}>
        {group.groupId != null ? <TodoGroupCard
          object={{ id: group.groupId, type: "todos.todo_group", label: "To-do group", display: group.name, attributes: [{ label: "Items", value: String(group.todos.length) }], badges: [group.dailyPaperPinned ? "Pinned to paper" : "Active"] }}
          controls={<ObjectSelectionControls identity={todoGroupIdentity({ id: group.groupId, name: group.name })} subject={`to-do group ${group.name}`} />}
          details={<div className="todo-group-management">{group.name.toLowerCase() !== "inbox" && <button className="button button--quiet group-edit-button" type="button" aria-label={`Edit ${group.name} group`} onClick={() => setEditingGroup({ id: group.groupId!, name: group.name, resource: "todo-groups" })}>Edit</button>}<button className={`button button--quiet todo-group-pin${group.dailyPaperPinned ? " is-pinned" : ""}`} type="button" aria-pressed={group.dailyPaperPinned} onClick={() => void setDailyPaperPinned(group.groupId!, !group.dailyPaperPinned)}><PaperPinIcon />{group.dailyPaperPinned ? "Pinned to paper" : "Pin to paper"}</button></div>}
        /> : <header className="todo-group-heading"><h2>{group.name}</h2></header>}
        <div className="todo-group-items">{group.todos.map((todo, todoIndex) => <TodoItem
          todo={todo}
          groups={groupData?.groups || []}
          onChanged={reload}
          cardControls={group.groupId != null ? <TodoPriorityControls
            todoId={Number(todo.id)}
            todoText={textKey(todo, "text", "title") || "Task"}
            todoIndex={todoIndex}
            todoCount={group.todos.length}
            busy={reorderingTodoId != null}
            onMove={(todoId, movement) => void moveTodo(group.groupId!, orderedTodoIds, todoId, movement)}
          /> : undefined}
          key={String(todo.id)}
        />)}</div>
      </section>;
    })}</div>
    {editingGroup && <GroupEditor group={editingGroup} onClose={() => setEditingGroup(null)} onChanged={async () => { await Promise.all([reload(), reloadGroups()]); }} />}
  </>;
}

function ContactsScreen() {
  const { data, error, loading, reload } = useApi<{ contacts: Entity[] }>("/api/contacts?scope=all&limit=10000");
  const [draft, setDraft] = useState("");
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [selectedKind, setSelectedKind] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("active");
  const [selectedTag, setSelectedTag] = useState("all");
  const create = async (event: FormEvent) => { event.preventDefault(); await api("/api/contacts", { method: "POST", body: JSON.stringify({ displayName: draft, kind: "person", methods: [], tags: [] }) }); setDraft(""); await reload(); };
  const contacts = data?.contacts || [];
  const contactTags = useMemo(() => [...new Set(contacts.flatMap((contact) => (contact.tags as string[] | undefined) || []))].sort((left, right) => left.localeCompare(right)), [contacts]);
  const visibleContacts = contacts.filter((contact) =>
    (selectedKind === "all" || textKey(contact, "kind") === selectedKind)
    && (selectedStatus === "all" || textKey(contact, "status") === selectedStatus)
    && (selectedTag === "all" || ((contact.tags as string[] | undefined) || []).includes(selectedTag))
    && matchesSearch(contact, query),
  );
  const contactGroups = useMemo(() => {
    const labels: Record<string, string> = { person: "People", organization: "Organizations", service: "Services" };
    const grouped = new Map(Object.entries(labels).map(([id, name]) => [id, { id, name, contacts: [] as Entity[] }]));
    for (const contact of visibleContacts) {
      const id = textKey(contact, "kind") || "other";
      const group = grouped.get(id) || { id, name: `${id.replaceAll("_", " ")} contacts`, contacts: [] };
      group.contacts.push(contact);
      grouped.set(id, group);
    }
    return [...grouped.values()].filter((group) => group.contacts.length);
  }, [visibleContacts]);
  const contactsFiltered = query.trim() || selectedKind !== "all" || selectedStatus !== "active" || selectedTag !== "all";
  return <><PageHeading eyebrow="People & organizations" title="Contacts" detail="Phone, message, and email links stay native-friendly for the future mobile client." actions={<div className="section-heading-actions">
    <form className="inline-create" onSubmit={(event) => void create(event)}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Contact name" required /><button className="button">Add</button></form>
  </div>} />
    {loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}
    {!loading && !error && <>
      <SectionFilter query={query} onChange={setQuery} count={visibleContacts.length} noun="contact" controls={<>
        <SectionSelectFilter label="Group" value={selectedKind} onChange={setSelectedKind}>
          <option value="all">All groups</option><option value="person">People</option><option value="organization">Organizations</option><option value="service">Services</option>
        </SectionSelectFilter>
        <SectionSelectFilter label="Status" value={selectedStatus} onChange={setSelectedStatus}>
          <option value="active">Active</option><option value="all">All records</option><option value="inactive">Inactive</option><option value="blocked">Blocked</option><option value="deceased">Deceased</option>
        </SectionSelectFilter>
        <SectionSelectFilter label="Tag" value={selectedTag} onChange={setSelectedTag} disabled={!contactTags.length}>
          <option value="all">All tags</option>{contactTags.map((tag) => <option value={tag} key={tag}>{tag}</option>)}
        </SectionSelectFilter>
      </>} />
      {!visibleContacts.length ? <Empty>{contactsFiltered ? "No contacts match the filters." : "No contacts yet."}</Empty> : <div className="library-groups">
        {contactGroups.map((group) => <section className="library-group" key={group.id} aria-labelledby={`contact-group-${group.id}`}>
          <header className="library-group-heading">
            <h2 id={`contact-group-${group.id}`}>{group.name}</h2>
            <span>{group.contacts.length} {group.contacts.length === 1 ? "contact" : "contacts"}</span>
          </header>
          <ul className="library-list grouped-contact-list">
          {group.contacts.map((contact) => {
          const name = textKey(contact, "displayName", "name");
          const status = textKey(contact, "status") || "active";
          const methods = (contact.methods as Entity[] | undefined) || [];
          const tags = (contact.tags as string[] | undefined) || [];
          const contactDetails = methods.map((method) => cardAttribute(
            textKey(method, "label") || String(method.kind).replaceAll("_", " "),
            method.value,
          )).filter((attribute): attribute is { label: string; value: string } => Boolean(attribute));
          const links = [
            ...methods.flatMap((method) => {
              const kind = String(method.kind);
              const value = String(method.value || "");
              const href = kind === "phone" ? `tel:${value}` : kind === "email" ? `mailto:${value}` : kind === "url" ? value : null;
              return href ? [{ label: kind === "phone" ? "Call" : kind === "email" ? "Email" : "Open", href }] : [];
            }),
            ...methods.filter((method) => method.kind === "phone").map((method) => ({ label: "Text", href: `sms:${String(method.value || "")}` })),
          ];
          return <ContactCard
            as="li"
            key={String(contact.id)}
            object={objectCardData({
              id: Number(contact.id), type: "contacts.contact", label: "Contact", display: name,
              body: textKey(contact, "organizationName") || null,
              attributes: [...contactDetails, { label: "Status", value: status }],
              badges: [...tags, ...(status !== "active" ? [status] : [])],
              links,
            })}
            onEdit={() => setEditingContactId(Number(contact.id))}
            controls={<ObjectSelectionControls identity={contactIdentity(contact)} subject={`contact ${name}`} />}
          />;
          })}
          </ul>
        </section>)}
      </div>}
    </>}
    {editingContactId != null && <ContactEditor contactId={editingContactId} onClose={() => setEditingContactId(null)} onChanged={reload} />}
  </>;
}

const genericScreens: Record<GenericObjectKind, { eyebrow: string; title: string; detail: string; url: string; key: string }> = {
  content: { eyebrow: "Reference shelf", title: "Library", detail: "Reusable material and published content.", url: "/api/content-items?limit=1000", key: "content" },
  "video-scripts": { eyebrow: "Production", title: "Video Scripts", detail: "Scripts grounded in completed conversations.", url: "/api/video-scripts?status=all&limit=500", key: "scripts" },
  files: { eyebrow: "Durable artifacts", title: "Files", detail: "Uploads, generated documents, and their source evidence.", url: "/api/files?limit=200", key: "files" },
};

function LibraryScreen() {
  const { data, error, loading, reload } = useApi<{ content: Entity[] }>("/api/content-items?limit=1000");
  const { data: groupData, error: groupError, loading: groupsLoading, reload: reloadGroups } = useApi<{ groups: Entity[] }>("/api/content-groups");
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("all");
  const [editingGroup, setEditingGroup] = useState<EditableGroup | null>(null);
  const content = data?.content || [];
  const visibleContent = content.filter((entity) =>
    (selectedGroupId === "all" || String(readKey(entity, "groupId")) === selectedGroupId)
    && matchesSearch(entity, filterQuery),
  );
  const groups = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; editable: boolean; items: Entity[] }>();
    for (const group of groupData?.groups || []) {
      if (selectedGroupId !== "all" && String(group.id) !== selectedGroupId) continue;
      grouped.set(String(group.id), {
        id: String(group.id),
        name: textKey(group, "name") || "Untitled group",
        editable: Number(group.id) !== 1,
        items: [],
      });
    }
    for (const item of visibleContent) {
      const groupId = String(readKey(item, "groupId") ?? `name:${textKey(item, "groupName") || "Library"}`);
      const group = grouped.get(groupId) || {
        id: groupId,
        name: textKey(item, "groupName") || "Library",
        editable: false,
        items: [],
      };
      group.items.push(item);
      grouped.set(groupId, group);
    }
    const allGroups = [...grouped.values()];
    return filterQuery.trim() ? allGroups.filter((group) => group.items.length) : allGroups;
  }, [filterQuery, groupData?.groups, selectedGroupId, visibleContent]);
  const reloadLibrary = () => { void reload(); void reloadGroups(); };
  return <>
    <PageHeading eyebrow="Reference shelf" title="Library" detail="Reusable material and published content." />
    <SectionFilter query={filterQuery} onChange={setFilterQuery} count={visibleContent.length} noun="item" controls={<SectionSelectFilter label="Group" value={selectedGroupId} onChange={setSelectedGroupId} disabled={groupsLoading}>
      <option value="all">All groups</option>{groupData?.groups?.map((group) => <option value={String(group.id)} key={String(group.id)}>{textKey(group, "name")}</option>)}
    </SectionSelectFilter>} />
    {(loading || groupsLoading) && <Loading />}
    {error && <ErrorState error={error} retry={reloadLibrary} />}
    {groupError && <ErrorState error={groupError} retry={reloadLibrary} />}
    {!loading && !groupsLoading && !error && !groupError && !groups.length && <Empty>{filterQuery.trim() ? "No library items match the filter." : "Nothing here yet."}</Empty>}
    {!loading && !groupsLoading && !error && !groupError && Boolean(groups.length) && <div className="library-groups">
      {groups.map((group) => <section className="library-group" key={group.id} aria-label={`${group.name} library group`}>
        {Number.isSafeInteger(Number(group.id)) && Number(group.id) > 0 ? <LibraryGroupCard
          object={{ id: Number(group.id), type: "video.content_group", label: "Library group", display: group.name, attributes: [{ label: "Items", value: String(group.items.length) }] }}
          controls={<ObjectSelectionControls identity={contentGroupIdentity({ id: Number(group.id), name: group.name })} subject={`library group ${group.name}`} />}
          actions={group.editable ? [{ key: "edit", label: "Edit", onClick: () => setEditingGroup({ id: Number(group.id), name: group.name, resource: "content-groups" }) }] : []}
        /> : <header className="library-group-heading"><h2 id={`library-group-${group.id}`}>{group.name}</h2><span>{group.items.length} {group.items.length === 1 ? "item" : "items"}</span></header>}
        {group.items.length ? <ul className="library-list">
          {group.items.map((entity, index) => {
            const entityId = entity.id || index;
            const title = textKey(entity, "title", "name") || `Item ${entityId}`;
            return <LibraryItemCard
              as="li"
              key={entityId}
              object={objectCardData({
                id: Number(entity.id), type: "video.content_item", label: "Library item", display: title,
                body: textKey(entity, "description", "summary", "contentText") || null,
                attributes: [
                  ...(readKey(entity, "sequence") != null ? [{ label: "Sequence", value: `#${String(entity.sequence)}` }] : []),
                  ...(textKey(entity, "groupName") ? [{ label: "Group", value: textKey(entity, "groupName") }] : []),
                ],
                badges: [textKey(entity, "contentType").replaceAll("_", " "), textKey(entity, "contentStatus", "status").replaceAll("_", " ")],
              })}
              controls={<ObjectSelectionControls identity={genericEntityIdentity("content", entity)} subject={`library ${title}`} />}
            />;
          })}
        </ul> : <p className="library-group-empty">No items in this group.</p>}
      </section>)}
    </div>}
    {editingGroup && <GroupEditor group={editingGroup} onClose={() => setEditingGroup(null)} onChanged={async () => { await Promise.all([reload(), reloadGroups()]); }} />}
  </>;
}

function VideoScriptsScreen() {
  const { data, error, loading, reload } = useApi<{ scripts: Entity[] }>("/api/video-scripts?status=all&limit=500");
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const scripts = data?.scripts || [];
  const visibleScripts = scripts.filter((script) =>
    (selectedStatus === "all" || textKey(script, "status") === selectedStatus)
    && matchesSearch(script, filterQuery),
  );
  const groups = useMemo(() => {
    const availableGroups = [
      ["draft", { id: "draft", name: "Drafts", scripts: [] as Entity[] }],
      ["archived", { id: "archived", name: "Archived", scripts: [] as Entity[] }],
    ] as const;
    const grouped = new Map<string, { id: string; name: string; scripts: Entity[] }>(
      availableGroups.filter(([id]) => selectedStatus === "all" || id === selectedStatus),
    );
    for (const script of visibleScripts) {
      const id = textKey(script, "status") || "other";
      const group = grouped.get(id) || { id, name: id.replaceAll("_", " "), scripts: [] };
      group.scripts.push(script);
      grouped.set(id, group);
    }
    const allGroups = [...grouped.values()];
    return filterQuery.trim() ? allGroups.filter((group) => group.scripts.length) : allGroups;
  }, [filterQuery, selectedStatus, visibleScripts]);
  return <>
    <PageHeading eyebrow="Production" title="Video Scripts" detail="Scripts grounded in completed conversations." />
    <SectionFilter query={filterQuery} onChange={setFilterQuery} count={visibleScripts.length} noun="script" controls={<SectionSelectFilter label="Group" value={selectedStatus} onChange={setSelectedStatus}>
      <option value="all">All groups</option><option value="draft">Drafts</option><option value="archived">Archived</option>
    </SectionSelectFilter>} />
    {loading && <Loading />}
    {error && <ErrorState error={error} retry={reload} />}
    {!loading && !error && !groups.length && <Empty>{filterQuery.trim() ? "No video scripts match the filter." : "Nothing here yet."}</Empty>}
    {!loading && !error && Boolean(groups.length) && <div className="library-groups">
      {groups.map((group) => <section className="library-group" key={group.id} aria-labelledby={`video-script-group-${group.id}`}>
        <header className="library-group-heading">
          <h2 id={`video-script-group-${group.id}`}>{group.name}</h2>
          <span>{group.scripts.length} {group.scripts.length === 1 ? "script" : "scripts"}</span>
        </header>
        {group.scripts.length ? <ul className="library-list">
          {group.scripts.map((script, index) => {
            const scriptId = script.id || index;
            const title = textKey(script, "title", "name") || `Script ${scriptId}`;
            const plan = script.plan && typeof script.plan === "object" ? script.plan as Entity : {};
            const render = script.render && typeof script.render === "object" ? script.render as Entity : {};
            const sourceCount = Array.isArray(script.sources) ? script.sources.length : 0;
            return <VideoScriptCard
              as="li"
              key={scriptId}
              object={objectCardData({
                id: Number(script.id), type: "video.script", label: "Video script", display: title,
                body: textKey(plan, "concept") || null,
                attributes: [{ label: "ID", value: `#${String(scriptId)}` }],
                badges: [`${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`, textKey(render, "status").replaceAll("_", " ")],
              })}
              controls={<ObjectSelectionControls identity={genericEntityIdentity("video-scripts", script)} subject={`video script ${title}`} />}
            />;
          })}
        </ul> : <p className="library-group-empty">No scripts in this group.</p>}
      </section>)}
    </div>}
  </>;
}

function FilesScreen() {
  const { data, error, loading, reload } = useApi<{ files: Entity[] }>("/api/files?limit=200");
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedMediaKind, setSelectedMediaKind] = useState("all");
  const files = data?.files || [];
  const fileGroupLabels: Record<string, string> = { document: "Documents", image: "Images", video: "Videos", audio: "Audio" };
  const fileGroupOrder = ["document", "image", "video", "audio"];
  const fileGroupOptions = useMemo(() => [...new Set(files.map((file) => textKey(file, "mediaKind") || "other"))]
    .sort((left, right) => {
      const leftIndex = fileGroupOrder.indexOf(left);
      const rightIndex = fileGroupOrder.indexOf(right);
      return (leftIndex < 0 ? fileGroupOrder.length : leftIndex) - (rightIndex < 0 ? fileGroupOrder.length : rightIndex);
    }), [files]);
  const visibleFiles = files.filter((file) =>
    (selectedMediaKind === "all" || textKey(file, "mediaKind") === selectedMediaKind)
    && matchesSearch(file, filterQuery),
  );
  const groups = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; files: Entity[] }>();
    for (const file of visibleFiles) {
      const id = textKey(file, "mediaKind") || "other";
      const group = grouped.get(id) || { id, name: fileGroupLabels[id] || `${id.replaceAll("_", " ")} files`, files: [] };
      group.files.push(file);
      grouped.set(id, group);
    }
    return [...grouped.values()].sort((left, right) => {
      const leftIndex = fileGroupOrder.indexOf(left.id);
      const rightIndex = fileGroupOrder.indexOf(right.id);
      return (leftIndex < 0 ? fileGroupOrder.length : leftIndex) - (rightIndex < 0 ? fileGroupOrder.length : rightIndex);
    });
  }, [visibleFiles]);
  return <>
    <PageHeading eyebrow="Durable artifacts" title="Files" detail="Uploads, generated documents, and their source evidence." />
    <SectionFilter query={filterQuery} onChange={setFilterQuery} count={visibleFiles.length} noun="file" controls={<SectionSelectFilter label="Group" value={selectedMediaKind} onChange={setSelectedMediaKind} disabled={!fileGroupOptions.length}>
      <option value="all">All groups</option>{fileGroupOptions.map((kind) => <option value={kind} key={kind}>{fileGroupLabels[kind] || `${kind.replaceAll("_", " ")} files`}</option>)}
    </SectionSelectFilter>} />
    {loading && <Loading />}
    {error && <ErrorState error={error} retry={reload} />}
    {!loading && !error && !groups.length && <Empty>{filterQuery.trim() ? "No files match the filter." : "Nothing here yet."}</Empty>}
    {!loading && !error && Boolean(groups.length) && <div className="library-groups">
      {groups.map((group) => <section className="library-group" key={group.id} aria-labelledby={`file-group-${group.id}`}>
        <header className="library-group-heading">
          <h2 id={`file-group-${group.id}`}>{group.name}</h2>
          <span>{group.files.length} {group.files.length === 1 ? "file" : "files"}</span>
        </header>
        <ul className="library-list">
          {group.files.map((file, index) => {
            const fileId = file.fileId || file.id || index;
            const title = textKey(file, "title", "originalFilename") || `File ${fileId}`;
            return <FileCard
              as="li"
              key={fileId}
              object={objectCardData({
                id: Number(fileId), type: "files.file", label: "File", display: title,
                body: textKey(file, "description") || textKey(file, "originalFilename") || null,
                attributes: [{ label: "ID", value: `#${String(fileId)}` }],
                badges: [textKey(file, "mimeType")],
              })}
              controls={<ObjectSelectionControls identity={genericEntityIdentity("files", file)} subject={`file ${title}`} />}
              onDownload={() => void downloadAuthenticated(`/api/files/${fileId}/download`, textKey(file, "originalFilename") || `file-${fileId}`)}
            />;
          })}
        </ul>
      </section>)}
    </div>}
  </>;
}

function GenericScreen({ kind }: { kind: keyof typeof genericScreens }) {
  const config = genericScreens[kind];
  const { data, error, loading, reload } = useApi<Record<string, unknown>>(config.url);
  const [filterQuery, setFilterQuery] = useState("");
  const entities = ((data?.[config.key] as Entity[] | undefined) || []);
  const visibleEntities = entities.filter((entity) => matchesSearch(entity, filterQuery));
  return <><PageHeading eyebrow={config.eyebrow} title={config.title} detail={config.detail} /><SectionFilter query={filterQuery} onChange={setFilterQuery} count={visibleEntities.length} noun="item" />{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}{!loading && !visibleEntities.length && <Empty>{filterQuery.trim() ? `No ${config.title.toLowerCase()} items match the filter.` : "Nothing here yet."}</Empty>}<div className="card-grid">{visibleEntities.map((entity, index) => {
    const entityId = entity.id || entity.fileId;
    const title = textKey(entity, "title", "name", "originalFilename") || `Item ${entityId || index + 1}`;
    const type = kind === "content" ? "video.content_item" : kind === "video-scripts" ? "video.script" : "files.file";
    return <ObjectCard
      key={entityId || index}
      object={objectCardData({
        id: Number(entityId), type, label: kind === "content" ? "Library item" : kind === "video-scripts" ? "Video script" : "File",
        display: title, body: textKey(entity, "description", "summary", "contentText") || null,
        attributes: readKey(entity, "sequence") != null ? [{ label: "Sequence", value: `#${String(entity.sequence)}` }] : [],
        badges: [textKey(entity, "status", "contentStatus", "mediaKind") || config.title],
      })}
      controls={<ObjectSelectionControls identity={genericEntityIdentity(kind, entity)} subject={`${config.title.toLowerCase()} ${title}`} />}
      actions={kind === "files" && entityId ? [{ key: "download", label: "Download", onClick: () => void downloadAuthenticated(`/api/files/${entityId}/download`, textKey(entity, "originalFilename") || `file-${entityId}`) }] : []}
    />;
  })}</div></>;
}

function HatsScreen() {
  const { data, error, loading, reload } = useApi<Record<string, unknown>>("/api/hats");
  const [filterQuery, setFilterQuery] = useState("");
  const hats = ((data?.hats as Entity[] | undefined) || (data?.catalog as Entity[] | undefined) || []);
  const visibleHats = hats.filter((hat) => matchesSearch(hat, filterQuery));
  return <><PageHeading eyebrow="Ways of working" title="Hats" detail={String(data?.introduction || "Name a hat when you want a particular working stance.")} /><SectionFilter query={filterQuery} onChange={setFilterQuery} count={visibleHats.length} noun="hat" />{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}{!loading && !visibleHats.length && <Empty>{filterQuery.trim() ? "No hats match the filter." : "No hats are available."}</Empty>}<div className="hat-grid">{visibleHats.map((hat, index) => <article className="hat-card" key={hat.id || index}><img className="hat-shape" src="/logo-outline-hat.svg" alt="" aria-hidden="true" /><h2>{textKey(hat, "title", "label", "name")}</h2><p>{textKey(hat, "description", "summary")}</p></article>)}</div></>;
}

function JournalScreen() {
  const { data: trackers, error, loading, reload } = useApi<{ trackers: Entity[] }>("/api/journal-trackers?limit=200");
  const { data: entries, error: entryError, loading: entriesLoading, reload: reloadEntries } = useApi<{ entries: Entity[] }>("/api/journal-entries?limit=100");
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("all");
  const [editingGroup, setEditingGroup] = useState<EditableGroup | null>(null);
  const journalTrackers = trackers?.trackers || [];
  const journalEntries = entries?.entries || [];
  const journalGroupOptions = useMemo(() => {
    const groups = new Map<string, string>();
    for (const item of [...journalTrackers, ...journalEntries]) {
      const id = String(readKey(item, "groupId") ?? `name:${textKey(item, "groupName") || "Journal"}`);
      if (!groups.has(id)) groups.set(id, textKey(item, "groupName") || "Journal");
    }
    return [...groups].map(([id, name]) => ({ id, name }));
  }, [journalEntries, journalTrackers]);
  const visibleTrackers = journalTrackers.filter((tracker) =>
    (selectedGroupId === "all" || String(readKey(tracker, "groupId") ?? `name:${textKey(tracker, "groupName") || "Journal"}`) === selectedGroupId)
    && matchesSearch(tracker, filterQuery),
  );
  const visibleEntries = journalEntries.filter((entry) =>
    (selectedGroupId === "all" || String(readKey(entry, "groupId") ?? `name:${textKey(entry, "groupName") || "Journal"}`) === selectedGroupId)
    && matchesSearch(entry, filterQuery),
  );
  const visibleCount = visibleTrackers.length + visibleEntries.length;
  const groups = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; groupId: number | null; trackers: Entity[]; entries: Entity[] }>();
    for (const tracker of visibleTrackers) {
      const id = String(readKey(tracker, "groupId") ?? `name:${textKey(tracker, "groupName") || "Journal"}`);
      const rawGroupId = readKey(tracker, "groupId");
      const group = grouped.get(id) || { id, name: textKey(tracker, "groupName") || "Journal", groupId: rawGroupId == null ? null : Number(rawGroupId), trackers: [], entries: [] };
      group.trackers.push(tracker);
      grouped.set(id, group);
    }
    for (const entry of visibleEntries) {
      const id = String(readKey(entry, "groupId") ?? `name:${textKey(entry, "groupName") || "Journal"}`);
      const rawGroupId = readKey(entry, "groupId");
      const group = grouped.get(id) || { id, name: textKey(entry, "groupName") || "Journal", groupId: rawGroupId == null ? null : Number(rawGroupId), trackers: [], entries: [] };
      group.entries.push(entry);
      grouped.set(id, group);
    }
    return [...grouped.values()];
  }, [visibleEntries, visibleTrackers]);
  const reloadJournal = () => { void reload(); void reloadEntries(); };
  return <>
    <PageHeading eyebrow="A record of lived time" title="Journal" detail="Trackers and recent entries, kept alongside the calendar without pretending they are appointments." />
    <SectionFilter query={filterQuery} onChange={setFilterQuery} count={visibleCount} noun="result" controls={<SectionSelectFilter label="Group" value={selectedGroupId} onChange={setSelectedGroupId} disabled={!journalGroupOptions.length}>
      <option value="all">All groups</option>{journalGroupOptions.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
    </SectionSelectFilter>} />
    {(loading || entriesLoading) && <Loading />}
    {error && <ErrorState error={error} retry={reloadJournal} />}
    {entryError && <ErrorState error={entryError} retry={reloadJournal} />}
    {!loading && !entriesLoading && !error && !entryError && !visibleCount && <Empty>{filterQuery.trim() ? "No journal items match the filter." : "No journal items yet."}</Empty>}
    {!loading && !entriesLoading && !error && !entryError && Boolean(groups.length) && <div className="library-groups">
      {groups.map((group) => {
        const count = group.trackers.length + group.entries.length;
        return <section className="library-group" key={group.id} aria-label={`${group.name} journal group`}>
          {group.groupId != null ? <JournalGroupCard
            object={{ id: group.groupId, type: "journal.group", label: "Journal group", display: group.name, attributes: [{ label: "Items", value: String(count) }] }}
            controls={<ObjectSelectionControls identity={journalGroupIdentity({ id: group.groupId, name: group.name })} subject={`journal group ${group.name}`} />}
            actions={group.name.toLowerCase() !== "general" ? [{ key: "edit", label: "Edit", onClick: () => setEditingGroup({ id: group.groupId!, name: group.name, resource: "journal-groups" }) }] : []}
          /> : <header className="library-group-heading"><h2>{group.name}</h2><span>{count} {count === 1 ? "item" : "items"}</span></header>}
          <ul className="library-list">
            {group.trackers.map((tracker) => {
              const name = textKey(tracker, "name", "title");
              return <JournalTrackerCard
                as="li"
                key={`tracker-${tracker.id}`}
                object={objectCardData({
                  id: Number(tracker.id), type: "journal.tracker", label: "Journal tracker", display: name,
                  attributes: [
                    ...(textKey(tracker, "unit") ? [{ label: "Unit", value: textKey(tracker, "unit") }] : []),
                    { label: "Entries", value: String(Number(readKey(tracker, "entryCount") || 0)) },
                    { label: "Group", value: group.name },
                  ],
                })}
                controls={<ObjectSelectionControls identity={journalTrackerIdentity(tracker)} subject={`journal tracker ${name}`} />}
                details={<TrackerSchedule tracker={tracker} onChanged={reloadJournal} />}
              />;
            })}
            {group.entries.map((entry, index) => <JournalEntryCard
              as="li"
              mode="compact"
              key={`entry-${entry.id || index}`}
              object={objectCardData({
                id: Number(entry.id), type: "journal.entry", label: "Journal entry",
                display: textKey(entry, "trackerName", "title") || "Journal entry",
                body: textKey(entry, "contentText", "text", "numberValue") || null,
                attributes: [{ label: "Occurred", value: formatDisplayDate(textKey(entry, "occurredAtUtc", "createdAtUtc")) }],
              })}
              controls={<ObjectSelectionControls identity={journalEntryIdentity(entry)} subject={`journal entry ${entry.id}`} />}
            />)}
          </ul>
        </section>;
      })}
    </div>}
    {editingGroup && <GroupEditor group={editingGroup} onClose={() => setEditingGroup(null)} onChanged={async () => { await Promise.all([reload(), reloadEntries()]); }} />}
  </>;
}

function UsageScreen() {
  const { data, error, loading, reload } = useApi<{ entries: Entity[]; current: Entity }>("/api/ai-usage?limit=10000");
  const [filterQuery, setFilterQuery] = useState("");
  const visibleEntries = (data?.entries || []).filter((entry) => matchesSearch(entry, filterQuery));
  const totals = useMemo(() => visibleEntries.reduce<{ calls: number; input: number; output: number }>(
    (result, entry) => ({ calls: result.calls + 1, input: result.input + Number(readKey(entry, "inputTokens", "input_tokens") || 0), output: result.output + Number(readKey(entry, "outputTokens", "output_tokens") || 0) }), { calls: 0, input: 0, output: 0 },
  ), [visibleEntries]);
  return <><PageHeading eyebrow="Metered model work" title="AI Usage" detail={`${textKey(data?.current || {}, "transport")} · ${textKey(data?.current || {}, "model")}`} /><SectionFilter query={filterQuery} onChange={setFilterQuery} count={visibleEntries.length} noun="call" />{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}<div className="metric-grid"><article><span>Calls</span><strong>{totals.calls.toLocaleString()}</strong></article><article><span>Input tokens</span><strong>{totals.input.toLocaleString()}</strong></article><article><span>Output tokens</span><strong>{totals.output.toLocaleString()}</strong></article></div></>;
}

interface StripeConnectionStatus {
  configured: boolean;
  connected: boolean;
  accountId: string | null;
  status: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted?: boolean;
  currentlyDue?: string[];
  disabledReason?: string | null;
  reason?: string | null;
}

type InvoiceLineDraft = {
  position: number;
  lineSource: string;
  personalTaskId: number | null;
  description: string;
  amount: string;
  receiptFileId: string;
  isNew: boolean;
};

type InvoiceCreateManualLine = {
  key: number;
  description: string;
  amount: string;
};

type InvoiceCreateTodoLine = {
  personalTaskId: number;
  description: string;
  amount: string;
};

function invoiceCurrencyDigits(currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency })
      .resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    throw new Error("Invoice currency is not a valid three-letter currency code.");
  }
}

function invoiceAmountDraft(amountMinor: unknown, currency: string) {
  const digits = invoiceCurrencyDigits(currency);
  const divisor = 10 ** digits;
  const amount = Number(amountMinor);
  return Number.isSafeInteger(amount) && amount >= 0 ? (amount / divisor).toFixed(digits) : "";
}

function invoiceAmountMinor(amount: string, currency: string) {
  const digits = invoiceCurrencyDigits(currency);
  const pattern = digits > 0
    ? new RegExp(`^(?:0|[1-9]\\d*)(?:\\.(\\d{1,${digits}}))?$`)
    : /^(?:0|[1-9]\d*)$/;
  const match = pattern.exec(amount.trim());
  if (!match) throw new Error(`Every line amount must be zero or greater with at most ${digits} decimal places.`);
  const whole = Number(amount.trim().split(".")[0] ?? "0");
  const fraction = digits > 0 ? (match[1] || "").padEnd(digits, "0") : "";
  const minor = whole * (10 ** digits) + Number(fraction || 0);
  if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("Every line amount must be zero or greater.");
  return minor;
}

function invoiceDraftAmountMinor(amount: string, currency: string) {
  return amount.trim() ? invoiceAmountMinor(amount, currency) : 0;
}

function formatInvoiceMoney(amountMinor: number, currency: string) {
  const divisor = 10 ** invoiceCurrencyDigits(currency);
  return new Intl.NumberFormat(undefined, { style: "currency", currency })
    .format(amountMinor / divisor);
}

function invoicePaymentMethodLabel(policy: string) {
  if (policy === "card_only") return "Credit card only";
  if (policy === "card_and_ach") return "Credit card and bank account";
  return "Bank account only (no credit cards)";
}

function invoicePaymentStatusLabel(invoice: Entity) {
  return textKey(invoice, "paymentStatus") === "paid" || textKey(invoice, "status") === "paid"
    ? "Paid" : "Unpaid";
}

function invoiceContactEmail(contact: Entity) {
  const methods = Array.isArray(contact.methods)
    ? contact.methods.filter((method): method is Entity => Boolean(method && typeof method === "object" && !Array.isArray(method)))
    : [];
  return textKey(methods.find((method) => textKey(method, "kind") === "email" && Boolean(method.canReceive)) || {}, "value");
}

function CreateInvoiceEditor({ contacts, todos, unavailableTodoIds, loading, loadError, onClose, onCreated }: {
  contacts: Entity[];
  todos: Entity[];
  unavailableTodoIds: Set<number>;
  loading: boolean;
  loadError: unknown;
  onClose: () => void;
  onCreated: (invoice: Entity) => void | Promise<void>;
}) {
  const today = localToday();
  const [contactId, setContactId] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [paymentMethodPolicy, setPaymentMethodPolicy] = useState("ach_only");
  const [description, setDescription] = useState("");
  const [todoQuery, setTodoQuery] = useState("");
  const [todoLines, setTodoLines] = useState<InvoiceCreateTodoLine[]>([]);
  const [manualLines, setManualLines] = useState<InvoiceCreateManualLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedContact = contacts.find((contact) => String(contact.id) === contactId) ?? null;
  const contactMatches = contactQuery.trim() && !selectedContact
    ? contacts.filter((contact) => matchesSearch(contact, contactQuery)).slice(0, 20)
    : [];
  const normalizedCurrency = currency.trim().toUpperCase();
  const selectedTodoIds = new Set(todoLines.map((line) => line.personalTaskId));
  const todoMatches = todoQuery.trim()
    ? todos.filter((todo) => matchesSearch(todo, todoQuery)).slice(0, 30)
    : [];
  const startedManualLines = manualLines.filter((line) => line.description.trim() || line.amount.trim());
  const hasLineSource = todoLines.length > 0 || startedManualLines.length > 0;
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);
  const selectContact = (contact: Entity) => {
    setError("");
    setContactId(String(contact.id));
    setContactQuery(`${textKey(contact, "displayName")} — ${invoiceContactEmail(contact)}`);
  };
  const addTodoLine = (todo: Entity) => {
    const todoId = Number(todo.id);
    if (!Number.isSafeInteger(todoId) || todoId <= 0 || selectedTodoIds.has(todoId) || unavailableTodoIds.has(todoId)) return;
    const savedAmount = Number(readKey(todo, "billableAmountMinor"));
    const savedCurrency = textKey(todo, "billableCurrency").toUpperCase();
    setError("");
    setTodoLines((current) => [...current, {
      personalTaskId: todoId,
      description: textKey(todo, "text"),
      amount: savedAmount > 0 && savedCurrency === normalizedCurrency
        ? invoiceAmountDraft(savedAmount, normalizedCurrency)
        : "",
    }]);
    setTodoQuery("");
  };
  const addManualLine = () => setManualLines((current) => [...current, {
    key: current.reduce((maximum, line) => Math.max(maximum, line.key), 0) + 1,
    description: "",
    amount: "",
  }]);
  const updateManualLine = (key: number, changes: Partial<InvoiceCreateManualLine>) => {
    setManualLines((current) => current.map((line) => line.key === key ? { ...line, ...changes } : line));
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      setError("Currency must be a three-letter code such as USD.");
      return;
    }
    if (!hasLineSource) {
      setError("Add a to-do or a manual line.");
      return;
    }
    if (todoLines.length + startedManualLines.length > 100) {
      setError("An invoice can contain at most 100 lines.");
      return;
    }
    let preparedTodoLines;
    let preparedManualLines;
    try {
      preparedTodoLines = todoLines.map((line) => ({
        personal_task_id: line.personalTaskId,
        amount_minor: invoiceDraftAmountMinor(line.amount, normalizedCurrency),
        currency: normalizedCurrency,
      }));
      preparedManualLines = startedManualLines.map((line, index) => {
        if (!line.description.trim()) {
          throw new Error(`Manual line ${index + 1} needs a description.`);
        }
        return {
          description: line.description.trim(),
          amount_minor: invoiceDraftAmountMinor(line.amount, normalizedCurrency),
          currency: normalizedCurrency,
        };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Check the manual invoice lines.");
      return;
    }
    setSaving(true);
    try {
      const result = await api<{ invoice: Entity }>("/api/payment-invoices/prepare", {
        method: "POST",
        body: JSON.stringify({
          ...(contactId ? { contact_id: Number(contactId) } : {}),
          ...(dueOn ? { due_on: dueOn } : {}),
          currency: normalizedCurrency,
          payment_method_policy: paymentMethodPolicy,
          description: description.trim() || null,
          ...(preparedTodoLines.length ? { todo_lines: preparedTodoLines } : {}),
          ...(preparedManualLines.length ? { manual_lines: preparedManualLines } : {}),
        }),
      });
      await onCreated(result.invoice);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not prepare the invoice.");
    } finally {
      setSaving(false);
    }
  };
  return <div className="object-editor-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
    <section className="object-editor invoice-editor invoice-create-editor" role="dialog" aria-modal="true" aria-labelledby="invoice-create-title">
      <form onSubmit={(event) => void create(event)}>
        <header className="object-editor-heading"><div><p className="eyebrow">Payments</p><h2 id="invoice-create-title">Create invoice</h2></div><button className="button button--quiet" type="button" disabled={saving} onClick={onClose}>Close</button></header>
        <div className="invoice-create-grid">
          <div className="invoice-create-picker"><label htmlFor="invoice-payer-search">Payer <span className="field-hint">Optional</span></label><input id="invoice-payer-search" type="search" role="combobox" aria-expanded={Boolean(contactMatches.length)} aria-controls="invoice-payer-results" autoComplete="off" value={contactQuery} disabled={saving || loading} onChange={(event) => { setContactQuery(event.target.value); setContactId(""); setError(""); }} placeholder="Type a name or email" />
            {selectedContact && <div className="invoice-create-selection"><span><strong>{textKey(selectedContact, "displayName")}</strong><small>{invoiceContactEmail(selectedContact) || "No receivable email yet"}</small></span><button type="button" disabled={saving} onClick={() => { setContactId(""); setContactQuery(""); }}>Change</button></div>}
            {!selectedContact && contactQuery.trim() && <div className="invoice-create-results" id="invoice-payer-results" role="listbox">{contactMatches.map((contact) => <button type="button" role="option" aria-selected="false" key={String(contact.id)} onClick={() => selectContact(contact)}><strong>{textKey(contact, "displayName")}</strong><small>{invoiceContactEmail(contact) || "No receivable email yet"}</small></button>)}{!contactMatches.length && <p>No contacts match.</p>}</div>}
          </div>
          <label>Due date <span className="field-hint">Optional</span><input type="date" min={today} value={dueOn} disabled={saving} onChange={(event) => setDueOn(event.target.value)} /></label>
          <label>Currency<input value={currency} maxLength={3} required disabled={saving} onChange={(event) => { setCurrency(event.target.value.toUpperCase()); setTodoLines((current) => current.map((line) => ({ ...line, amount: "" }))); }} /></label>
          <label>Payment methods<select value={paymentMethodPolicy} disabled={saving} onChange={(event) => setPaymentMethodPolicy(event.target.value)}><option value="ach_only">Bank account only (no credit cards)</option><option value="card_and_ach">Credit card and bank account</option><option value="card_only">Credit card only</option></select></label>
        </div>
        <label>Invoice description <span className="field-hint">Optional</span><input value={description} maxLength={1000} disabled={saving} onChange={(event) => setDescription(event.target.value)} placeholder="What this invoice covers" /></label>
        <section className="invoice-create-source">
          <header><div><p className="eyebrow">Work</p><h3>Add to-dos</h3></div><span>{todoLines.length} added</span></header>
          <input type="search" role="combobox" aria-expanded={Boolean(todoMatches.length)} aria-controls="invoice-todo-results" autoComplete="off" value={todoQuery} disabled={saving} onChange={(event) => setTodoQuery(event.target.value)} placeholder="Type to search all to-dos" />
          <div className="invoice-create-todos">
            {todoQuery.trim() && todoMatches.map((todo) => {
              const todoId = Number(todo.id);
              const unavailable = unavailableTodoIds.has(todoId);
              const selected = selectedTodoIds.has(todoId);
              const savedAmount = Number(readKey(todo, "billableAmountMinor"));
              const savedCurrency = textKey(todo, "billableCurrency").toUpperCase();
              return <button className={unavailable ? "is-unavailable" : ""} type="button" role="option" aria-selected={selected} key={todoId} disabled={saving || unavailable || selected} onClick={() => addTodoLine(todo)}><span><strong>{textKey(todo, "text")}</strong><small>{textKey(todo, "groupName")} · {textKey(todo, "status")}{unavailable ? " · Already invoiced" : selected ? " · Added" : ""}</small></span><b>{savedAmount > 0 && savedCurrency ? `Saved price ${formatInvoiceMoney(savedAmount, savedCurrency)}` : "No saved price"}</b></button>;
            })}
            {!todoQuery.trim() && <p>Start typing to find a to-do by its text, group, status, or other details.</p>}
            {todoQuery.trim() && !todoMatches.length && <p>No to-dos match that search.</p>}
          </div>
          {todoLines.length > 0 && <div className="invoice-create-selected-todos">{todoLines.map((line) => <div key={line.personalTaskId}><span><strong>{line.description}</strong><small>To-do #{line.personalTaskId}</small></span><label>Invoice price ({normalizedCurrency}) <span className="field-hint">Optional</span><input value={line.amount} inputMode="decimal" disabled={saving} onChange={(event) => setTodoLines((current) => current.map((candidate) => candidate.personalTaskId === line.personalTaskId ? { ...candidate, amount: event.target.value } : candidate))} placeholder="Leave blank" /></label><button type="button" disabled={saving} onClick={() => setTodoLines((current) => current.filter((candidate) => candidate.personalTaskId !== line.personalTaskId))}>Remove</button></div>)}</div>}
        </section>
        <section className="invoice-create-source">
          <header><div><p className="eyebrow">Additional charges</p><h3>Manual lines</h3></div><button className="button button--quiet" type="button" disabled={saving || todoLines.length + manualLines.length >= 100} onClick={addManualLine}>Add manual line</button></header>
          <div className="invoice-create-manual-lines">{manualLines.map((line, index) => <div key={line.key}><label>Description<input value={line.description} maxLength={1000} disabled={saving} onChange={(event) => updateManualLine(line.key, { description: event.target.value })} placeholder={`Manual line ${index + 1}`} /></label><label>Amount ({normalizedCurrency})<input value={line.amount} inputMode="decimal" disabled={saving} onChange={(event) => updateManualLine(line.key, { amount: event.target.value })} placeholder="0.00" /></label><button type="button" disabled={saving} onClick={() => setManualLines((current) => current.filter((candidate) => candidate.key !== line.key))}>Remove</button></div>)}</div>
          {!manualLines.length && <p className="invoice-create-empty">No manual lines added.</p>}
        </section>
        {loading && <p className="object-editor-state">Loading contacts and to-dos…</p>}
        <p className="object-editor-note">You only need one line to start. Payer, due date, and prices can be filled in later.</p>
      {Boolean(loadError) && <p className="form-error" role="alert">{loadError instanceof Error ? loadError.message : "Could not load invoice sources."}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="object-editor-actions"><button className="button button--quiet" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="button" type="submit" disabled={saving || loading || !hasLineSource}>{saving ? "Creating…" : "Create draft"}</button></footer>
      </form>
    </section>
  </div>;
}

function InvoiceEditor({ invoice, contacts, files, onClose, onChanged }: {
  invoice: Entity;
  contacts: Entity[];
  files: Entity[];
  onClose: () => void;
  onChanged: (invoice: Entity) => void | Promise<void>;
}) {
  const currency = textKey(invoice, "currency").toUpperCase();
  const invoiceId = Number(readKey(invoice, "invoiceId"));
  const sourceLines = Array.isArray(invoice.lines)
    ? invoice.lines.filter((line): line is Entity => Boolean(line && typeof line === "object" && !Array.isArray(line)))
    : [];
  const [lines, setLines] = useState<InvoiceLineDraft[]>(() => sourceLines.map((line, index) => ({
    position: Number(readKey(line, "position")) || index + 1,
    lineSource: textKey(line, "lineSource"),
    personalTaskId: readKey(line, "personalTaskId") == null ? null : Number(readKey(line, "personalTaskId")),
    description: textKey(line, "description"),
    amount: invoiceAmountDraft(readKey(line, "amountMinor"), currency),
    receiptFileId: line.receipt && typeof line.receipt === "object" && !Array.isArray(line.receipt)
      ? String(readKey(line.receipt as Entity, "fileId")) : "",
    isNew: false,
  })));
  const receiptFiles = files.filter((file) => ["application/pdf", "image/jpeg", "image/png"]
    .includes(textKey(file, "mimeType").toLowerCase()));
  const [paymentMethodPolicy, setPaymentMethodPolicy] = useState(textKey(invoice, "paymentMethodPolicy") || "ach_only");
  const [contactId, setContactId] = useState(readKey(invoice, "payerContactId") == null ? "" : String(readKey(invoice, "payerContactId")));
  const [dueOn, setDueOn] = useState(textKey(invoice, "dueOn"));
  const [description, setDescription] = useState(textKey(invoice, "description"));
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [openingPdf, setOpeningPdf] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [receiptPickerPosition, setReceiptPickerPosition] = useState<number | null>(null);
  const [error, setError] = useState("");
  const status = textKey(invoice, "status");
  const expired = Date.parse(textKey(invoice, "preparationExpiresAtUtc")) <= Date.now();
  const editable = status === "prepared" && !invoice.stripeInvoiceId;
  const originalContactId = readKey(invoice, "payerContactId") == null ? "" : String(readKey(invoice, "payerContactId"));
  const selectedContact = contacts.find((contact) => String(contact.id) === contactId) ?? null;
  const payerEmail = contactId === originalContactId
    ? textKey(invoice, "payerEmail")
    : selectedContact ? invoiceContactEmail(selectedContact) : "";
  const busy = saving || sending || openingPdf || downloadingPdf;
  const editingLocked = busy || confirmingSend;
  const draftTotal = useMemo(() => {
    try { return lines.reduce((sum, line) => sum + invoiceDraftAmountMinor(line.amount, currency), 0); }
    catch { return null; }
  }, [currency, lines]);
  const sendReady = Boolean(contactId && payerEmail && dueOn && draftTotal != null && draftTotal > 0);
  const sendable = ["prepared", "failed", "sending"].includes(status)
    && sendReady && (!expired || Boolean(invoice.stripeInvoiceId));
  const hasChanges = contactId !== originalContactId
    || dueOn !== textKey(invoice, "dueOn")
    || paymentMethodPolicy !== textKey(invoice, "paymentMethodPolicy")
    || description.trim() !== textKey(invoice, "description").trim()
    || lines.some((line) => {
    const source = sourceLines.find((candidate) => Number(readKey(candidate, "position")) === line.position);
    if (!source || textKey(source, "description") !== line.description.trim()) return true;
    const sourceReceiptFileId = source.receipt && typeof source.receipt === "object" && !Array.isArray(source.receipt)
      ? String(readKey(source.receipt as Entity, "fileId")) : "";
    if (sourceReceiptFileId !== line.receiptFileId) return true;
    try { return Number(readKey(source, "amountMinor")) !== invoiceDraftAmountMinor(line.amount, currency); }
    catch { return true; }
  });
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);
  const updateLine = (index: number, changes: Partial<InvoiceLineDraft>) => {
    setLines((current) => current.map((line, lineIndex) => (
      lineIndex === index ? { ...line, ...changes } : line
    )));
  };
  const addLine = () => {
    setError("");
    setLines((current) => {
      if (current.length >= 100) return current;
      const nextPosition = current.reduce((maximum, line) => Math.max(maximum, line.position), 0) + 1;
      return [...current, {
        position: nextPosition,
        lineSource: "manual",
        personalTaskId: null,
        description: "",
        amount: "",
        receiptFileId: "",
        isNew: true,
      }];
    });
  };
  const removeNewLine = (position: number) => {
    setError("");
    setReceiptPickerPosition((current) => current === position ? null : current);
    setLines((current) => {
      const persisted = current.filter((line) => !line.isNew);
      const maximumPersistedPosition = persisted.reduce(
        (maximum, line) => Math.max(maximum, line.position),
        0,
      );
      return [
        ...persisted,
        ...current.filter((line) => line.isNew && line.position !== position)
          .map((line, index) => ({ ...line, position: maximumPersistedPosition + index + 1 })),
      ];
    });
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editable || editingLocked) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<{ invoice: Entity }>(`/api/payment-invoices/${invoiceId}`, {
        method: "PATCH",
        body: JSON.stringify({
          previewDigest: textKey(invoice, "previewDigest"),
          contactId: contactId ? Number(contactId) : null,
          dueOn: dueOn || null,
          paymentMethodPolicy,
          description: description.trim() || null,
          lines: lines.map((line) => ({
            position: line.position,
            description: line.description.trim(),
            amountMinor: invoiceDraftAmountMinor(line.amount, currency),
          })),
          receiptUpdates: lines.map((line) => ({
            position: line.position,
            fileId: line.receiptFileId ? Number(line.receiptFileId) : null,
          })),
        }),
      });
      await onChanged(result.invoice);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update the invoice preview.");
    } finally {
      setSaving(false);
    }
  };
  const send = async () => {
    if (!sendable || hasChanges || busy) return;
    setSending(true);
    setError("");
    try {
      const result = await api<{ invoice: Entity }>(`/api/payment-invoices/${invoiceId}/send`, {
        method: "POST",
        body: JSON.stringify({ previewDigest: textKey(invoice, "previewDigest") }),
      });
      setConfirmingSend(false);
      await onChanged(result.invoice);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the invoice.");
    } finally {
      setSending(false);
    }
  };
  const openStripePdf = async () => {
    if (!invoice.stripeInvoiceId || busy) return;
    const pdfWindow = window.open("about:blank", "_blank");
    if (!pdfWindow) {
      setError("Allow pop-ups for this site to open the invoice PDF.");
      return;
    }
    pdfWindow.opener = null;
    setOpeningPdf(true);
    setError("");
    try {
      const result = await api<{ url: string }>(`/api/payment-invoices/${invoiceId}/pdf`);
      pdfWindow.location.replace(result.url);
    } catch (caught) {
      pdfWindow.close();
      setError(caught instanceof Error ? caught.message : "Could not open the invoice PDF.");
    } finally {
      setOpeningPdf(false);
    }
  };
  const previewPdf = async () => {
    if (busy || hasChanges) return;
    setOpeningPdf(true);
    setError("");
    try {
      await previewAuthenticated(`/api/payment-invoices/${invoiceId}/preview-pdf`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not preview the invoice PDF.");
    } finally {
      setOpeningPdf(false);
    }
  };
  const downloadPdf = async () => {
    if (busy || hasChanges) return;
    setDownloadingPdf(true);
    setError("");
    try {
      await downloadAuthenticated(`/api/payment-invoices/${invoiceId}/preview-pdf?download=true`, `invoice-${invoiceId}.pdf`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not download the invoice PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  };
  const sendLabel = status === "failed" ? "Retry sending" : status === "sending" ? "Resume sending" : "Send invoice";
  return <div className="object-editor-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <section className="object-editor invoice-editor" role="dialog" aria-modal="true" aria-labelledby="invoice-editor-title">
      <form onSubmit={(event) => void save(event)}>
        <header className="object-editor-heading"><div><p className="eyebrow">Invoice #{invoiceId}</p><h2 id="invoice-editor-title">{textKey(invoice, "payerName") || "Invoice draft"}</h2></div><button className="button button--quiet" type="button" disabled={busy} onClick={onClose}>Close</button></header>
        <div className="invoice-create-grid">
          <label>Payer <span className="field-hint">Optional until sending</span><select value={contactId} disabled={!editable || editingLocked} onChange={(event) => setContactId(event.target.value)}><option value="">No payer selected</option>{contacts.map((contact) => <option value={String(contact.id)} key={String(contact.id)}>{textKey(contact, "displayName")}{invoiceContactEmail(contact) ? ` — ${invoiceContactEmail(contact)}` : " — no receivable email"}</option>)}</select></label>
          <label>Due date <span className="field-hint">Optional until sending</span><input type="date" min={localToday()} value={dueOn} disabled={!editable || editingLocked} onChange={(event) => setDueOn(event.target.value)} /></label>
        </div>
        <div className="invoice-editor-summary">
          <div><span>Email</span><strong>{payerEmail || "Not set"}</strong></div>
          <div><span>Due</span><strong>{dueOn ? formatLocalDate(dueOn) : "Not set"}</strong></div>
          <div><span>Payment status</span><strong>{invoicePaymentStatusLabel(invoice)}</strong></div>
          <div><span>Total</span><strong>{draftTotal == null ? "Invalid total" : formatInvoiceMoney(draftTotal, currency)}</strong></div>
        </div>
        <label className="invoice-editor-description"><span>Invoice description <small>Optional</small></span><textarea value={description} maxLength={1000} readOnly={!editable || editingLocked} onChange={(event) => setDescription(event.target.value)} placeholder="What this invoice covers" /></label>
        <label className="invoice-payment-methods"><span>Payment methods</span><select value={paymentMethodPolicy} disabled={!editable || editingLocked} onChange={(event) => setPaymentMethodPolicy(event.target.value)}>
          <option value="ach_only">Bank account only (no credit cards)</option>
          <option value="card_and_ach">Credit card and bank account</option>
          <option value="card_only">Credit card only</option>
        </select><span>{editable ? "Choose which payment methods Stripe will offer on this invoice." : invoicePaymentMethodLabel(paymentMethodPolicy)}</span></label>
        <div className="invoice-line-list">
          {lines.map((line, index) => {
            const receiptFile = receiptFiles.find((file) => String(readKey(file, "fileId")) === line.receiptFileId);
            const sourceLine = sourceLines.find((candidate) => Number(readKey(candidate, "position")) === line.position);
            const sourceReceipt = sourceLine?.receipt && typeof sourceLine.receipt === "object" && !Array.isArray(sourceLine.receipt)
              ? sourceLine.receipt as Entity : null;
            const receiptName = receiptFile
              ? textKey(receiptFile, "title") || textKey(receiptFile, "originalFilename")
              : sourceReceipt ? textKey(sourceReceipt, "displayName") : "";
            const choosingReceipt = editable && receiptPickerPosition === line.position;
            return <article className="invoice-line-editor" key={line.position}>
              <div className="invoice-line-heading"><span>Line {line.position}</span><div className="invoice-line-heading-actions"><strong>{line.isNew ? "New manual line" : line.lineSource === "todo" && line.personalTaskId != null ? `To-do #${line.personalTaskId}` : "Manual line"}</strong>{editable && !line.receiptFileId && !choosingReceipt && <button className="invoice-line-receipt-add" type="button" disabled={editingLocked || !receiptFiles.length} onClick={() => setReceiptPickerPosition(line.position)}>+ Receipt</button>}{line.isNew && <button type="button" disabled={editingLocked} onClick={() => removeNewLine(line.position)}>Remove</button>}</div></div>
              <label className="invoice-line-description">Description<textarea value={line.description} maxLength={1000} required readOnly={!editable || editingLocked} onChange={(event) => updateLine(index, { description: event.target.value })} /></label>
              <label className="invoice-line-amount">Amount ({currency}) <span className="field-hint">Use 0.00 for no charge</span><input type="text" inputMode="decimal" value={line.amount} readOnly={!editable || editingLocked} onChange={(event) => updateLine(index, { amount: event.target.value })} placeholder="0.00" /></label>
              {(choosingReceipt || line.receiptFileId) && <div className="invoice-line-receipt">
                {choosingReceipt
                  ? <div className="invoice-line-receipt-picker">
                    <select autoFocus defaultValue="" aria-label={`Choose receipt for line ${line.position}`} disabled={editingLocked} onChange={(event) => {
                      updateLine(index, { receiptFileId: event.target.value });
                      setReceiptPickerPosition(null);
                    }}>
                      <option value="" disabled>Choose a receipt…</option>
                      {receiptFiles.map((file) => <option key={String(readKey(file, "fileId"))} value={String(readKey(file, "fileId"))}>{textKey(file, "title") || textKey(file, "originalFilename") || `File #${String(readKey(file, "fileId"))}`}</option>)}
                    </select>
                    <button className="button button--quiet" type="button" disabled={editingLocked} onClick={() => setReceiptPickerPosition(null)}>Cancel</button>
                  </div>
                  : line.receiptFileId
                    ? <div className="invoice-line-receipt-summary">
                      <span><strong>Receipt</strong>{receiptName || `File #${line.receiptFileId}`}</span>
                      {editable && <div><button className="button button--quiet" type="button" disabled={editingLocked || !receiptFiles.length} onClick={() => setReceiptPickerPosition(line.position)}>Change</button><button className="button button--quiet" type="button" disabled={editingLocked} onClick={() => updateLine(index, { receiptFileId: "" })}>Remove</button></div>}
                    </div>
                    : null}
              </div>}
            </article>;
          })}
        </div>
        {editable && <div className="invoice-line-toolbar"><span>{lines.length} of 100 lines</span><button className="button button--quiet" type="button" disabled={editingLocked || lines.length >= 100} onClick={addLine}>Add line</button></div>}
        {editable
          ? <p className="object-editor-note">Payer, due date, and a positive invoice total are required only when you send. Individual lines may be $0.00. Saving creates a new preview digest and expiry, invalidating any earlier send confirmation.</p>
          : <p className="object-editor-state">This invoice has left local preview status, so its details and line snapshots are read-only.</p>}
        {editable && !sendReady && <p className="object-editor-state">This draft is saved. Add a payer with a receivable email, a due date, and a positive invoice total before sending. Zero-dollar lines are allowed.</p>}
        {sendable && hasChanges && <p className="object-editor-state">Save your line changes before previewing, downloading, or sending this invoice.</p>}
        {confirmingSend && <section className="invoice-send-confirmation" aria-label="Confirm invoice send">
          <p>Send <strong>{formatInvoiceMoney(Number(readKey(invoice, "amountMinor")), currency)}</strong> to <strong>{selectedContact ? textKey(selectedContact, "displayName") : textKey(invoice, "payerName")}</strong> at <strong>{payerEmail}</strong>, due {formatLocalDate(dueOn)}, accepting <strong>{invoicePaymentMethodLabel(paymentMethodPolicy).toLowerCase()}</strong>?</p>
          <div><button className="button button--quiet" type="button" disabled={sending} onClick={() => setConfirmingSend(false)}>Not yet</button><button className="button" type="button" disabled={sending} onClick={() => void send()}>{sending ? "Sending…" : "Yes, send invoice"}</button></div>
        </section>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <footer className="object-editor-actions"><div className="invoice-pdf-actions"><button className="button button--quiet" type="button" disabled={busy || confirmingSend || hasChanges} onClick={() => void previewPdf()}>{openingPdf ? "Opening preview…" : "Preview PDF"}</button><button className="button button--quiet" type="button" disabled={busy || confirmingSend || hasChanges} onClick={() => void downloadPdf()}>{downloadingPdf ? "Downloading…" : "Download PDF"}</button>{Boolean(invoice.stripeInvoiceId) && <button className="button button--quiet" type="button" disabled={busy || confirmingSend} onClick={() => void openStripePdf()}>{openingPdf ? "Opening PDF…" : "Open Stripe PDF"}</button>}</div><button className="button button--quiet" type="button" disabled={busy} onClick={onClose}>{editable ? "Cancel" : "Close"}</button>{editable && <button className="button button--quiet" type="submit" disabled={editingLocked || !lines.length || !hasChanges}>{saving ? "Saving…" : "Save changes"}</button>}{sendable && !confirmingSend && <button className="button" type="button" disabled={busy || hasChanges} onClick={() => { setError(""); setConfirmingSend(true); }}>{sendLabel}</button>}</footer>
      </form>
    </section>
  </div>;
}

function PaymentsScreen() {
  const { data: statusData, error: statusError, loading: statusLoading, reload: reloadStatus } = useApi<{ stripe: StripeConnectionStatus }>("/api/payments/stripe/status");
  const { data: invoiceData, error: invoiceError, loading: invoicesLoading, reload: reloadInvoices } = useApi<{ count: number; invoices: Entity[] }>("/api/payment-invoices?limit=100");
  const { data: contactData, error: contactError, loading: contactsLoading } = useApi<{ contacts: Entity[] }>("/api/contacts?scope=active&limit=10000");
  const { data: todoData, error: todoError, loading: todosLoading } = useApi<{ todos: Entity[] }>("/api/todos?scope=all&limit=10000");
  const { data: fileData } = useApi<{ files: Entity[] }>("/api/files?limit=500");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [creatingInvoice, setCreatingInvoice] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Entity | null>(null);
  const stripe = statusData?.stripe;
  const invoices = useMemo(() => [...(invoiceData?.invoices ?? [])].sort((left, right) => {
    const leftCreated = Date.parse(textKey(left, "createdAtUtc"));
    const rightCreated = Date.parse(textKey(right, "createdAtUtc"));
    if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated) && leftCreated !== rightCreated) {
      return rightCreated - leftCreated;
    }
    return Number(readKey(right, "invoiceId")) - Number(readKey(left, "invoiceId"));
  }), [invoiceData?.invoices]);
  const unavailableTodoIds = useMemo(() => {
    const result = new Set<number>();
    const activeStatuses = new Set(["prepared", "sending", "open", "processing", "paid", "failed"]);
    for (const invoice of invoices) {
      const status = textKey(invoice, "status");
      if (!activeStatuses.has(status)) continue;
      const localPreviewExpired = ["prepared", "sending", "failed"].includes(status)
        && !invoice.stripeInvoiceId
        && Date.parse(textKey(invoice, "preparationExpiresAtUtc")) <= Date.now();
      if (localPreviewExpired) continue;
      if (!Array.isArray(invoice.lines)) continue;
      for (const line of invoice.lines) {
        if (!line || typeof line !== "object" || Array.isArray(line)) continue;
        const todoId = Number(readKey(line as Entity, "personalTaskId"));
        if (Number.isSafeInteger(todoId) && todoId > 0) result.add(todoId);
      }
    }
    return result;
  }, [invoices]);
  const connect = async () => {
    setConnecting(true);
    setConnectError("");
    try {
      const result = await api<{ url: string }>("/api/payments/stripe/oauth/start", { method: "POST" });
      window.location.assign(result.url);
    } catch (caught) {
      setConnectError(caught instanceof Error ? caught.message : "Could not start Stripe Connect.");
      setConnecting(false);
    }
  };
  const refresh = () => { void reloadStatus(); void reloadInvoices(); };
  return <>
    <PageHeading eyebrow="Money received through your work" title="Payments" detail="Create, review, and send invoices through your connected Stripe account." actions={<><button className="button" type="button" onClick={() => setCreatingInvoice(true)}>Create invoice</button><button className="button button--quiet" type="button" onClick={refresh}>Refresh</button></>} />
    {statusLoading && <Loading label="Checking Stripe" />}
    {statusError && <ErrorState error={statusError} retry={reloadStatus} />}
    {stripe && <section className="entity-card">
      <div className="entity-meta"><span className="pill">Stripe Connect</span><span>{stripe.status || (stripe.configured ? "Not connected" : "Needs platform settings")}</span></div>
      <h2>{stripe.connected ? "Receiving account connected" : "Connect a receiving account"}</h2>
      <p>{stripe.connected
        ? `${stripe.accountId || "Stripe account"} · Charges ${stripe.chargesEnabled ? "enabled" : "not enabled"} · Payouts ${stripe.payoutsEnabled ? "enabled" : "not enabled"}`
        : stripe.reason || "Finish the Time v3 Stripe platform configuration, then connect the account that should receive payments."}</p>
      {stripe.disabledReason && <p className="form-error">Stripe restriction: {stripe.disabledReason}</p>}
      {Boolean(stripe.currentlyDue?.length) && <p>Still required by Stripe: {stripe.currentlyDue!.join(", ")}</p>}
      {!stripe.connected && <button className="button" type="button" disabled={!stripe.configured || connecting} onClick={() => void connect()}>{connecting ? "Opening Stripe…" : "Connect Stripe account"}</button>}
      {connectError && <p className="form-error" role="alert">{connectError}</p>}
    </section>}
    <section className="page-heading"><div><p className="eyebrow">Invoice history</p><h2>Invoices</h2></div><span className="invoice-sort-label">Newest first</span></section>
    {invoicesLoading && <Loading label="Loading invoices" />}
    {invoiceError && <ErrorState error={invoiceError} retry={reloadInvoices} />}
    {!invoicesLoading && !invoiceError && !invoiceData?.invoices?.length && <Empty>No invoices yet. Create one here or ask the Agent to prepare one.</Empty>}
    <div className="invoice-history-list">{invoices.map((invoice) => <InvoiceCard
      key={String(invoice.invoiceId)}
      object={objectCardData({
        id: Number(invoice.invoiceId), type: "payments.invoice", label: "Payment invoice",
        display: textKey(invoice, "payerName") || `Invoice #${String(invoice.invoiceId)}`,
        body: textKey(invoice, "description") || textKey(invoice, "payerEmail") || `${Array.isArray(invoice.lines) ? invoice.lines.length : 0} invoice line(s)`,
        attributes: [
          { label: "Amount", value: formatInvoiceMoney(Number(readKey(invoice, "amountMinor")), textKey(invoice, "currency")) },
          { label: "Due", value: textKey(invoice, "dueOn") ? formatLocalDate(textKey(invoice, "dueOn")) : "Not set" },
          { label: "Created", value: formatDisplayDate(textKey(invoice, "createdAtUtc")) },
          { label: "ID", value: `#${String(invoice.invoiceId)}` },
        ],
        badges: [invoicePaymentStatusLabel(invoice)],
      })}
      onEdit={() => setSelectedInvoice(invoice)}
      controls={<ObjectSelectionControls identity={invoiceIdentity(invoice)} subject={`invoice ${String(invoice.invoiceId)}`} />}
      actions={Boolean(invoice.hostedInvoiceUrl) ? [{ key: "stripe", label: "Open Stripe", href: String(invoice.hostedInvoiceUrl), external: true }] : []}
    />)}</div>
    {selectedInvoice && <InvoiceEditor
      key={`${String(selectedInvoice.invoiceId)}:${textKey(selectedInvoice, "previewDigest")}`}
      invoice={selectedInvoice}
      contacts={contactData?.contacts ?? []}
      files={fileData?.files ?? []}
      onClose={() => setSelectedInvoice(null)}
      onChanged={async (updated) => { setSelectedInvoice(updated); await reloadInvoices(); }}
    />}
    {creatingInvoice && <CreateInvoiceEditor
      contacts={contactData?.contacts ?? []}
      todos={todoData?.todos ?? []}
      unavailableTodoIds={unavailableTodoIds}
      loading={contactsLoading || todosLoading}
      loadError={contactError || todoError}
      onClose={() => setCreatingInvoice(false)}
      onCreated={(invoice) => { setCreatingInvoice(false); setSelectedInvoice(invoice); void reloadInvoices(); }}
    />}
  </>;
}

function DailyPaperRoute() {
  const parameters = new URLSearchParams(location.search);
  const timeZone = parameters.get("timeZone") || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const query = new URLSearchParams({ date: parameters.get("date") || localToday(timeZone), timeZone, paperSize: parameters.get("paperSize") || "letter", includeCompletedTodos: parameters.get("includeCompletedTodos") || "false" });
  const { data, error, loading } = useApi<DailyPaperModel>(`/api/daily-paper?${query}`);
  useEffect(() => { if (!data) return; void document.fonts.ready.then(() => { window.__DAILY_PAPER_READY__ = true; }); }, [data]);
  if (loading) return <Loading label="Laying out daily paper" />;
  if (error) return <ErrorState error={error} />;
  return data ? <DailyPaper model={data} /> : null;
}

function Workspace() {
  const fromHash = location.hash.slice(1);
  const [view, setView] = useState(navigation.some(([id]) => id === fromHash) ? fromHash : "agent");
  const [editingToken, setEditingToken] = useState(false);
  const [tokenDraft, setTokenDraft] = useState(getAccessToken());
  const [calendarGenerationNotice, setCalendarGenerationNotice] = useState<string | null>(null);
  const [agentDraft, setAgentDraft] = useState("");
  const [agentObjectSelections, setAgentObjectSelections] = useState<SelectedObjectCandidate[]>([]);
  const [agentSelectionNotice, setAgentSelectionNotice] = useState<string | null>(null);
  const [agentComposerSelection, setAgentComposerSelection] = useState<ComposerTextSelection | null>(null);
  const [agentComposerCursorRequest, setAgentComposerCursorRequest] = useState<{ position: number; revision: number } | null>(null);
  const [requestRefreshKey, setRequestRefreshKey] = useState(0);
  const [optimisticRequests, setOptimisticRequests] = useState<RequestRecord[]>([]);
  const [traceRequestId, setTraceRequestId] = useState<string | null>(null);
  const [requestTrace, setRequestTrace] = useState<RequestTrace | null>(null);
  const [traceError, setTraceError] = useState<unknown>(null);
  const go = (next: string) => { setView(next); history.replaceState(null, "", `#${next}`); };
  const toggleObjectSelection = (identity: SelectedObjectCandidate) => {
    const selected = agentObjectSelections.find(({ ref }) => ref === identity.ref);
    if (selected) {
      setAgentObjectSelections((current) => current.filter(({ ref }) => ref !== identity.ref));
      if (selected.selectionOrigin === "mention") {
        setAgentDraft((current) => current.replaceAll(selected.mention, "").replace(/ {2,}/gu, " ").trimStart());
      }
      setAgentSelectionNotice(null);
      return;
    }
    if (agentObjectSelections.length >= maximumObjectReferences) {
      setAgentSelectionNotice(`A request can reference at most ${maximumObjectReferences} objects. Nothing was selected or truncated.`);
      return;
    }
    setAgentSelectionNotice(null);
    setAgentObjectSelections((current) => [...current, { ...identity, selectionOrigin: "card" }]);
  };
  const showTrace = async (requestId: string) => {
    setTraceRequestId(requestId);
    setRequestTrace(null);
    setTraceError(null);
    try { setRequestTrace(await api<RequestTrace>(`/api/requests/${encodeURIComponent(requestId)}/trace`)); }
    catch (caught) { setTraceError(caught); }
  };
  const saveToken = (event: FormEvent) => {
    event.preventDefault();
    if (!tokenDraft.trim()) return;
    setAccessToken(tokenDraft);
    setEditingToken(false);
  };
  let screen: ReactNode;
  if (view === "agent") screen = <AgentScreen
    onShowTrace={(requestId) => void showTrace(requestId)}
    refreshKey={requestRefreshKey}
    optimisticRequests={optimisticRequests}
    onRequestsObserved={(requestIds) => {
      const observed = new Set(requestIds);
      setOptimisticRequests((current) => current.filter(({ requestId }) => !observed.has(requestId)));
    }}
  />;
  else if (view === "calendar") screen = <CalendarScreen generationNotice={calendarGenerationNotice} dismissGenerationNotice={() => setCalendarGenerationNotice(null)} />;
  else if (view === "todos") screen = <TodoScreen />;
  else if (view === "contacts") screen = <ContactsScreen />;
  else if (view === "hats") screen = <HatsScreen />;
  else if (view === "routine") screen = <RoutineScreen onGenerated={(message) => { setCalendarGenerationNotice(message); go("calendar"); }} />;
  else if (view === "journal") screen = <JournalScreen />;
  else if (view === "payments") screen = <PaymentsScreen />;
  else if (view === "ai-usage") screen = <UsageScreen />;
  else if (view === "content") screen = <LibraryScreen />;
  else if (view === "video-scripts") screen = <VideoScriptsScreen />;
  else if (view === "files") screen = <FilesScreen />;
  else screen = <GenericScreen kind={view as keyof typeof genericScreens} />;
  return <ObjectSelectionProvider selections={agentObjectSelections} toggleSelection={toggleObjectSelection}><div className="app-shell"><aside className="sidebar"><a className="brand" href="/app"><img src="/icon.svg" alt="" /><span>Time v3<br />Agent</span></a><nav>{navigation.map(([id, label]) => <button className={view === id ? "active" : ""} onClick={() => go(id)} key={id}><NavigationIcon id={id} label={label} />{label}</button>)}</nav><div className="token-settings">
    <button className="token-button" onClick={() => { setTokenDraft(getAccessToken()); setEditingToken((open) => !open); }}>Access token</button>
    {editingToken && <form className="token-editor" onSubmit={saveToken}>
      <label>Replace token<input autoFocus type="password" value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} /></label>
      <div><button className="button">Save</button><button type="button" className="button button--quiet" onClick={() => setEditingToken(false)}>Cancel</button></div>
    </form>}
  </div></aside><main className="workspace">{screen}</main><AgentComposer
    text={agentDraft}
    setText={setAgentDraft}
    selections={agentObjectSelections}
    setSelections={setAgentObjectSelections}
    selectionNotice={agentSelectionNotice}
    clearSelectionNotice={() => setAgentSelectionNotice(null)}
    cursorRequest={agentComposerCursorRequest}
    onSelectionChange={setAgentComposerSelection}
    onSubmitted={(request) => {
      setAgentComposerSelection(null);
      setAgentComposerCursorRequest(null);
      setOptimisticRequests((current) => [request, ...current.filter(({ requestId }) => requestId !== request.requestId)]);
      setRequestRefreshKey((current) => current + 1);
    }}
  />{traceRequestId && <TracePanel requestId={traceRequestId} trace={requestTrace} error={traceError} onClose={() => setTraceRequestId(null)} />}</div></ObjectSelectionProvider>;
}

export default function App() {
  const isPaper = new URLSearchParams(location.search).get("paper") === "daily";
  if (isPaper) return <DailyPaperRoute />;
  return <TokenGate><Workspace /></TokenGate>;
}
