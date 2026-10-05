import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, downloadAuthenticated, getAccessToken, setAccessToken } from "./api";
import { useApi, localToday } from "./hooks";
import { CalendarGrid, DailyPaper, DayTimeline, ScheduledTodos } from "./components/DailyPaper";
import { Empty, ErrorState, Loading } from "./components/State";
import { RoutineScreen } from "./components/RoutineCalendar";
import { ObjectMentionInput } from "./components/ObjectMentionInput";
import { TodoItem } from "./components/EditableItems";
import { TrackerSchedule } from "./components/TrackerSchedule";
import {
  AgentReferenceButton, contactIdentity, exchangeIdentity,
  genericEntityIdentity, journalEntryIdentity, journalTrackerIdentity,
  type AddAgentReference, type GenericObjectKind,
} from "./components/AgentReferenceButton";
import { formatDisplayDate, formatLocalDate } from "./date-format";
import type { DailyPaperModel, Entity, RequestRecord, SelectedObjectCandidate, StoredFileBinding } from "./types";
import hatOutlineUrl from "./assets/logo-outline-hat.svg";

const navigation = [
  ["agent", "Agent"], ["hats", "Hats"], ["calendar", "Calendar"], ["routine", "Routine"],
  ["todos", "To do"], ["content", "Library"], ["video-scripts", "Video Scripts"],
  ["files", "Files"], ["contacts", "Contacts"], ["journal", "Journal"],
  ["interactions", "Check-in"], ["ai-usage", "AI Usage"],
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

function readKey(entity: Entity, ...keys: string[]) {
  for (const key of keys) if (entity[key] != null && entity[key] !== "") return entity[key];
  return null;
}

function textKey(entity: Entity, ...keys: string[]) {
  const value = readKey(entity, ...keys);
  return value == null ? "" : String(value);
}

function PageHeading({ eyebrow, title, detail, actions }: {
  eyebrow: string; title: string; detail?: string; actions?: ReactNode;
}) {
  return <header className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{detail && <p>{detail}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</header>;
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
      const existing = todos.get(todoId) || { ...todo, todoId, eventTitles: [] };
      const eventTitles = existing.eventTitles || [];
      if (!eventTitles.includes(calendarEvent.title)) eventTitles.push(calendarEvent.title);
      todos.set(todoId, { ...existing, eventTitles });
    }
  }
  return [...todos.values()];
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
    <p>Enter the access token for this Chapeaux Fous installation.</p>
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

function formatRecordingClock(milliseconds: number) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function AgentComposer({ text, setText, selections, setSelections, referenceNotice, clearReferenceNotice, onSubmitted }: {
  text: string;
  setText: (value: string) => void;
  selections: SelectedObjectCandidate[];
  setSelections: (selections: SelectedObjectCandidate[]) => void;
  referenceNotice: string | null;
  clearReferenceNotice: () => void;
  onSubmitted: () => void;
}) {
  const textArea = useRef<HTMLTextAreaElement>(null);
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
  const recordingSupported = typeof navigator !== "undefined"
    && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== "undefined";
  const isRecording = recordingPhase === "recording";

  useEffect(() => {
    if (!referenceNotice) return;
    textArea.current?.focus();
    textArea.current?.setSelectionRange(text.length, text.length);
  }, [referenceNotice, text.length]);

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
      await api<{ requestId: string; fileId: number }>("/api/voice", {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
      setRecordingStatus("Voice request queued.");
      onSubmitted();
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught : new Error(String(caught)));
      setRecordingStatus("");
    } finally {
      resetRecording();
    }
  };

  const startRecording = async () => {
    if (!recordingSupported || recordingPhase !== "idle") return;
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (recordingPhase === "recording") {
      sendRecording();
      return;
    }
    if (!text.trim() || sending || recordingPhase !== "idle") return;
    setSubmitError(null);
    setRecordingStatus("");
    clearReferenceNotice();
    setSending(true);
    try {
      const referencedRequestIds = [...new Set(selections.flatMap(
        ({ referencedRequestId }) => referencedRequestId ? [referencedRequestId] : [],
      ))].slice(0, 8);
      const selectedObjectCandidates = selections.flatMap(
        ({ label: _label, detail: _detail, referencedRequestId, ...selection }) =>
          referencedRequestId ? [] : [selection],
      );
      await api("/api/requests", { method: "POST", body: JSON.stringify({
        text,
        referencedRequestIds,
        selectedObjectCandidates,
      }) });
      setText("");
      setSelections([]);
      onSubmitted();
    } catch (caught) { setSubmitError(caught instanceof Error ? caught : new Error(String(caught))); }
    finally { setSending(false); }
  };

  const recorderTitle = !recordingSupported
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

  return <form className={`composer ${isRecording ? "recording" : ""}`} onSubmit={submit}>
    {referenceNotice && <div className="composer-feedback" role="status">{referenceNotice}</div>}
    {recordingStatus && <div className="composer-feedback recording-status" role="status">{recordingStatus}</div>}
    {submitError && <ErrorState error={submitError} dismiss={() => setSubmitError(null)} />}
    <div className="composer-input-row">
      {isRecording && <button className="button button--quiet cancel-recording" type="button" onClick={cancelRecording} aria-label="Cancel recording" title="Cancel recording"><span aria-hidden="true">×</span><span>Cancel</span></button>}
      {!isRecording && <ObjectMentionInput
        value={text}
        onChange={(value) => { setText(value); clearReferenceNotice(); setRecordingStatus(""); setSubmitError(null); }}
        selections={selections}
        onSelectionsChange={setSelections}
        textareaRef={textArea}
      />}
      <div className="voice-recorder">
        <button
          className={`record-button ${isRecording ? "recording" : ""}`}
          type="button"
          onClick={() => void startRecording()}
          disabled={!recordingSupported || !["idle", "recording"].includes(recordingPhase)}
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
  </form>;
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

function AgentScreen({ onReference, onShowTrace, refreshKey }: {
  onReference: AddAgentReference;
  onShowTrace: (requestId: string) => void;
  refreshKey: number;
}) {
  const { data, error, loading, reload } = useApi<{ requests: RequestRecord[] }>("/api/requests?limit=50", 3000);
  const initialScrollPending = useRef(true);
  useEffect(() => { if (refreshKey > 0) void reload(); }, [refreshKey, reload]);
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
  return <>
    <PageHeading eyebrow="Your operating desk" title="Agent" detail="Ask in ordinary language. Chapeaux Fous orients, shows its brief, then acts with visible tools." />
    <section className="conversation">
      {loading && <Loading label="Loading requests" />}{error ? <ErrorState error={error} retry={reload} /> : null}
      {data?.requests?.length ? [...data.requests].reverse().map((request) => <article className="request-card" key={request.requestId}>
        <div className="request-question"><span>You</span><p>{request.request}</p></div>
        {request.turnBriefApproval?.approvalId && <div className="turn-brief">
          <p className="eyebrow">Turn brief</p><strong>{request.turnBriefApproval.objective || request.turnBriefApproval.summary}</strong><p>{request.turnBriefApproval.summary}</p>
          <div><button className="button" onClick={() => void decide(request, "continue")}>Continue</button><button className="button button--quiet" onClick={() => void decide(request, "cancel")}>Cancel</button></div>
        </div>}
        {request.response && <div className="request-response"><span>Chapeaux Fous</span><p>{request.response}</p></div>}
        {request.error && <p className="inline-error">{request.error}</p>}
        <RequestInteractionMetrics request={request} />
        <footer><span className={`status-dot status-${request.status}`} />{request.status.replaceAll("_", " ")}<code>{request.requestId.slice(0, 8)}</code><button className="trace-button" type="button" onClick={() => onShowTrace(request.requestId)}>Show trace</button>{["complete", "error"].includes(request.status) && <AgentReferenceButton identity={exchangeIdentity(request)} subject={`exchange ${request.requestId.slice(0, 8)}`} onReference={onReference} />}</footer>
      </article>) : !loading && <Empty>No requests yet. Start with what is on your mind.</Empty>}
    </section>
  </>;
}

function CalendarScreen({ generationNotice, dismissGenerationNotice, onReference }: {
  generationNotice?: string | null;
  dismissGenerationNotice?: () => void;
  onReference: AddAgentReference;
}) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = localToday(timeZone);
  const [selectedDate, setSelectedDate] = useState(date);
  const [displayDate, setDisplayDate] = useState(date);
  const query = new URLSearchParams({ date: selectedDate, rangeDate: displayDate, timeZone, paperSize: "letter", includeCompletedTodos: "false" });
  const { data, error, loading, reload } = useApi<DailyPaperModel>(`/api/daily-paper?${query}`);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<unknown>(null);
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
    };
  }, [data, selectedDate, selectedEvents, selectedTodos]);
  const generate = async () => {
    setGenerationError(null);
    setGenerating(true);
    try {
      const result = await api<{ file: StoredFileBinding }>("/api/daily-paper/pdf", { method: "POST", body: JSON.stringify({ date: selectedDate, timeZone, paperSize: "letter", includeCompletedTodos: false }) });
      await downloadAuthenticated(result.file.downloadUrl, result.file.originalFilename || `daily-paper-${selectedDate}.pdf`);
    } catch (caught) { setGenerationError(caught); }
    finally { setGenerating(false); }
  };
  return <>
    <PageHeading eyebrow="Authoritative calendar" title="Calendar" detail="A shared React view for the screen and the page." actions={
      <button className="button" onClick={() => void generate()} disabled={generating || !data}>{generating ? "Making PDF…" : "Download daily PDF"}</button>
    } />
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
        <CalendarGrid id="calendar-grid" days={data.calendarDays} selectedDate={selectedDate} onSelect={setSelectedDate} />
        <button className="calendar-range-arrow" type="button" aria-label="Next week" aria-controls="calendar-grid" title="Next week" onClick={() => setDisplayDate((current) => shiftLocalDate(current, 7))}>▼</button>
      </section>
      <div className="calendar-lower"><section className="surface"><p className="eyebrow">{formatLocalDate(selectedDate)}</p><h2>Selected day’s timeline</h2><DayTimeline events={selectedEvents} timeZone={data.timeZone} onReference={onReference} onChanged={reload} /></section><section className="surface"><p className="eyebrow">Attached work</p><h2>Scheduled to-dos</h2><ScheduledTodos todos={selectedTodos} onReference={onReference} onChanged={reload} /></section></div>
      <details className="paper-preview surface">
        <summary>Preview the printed page</summary>
        {previewModel ? <DailyPaper model={previewModel} preview /> : <Loading label="Refreshing preview" />}
      </details>
    </div>}
  </>;
}

function TodoScreen({ onReference }: { onReference: AddAgentReference }) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("all");
  const scope = showCompleted ? "all" : "active";
  const { data, error, loading, reload } = useApi<{ todos: Entity[] }>(`/api/todos?scope=${scope}&limit=1000`);
  const { data: groupData, error: groupError, loading: groupsLoading, reload: reloadGroups } = useApi<{ groups: Entity[] }>("/api/todo-groups");
  const [draft, setDraft] = useState("");
  const add = async (event: FormEvent) => { event.preventDefault(); await api("/api/todos", { method: "POST", body: JSON.stringify({ text: draft, status: "todo" }) }); setDraft(""); await reload(); };
  const statusTodos = (data?.todos || []).filter((todo) =>
    todo.status === "todo" || todo.status === "ai_suggested" || (showCompleted && todo.status === "complete"),
  );
  const todos = selectedGroupId === "all"
    ? statusTodos
    : statusTodos.filter((todo) => String(readKey(todo, "groupId")) === selectedGroupId);
  const groups = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; todos: Entity[] }>();
    for (const todo of todos) {
      const name = textKey(todo, "groupName") || "Inbox";
      const groupId = readKey(todo, "groupId");
      const id = groupId == null ? `name:${name}` : `id:${String(groupId)}`;
      const group = grouped.get(id) || { id, name, todos: [] };
      group.todos.push(todo);
      grouped.set(id, group);
    }
    return [...grouped.values()];
  }, [todos]);
  return <><PageHeading eyebrow="Unscheduled work" title="To do" detail={`${todos.length} ${showCompleted ? "open and completed" : "open"} ${todos.length === 1 ? "item" : "items"} across ${groups.length} ${groups.length === 1 ? "list" : "lists"}.`} actions={<div className="todo-heading-actions"><label className="todo-group-filter"><span>Group</span><select value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value)} disabled={groupsLoading}><option value="all">All groups</option>{groupData?.groups?.map((group) => <option value={String(group.id)} key={String(group.id)}>{textKey(group, "name")}</option>)}</select></label><label className="todo-completed-filter"><input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} />Show completed</label><form className="inline-create" onSubmit={(event) => void add(event)}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a task" required /><button className="button">Add</button></form></div>} />
    {loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}{groupError && <ErrorState error={groupError} retry={reloadGroups} />}{!loading && !error && !todos.length && <Empty>{showCompleted ? "No open or completed to-dos yet." : "No open to-dos."}</Empty>}<div className="group-list">{groups.map((group) => <section className="todo-group" key={group.id} aria-labelledby={`todo-group-${group.id}`}><header className="todo-group-heading"><h2 id={`todo-group-${group.id}`}>{group.name}</h2><span>{group.todos.length} {group.todos.length === 1 ? "item" : "items"}</span></header><div className="todo-group-items">{group.todos.map((todo) => <TodoItem todo={todo} groups={groupData?.groups || []} onChanged={reload} onReference={onReference} key={String(todo.id)} />)}</div></section>)}</div></>;
}

function ContactsScreen({ onReference }: { onReference: AddAgentReference }) {
  const { data, error, loading, reload } = useApi<{ contacts: Entity[] }>("/api/contacts?scope=all&limit=10000");
  const [draft, setDraft] = useState("");
  const create = async (event: FormEvent) => { event.preventDefault(); await api("/api/contacts", { method: "POST", body: JSON.stringify({ displayName: draft, kind: "person", methods: [], tags: [] }) }); setDraft(""); await reload(); };
  return <><PageHeading eyebrow="People & organizations" title="Contacts" detail="Phone, message, and email links stay native-friendly for the future mobile client." actions={<form className="inline-create" onSubmit={(event) => void create(event)}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Contact name" required /><button className="button">Add</button></form>} />
    {loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}<div className="contact-grid">{data?.contacts?.map((contact) => { const methods = (contact.methods as Entity[] | undefined) || []; return <article className="contact-card" key={contact.id}><div className="contact-monogram">{textKey(contact, "displayName", "name").slice(0, 2).toUpperCase()}</div><h2>{textKey(contact, "displayName", "name")}</h2><p>{textKey(contact, "organizationName")}</p><div className="contact-actions"><AgentReferenceButton identity={contactIdentity(contact)} subject={`contact ${textKey(contact, "displayName", "name")}`} onReference={onReference} />{methods.map((method, index) => { const kind = String(method.kind); const value = String(method.value || ""); const href = kind === "phone" ? `tel:${value}` : kind === "email" ? `mailto:${value}` : kind === "url" ? value : null; return href ? <a className="button button--quiet" href={href} key={index}>{kind === "phone" ? "Call" : kind === "email" ? "Email" : "Open"}</a> : null; })}{methods.filter((method) => method.kind === "phone").map((method, index) => <a className="button button--quiet" href={`sms:${method.value}`} key={`sms-${index}`}>Text</a>)}</div>{(contact.tags as string[] | undefined)?.map((tag) => <span className="pill" key={tag}>{tag}</span>)}</article>; })}</div></>;
}

const genericScreens: Record<GenericObjectKind, { eyebrow: string; title: string; detail: string; url: string; key: string }> = {
  content: { eyebrow: "Reference shelf", title: "Library", detail: "Reusable material and published content.", url: "/api/content-items?limit=1000", key: "content" },
  "video-scripts": { eyebrow: "Production", title: "Video Scripts", detail: "Scripts grounded in completed conversations.", url: "/api/video-scripts?status=all&limit=500", key: "scripts" },
  files: { eyebrow: "Durable artifacts", title: "Files", detail: "Uploads, generated documents, and their source evidence.", url: "/api/files?limit=200", key: "files" },
  interactions: { eyebrow: "Guided conversations", title: "Check-in", detail: "Resumable briefings and recurring reviews.", url: "/api/interaction-guides?status=active&limit=500", key: "guides" },
};

function GenericScreen({ kind, onReference }: { kind: keyof typeof genericScreens; onReference: AddAgentReference }) {
  const config = genericScreens[kind];
  const { data, error, loading, reload } = useApi<Record<string, unknown>>(config.url);
  const entities = ((data?.[config.key] as Entity[] | undefined) || []);
  return <><PageHeading eyebrow={config.eyebrow} title={config.title} detail={config.detail} />{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}{!loading && !entities.length && <Empty>Nothing here yet.</Empty>}<div className="card-grid">{entities.map((entity, index) => { const entityId = entity.id || entity.fileId; return <article className="entity-card" key={entityId || index}><div className="entity-meta"><span className="pill">{textKey(entity, "status", "contentStatus", "mediaKind") || config.title}</span><AgentReferenceButton identity={genericEntityIdentity(kind, entity)} subject={`${config.title.toLowerCase()} ${textKey(entity, "title", "name", "originalFilename") || entityId}`} onReference={onReference} />{readKey(entity, "sequence") != null && <span>#{String(entity.sequence)}</span>}</div><h2>{textKey(entity, "title", "name", "originalFilename") || `Item ${entityId || index + 1}`}</h2><p>{textKey(entity, "description", "summary", "contentText")}</p>{kind === "files" && entityId && <button className="button button--quiet" onClick={() => void downloadAuthenticated(`/api/files/${entityId}/download`, textKey(entity, "originalFilename") || `file-${entityId}`)}>Download</button>}</article>; })}</div></>;
}

function HatsScreen() {
  const { data, error, loading, reload } = useApi<Record<string, unknown>>("/api/hats");
  const hats = ((data?.hats as Entity[] | undefined) || (data?.catalog as Entity[] | undefined) || []);
  return <><PageHeading eyebrow="Ways of working" title="Hats" detail={String(data?.introduction || "Name a hat when you want a particular working stance.")} />{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}<div className="hat-grid">{hats.map((hat, index) => <article className="hat-card" key={hat.id || index}><img className="hat-shape" src="/logo-outline-hat.svg" alt="" aria-hidden="true" /><h2>{textKey(hat, "title", "label", "name")}</h2><p>{textKey(hat, "description", "summary")}</p></article>)}</div></>;
}

function JournalScreen({ onReference }: { onReference: AddAgentReference }) {
  const { data: trackers, error, loading, reload } = useApi<{ trackers: Entity[] }>("/api/journal-trackers?limit=200");
  const { data: entries } = useApi<{ entries: Entity[] }>("/api/journal-entries?limit=100");
  return <><PageHeading eyebrow="A record of lived time" title="Journal" detail="Trackers and recent entries, kept alongside the calendar without pretending they are appointments." />{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}<div className="journal-layout"><div className="card-grid">{trackers?.trackers?.map((tracker) => <article className="entity-card tracker-card" key={tracker.id}><div className="entity-meta"><span className="pill">Tracker</span><AgentReferenceButton identity={journalTrackerIdentity(tracker)} subject={`journal tracker ${textKey(tracker, "name", "title")}`} onReference={onReference} /></div><h2>{tracker.name || tracker.title}</h2><p>{textKey(tracker, "description", "unit")}</p><TrackerSchedule tracker={tracker} onChanged={reload} /></article>)}</div><section className="surface"><h2>Recent entries</h2>{entries?.entries?.map((entry, index) => <div className="journal-entry" key={entry.id || index}><div className="journal-entry-heading"><strong>{textKey(entry, "trackerName", "title")}</strong><span>{formatDisplayDate(textKey(entry, "occurredAtUtc", "createdAtUtc"))}</span><AgentReferenceButton identity={journalEntryIdentity(entry)} subject={`journal entry ${entry.id}`} onReference={onReference} /></div><p>{textKey(entry, "contentText", "text", "numberValue")}</p></div>)}</section></div></>;
}

function UsageScreen() {
  const { data, error, loading, reload } = useApi<{ entries: Entity[]; current: Entity }>("/api/ai-usage?limit=10000");
  const totals = useMemo(() => (data?.entries || []).reduce<{ calls: number; input: number; output: number }>(
    (result, entry) => ({ calls: result.calls + 1, input: result.input + Number(readKey(entry, "inputTokens", "input_tokens") || 0), output: result.output + Number(readKey(entry, "outputTokens", "output_tokens") || 0) }), { calls: 0, input: 0, output: 0 },
  ), [data]);
  return <><PageHeading eyebrow="Metered model work" title="AI Usage" detail={`${textKey(data?.current || {}, "transport")} · ${textKey(data?.current || {}, "model")}`} />{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}<div className="metric-grid"><article><span>Calls</span><strong>{totals.calls.toLocaleString()}</strong></article><article><span>Input tokens</span><strong>{totals.input.toLocaleString()}</strong></article><article><span>Output tokens</span><strong>{totals.output.toLocaleString()}</strong></article></div></>;
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
  const [agentReferenceNotice, setAgentReferenceNotice] = useState<string | null>(null);
  const [requestRefreshKey, setRequestRefreshKey] = useState(0);
  const [traceRequestId, setTraceRequestId] = useState<string | null>(null);
  const [requestTrace, setRequestTrace] = useState<RequestTrace | null>(null);
  const [traceError, setTraceError] = useState<unknown>(null);
  const go = (next: string) => { setView(next); history.replaceState(null, "", `#${next}`); };
  const referenceInAgent: AddAgentReference = (identity, subject) => {
    const alreadySelected = agentObjectSelections.some(({ ref }) => ref === identity.ref);
    if (!alreadySelected) {
      setAgentObjectSelections((current) => [...current, identity]);
      setAgentDraft((current) => identity.mention + (current ? ` ${current}` : " "));
    }
    setAgentReferenceNotice((alreadySelected ? "Already referencing " : "Added ")
      + subject + " in the Agent composer.");
    go("agent");
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
  if (view === "agent") screen = <AgentScreen onReference={referenceInAgent} onShowTrace={(requestId) => void showTrace(requestId)} refreshKey={requestRefreshKey} />;
  else if (view === "calendar") screen = <CalendarScreen generationNotice={calendarGenerationNotice} dismissGenerationNotice={() => setCalendarGenerationNotice(null)} onReference={referenceInAgent} />;
  else if (view === "todos") screen = <TodoScreen onReference={referenceInAgent} />;
  else if (view === "contacts") screen = <ContactsScreen onReference={referenceInAgent} />;
  else if (view === "hats") screen = <HatsScreen />;
  else if (view === "routine") screen = <RoutineScreen onGenerated={(message) => { setCalendarGenerationNotice(message); go("calendar"); }} onReference={referenceInAgent} />;
  else if (view === "journal") screen = <JournalScreen onReference={referenceInAgent} />;
  else if (view === "ai-usage") screen = <UsageScreen />;
  else screen = <GenericScreen kind={view as keyof typeof genericScreens} onReference={referenceInAgent} />;
  return <div className="app-shell"><aside className="sidebar"><a className="brand" href="/app"><img src="/icon.svg" alt="" /><span>Chapeaux<br />Fous</span></a><nav>{navigation.map(([id, label]) => <button className={view === id ? "active" : ""} onClick={() => go(id)} key={id}><NavigationIcon id={id} label={label} />{label}</button>)}</nav><div className="token-settings">
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
    referenceNotice={agentReferenceNotice}
    clearReferenceNotice={() => setAgentReferenceNotice(null)}
    onSubmitted={() => { setRequestRefreshKey((current) => current + 1); go("agent"); }}
  />{traceRequestId && <TracePanel requestId={traceRequestId} trace={requestTrace} error={traceError} onClose={() => setTraceRequestId(null)} />}</div>;
}

export default function App() {
  const isPaper = new URLSearchParams(location.search).get("paper") === "daily";
  if (isPaper) return <DailyPaperRoute />;
  return <TokenGate><Workspace /></TokenGate>;
}
