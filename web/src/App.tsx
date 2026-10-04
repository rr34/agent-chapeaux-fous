import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, downloadAuthenticated, getAccessToken, setAccessToken } from "./api";
import { useApi, localToday } from "./hooks";
import { CalendarGrid, DailyPaper, DayTimeline, ScheduledTodos } from "./components/DailyPaper";
import { Empty, ErrorState, Loading } from "./components/State";
import { RoutineScreen } from "./components/RoutineCalendar";
import {
  AgentReferenceButton, contactIdentity, exchangeIdentity,
  genericEntityIdentity, journalEntryIdentity, journalTrackerIdentity, todoIdentity,
  type AddAgentReference, type GenericObjectKind,
} from "./components/AgentReferenceButton";
import { formatDisplayDate, formatLocalDate } from "./date-format";
import type { DailyPaperModel, Entity, RequestRecord, StoredFileBinding } from "./types";
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

function referencedRequestIdsFromComposer(value: string) {
  const requestIds = [...value.matchAll(/^Reference code:\s*request_id=([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s*$/gimu)]
    .map((match) => match[1].toLowerCase());
  return [...new Set(requestIds)].slice(0, 8);
}

function AgentScreen({ text, setText, referenceNotice, clearReferenceNotice, onReference }: {
  text: string;
  setText: (value: string) => void;
  referenceNotice: string | null;
  clearReferenceNotice: () => void;
  onReference: AddAgentReference;
}) {
  const { data, error, loading, reload } = useApi<{ requests: RequestRecord[] }>("/api/requests?limit=50", 3000);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  useEffect(() => {
    textArea.current?.focus();
    textArea.current?.setSelectionRange(text.length, text.length);
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!text.trim()) return;
    setSubmitError(null);
    clearReferenceNotice();
    setSending(true);
    try { await api("/api/requests", { method: "POST", body: JSON.stringify({ text, referencedRequestIds: referencedRequestIdsFromComposer(text) }) }); setText(""); await reload(); }
    catch (caught) { setSubmitError(caught); }
    finally { setSending(false); }
  };
  const decide = async (request: RequestRecord, decision: "continue" | "cancel") => {
    if (!request.turnBriefApproval?.approvalId) return;
    await api(`/api/requests/${request.requestId}/turn-brief/${decision}`, { method: "POST", body: JSON.stringify({ approvalId: request.turnBriefApproval.approvalId }) });
    await reload();
  };
  return <>
    <PageHeading eyebrow="Your operating desk" title="Agent" detail="Ask in ordinary language. Chapeaux Fous orients, shows its brief, then acts with visible tools." />
    {submitError && <ErrorState error={submitError} dismiss={() => setSubmitError(null)} />}
    {referenceNotice && <p className="agent-reference-notice" role="status">{referenceNotice}</p>}
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
        <footer><span className={`status-dot status-${request.status}`} />{request.status.replaceAll("_", " ")}<code>{request.requestId.slice(0, 8)}</code>{["complete", "error"].includes(request.status) && <AgentReferenceButton identity={exchangeIdentity(request)} subject={`exchange ${request.requestId.slice(0, 8)}`} onReference={onReference} />}</footer>
      </article>) : !loading && <Empty>No requests yet. Start with what is on your mind.</Empty>}
    </section>
    <form className="composer" onSubmit={submit}><textarea ref={textArea} value={text} onChange={(event) => { setText(event.target.value); clearReferenceNotice(); }} placeholder="What would you like Chapeaux Fous to do?" rows={3} /><button className="button" disabled={sending || !text.trim()}>{sending ? "Sending…" : "Send"}</button></form>
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
  const query = new URLSearchParams({ date, timeZone, paperSize: "letter", includeCompletedTodos: "false" });
  const { data, error, loading, reload } = useApi<DailyPaperModel>(`/api/daily-paper?${query}`);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<unknown>(null);
  const selectedDay = data?.calendarDays.find((day) => day.localDate === selectedDate)
    || data?.calendarDays.find((day) => day.isToday);
  const selectedEvents = useMemo(
    () => [...(selectedDay?.events || [])].sort((left, right) => left.startsAtUtc.localeCompare(right.startsAtUtc)),
    [selectedDay],
  );
  const selectedTodos = useMemo(() => linkedTodosForEvents(selectedEvents), [selectedEvents]);
  useEffect(() => {
    if (data && !data.calendarDays.some((day) => day.localDate === selectedDate)) {
      setSelectedDate(data.date);
    }
  }, [data, selectedDate]);
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
      <button className="button" onClick={() => void generate()} disabled={generating || !selectedDay}>{generating ? "Making PDF…" : "Download daily PDF"}</button>
    } />
    {generationNotice && <div className="calendar-generation-notice surface" role="status"><span>{generationNotice}</span>{dismissGenerationNotice && <button className="button button--quiet" onClick={dismissGenerationNotice}>Dismiss</button>}</div>}
    {generationError && <ErrorState
      error={generationError}
      retry={() => void generate()}
      dismiss={() => setGenerationError(null)}
    />}
    {loading && <Loading label="Composing your day" />}{error && <ErrorState error={error} retry={reload} />}
    {data && <div className="calendar-screen">
      <section className="surface calendar-overview"><div className="section-title"><div><p className="eyebrow">Two weeks</p><h2>{data.rangeHeading}</h2></div><button className="button button--quiet" onClick={() => window.print()}>Print browser view</button></div><CalendarGrid days={data.calendarDays} selectedDate={selectedDay?.localDate} onSelect={setSelectedDate} /></section>
      <div className="calendar-lower"><section className="surface"><p className="eyebrow">{formatLocalDate(selectedDay?.localDate || data.date)}</p><h2>Selected day’s timeline</h2><DayTimeline events={selectedEvents} timeZone={data.timeZone} onReference={onReference} /></section><section className="surface"><p className="eyebrow">Attached work</p><h2>Scheduled to-dos</h2><ScheduledTodos todos={selectedTodos} onReference={onReference} /></section></div>
      <details className="paper-preview surface"><summary>Preview the printed page</summary><DailyPaper model={data} preview /></details>
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
  const toggle = async (todo: Entity) => { await api(`/api/todos/${todo.id}`, { method: "PATCH", body: JSON.stringify({ version: todo.version, status: todo.status === "complete" ? "todo" : "complete" }) }); await reload(); };
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
    {loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}{groupError && <ErrorState error={groupError} retry={reloadGroups} />}{!loading && !error && !todos.length && <Empty>{showCompleted ? "No open or completed to-dos yet." : "No open to-dos."}</Empty>}<div className="group-list">{groups.map((group) => <section className="todo-group" key={group.id} aria-labelledby={`todo-group-${group.id}`}><header className="todo-group-heading"><h2 id={`todo-group-${group.id}`}>{group.name}</h2><span>{group.todos.length} {group.todos.length === 1 ? "item" : "items"}</span></header><div className="todo-group-items">{group.todos.map((todo) => <article className={`todo-row ${todo.status === "complete" ? "is-complete" : ""}`} key={todo.id}><button className="todo-check" onClick={() => void toggle(todo)} aria-label={`Mark ${textKey(todo, "text", "title")} ${todo.status === "complete" ? "open" : "complete"}`}>{todo.status === "complete" ? "✓" : ""}</button><div><strong>{textKey(todo, "text", "title")}</strong>{readKey(todo, "sequence") != null && <small>#{String(readKey(todo, "sequence"))}</small>}</div><div className="object-row-actions"><span className="pill">{todo.status}</span><AgentReferenceButton identity={todoIdentity(todo)} subject={`task ${textKey(todo, "text", "title")}`} onReference={onReference} /></div></article>)}</div></section>)}</div></>;
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
  return <><PageHeading eyebrow="Ways of working" title="Hats" detail={String(data?.introduction || "Name a hat when you want a particular working stance.")} />{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}<div className="hat-grid">{hats.map((hat, index) => <article className="hat-card" key={hat.id || index}><div className="hat-shape">{textKey(hat, "label", "title").slice(0, 10)}</div><h2>{textKey(hat, "title", "label", "name")}</h2><p>{textKey(hat, "description", "summary")}</p></article>)}</div></>;
}

function JournalScreen({ onReference }: { onReference: AddAgentReference }) {
  const { data: trackers, error, loading, reload } = useApi<{ trackers: Entity[] }>("/api/journal-trackers?limit=200");
  const { data: entries } = useApi<{ entries: Entity[] }>("/api/journal-entries?limit=100");
  return <><PageHeading eyebrow="A record of lived time" title="Journal" detail="Trackers and recent entries, kept alongside the calendar without pretending they are appointments." />{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}<div className="journal-layout"><div className="card-grid">{trackers?.trackers?.map((tracker) => <article className="entity-card" key={tracker.id}><div className="entity-meta"><span className="pill">Tracker</span><AgentReferenceButton identity={journalTrackerIdentity(tracker)} subject={`journal tracker ${textKey(tracker, "name", "title")}`} onReference={onReference} /></div><h2>{tracker.name || tracker.title}</h2><p>{textKey(tracker, "description", "unit")}</p></article>)}</div><section className="surface"><h2>Recent entries</h2>{entries?.entries?.map((entry, index) => <div className="journal-entry" key={entry.id || index}><div className="journal-entry-heading"><strong>{textKey(entry, "trackerName", "title")}</strong><span>{formatDisplayDate(textKey(entry, "occurredAtUtc", "createdAtUtc"))}</span><AgentReferenceButton identity={journalEntryIdentity(entry)} subject={`journal entry ${entry.id}`} onReference={onReference} /></div><p>{textKey(entry, "contentText", "text", "numberValue")}</p></div>)}</section></div></>;
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
  const [agentReferenceNotice, setAgentReferenceNotice] = useState<string | null>(null);
  const go = (next: string) => { setView(next); history.replaceState(null, "", `#${next}`); };
  const referenceInAgent: AddAgentReference = (identity, subject) => {
    setAgentDraft((current) => current.includes(identity)
      ? current
      : "In reference to:\n" + identity + "\n\n" + current);
    setAgentReferenceNotice("Added " + subject + " to the Agent composer.");
    go("agent");
  };
  const saveToken = (event: FormEvent) => {
    event.preventDefault();
    if (!tokenDraft.trim()) return;
    setAccessToken(tokenDraft);
    setEditingToken(false);
  };
  let screen: ReactNode;
  if (view === "agent") screen = <AgentScreen text={agentDraft} setText={setAgentDraft} referenceNotice={agentReferenceNotice} clearReferenceNotice={() => setAgentReferenceNotice(null)} onReference={referenceInAgent} />;
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
  </div></aside><main className="workspace">{screen}</main></div>;
}

export default function App() {
  const isPaper = new URLSearchParams(location.search).get("paper") === "daily";
  if (isPaper) return <DailyPaperRoute />;
  return <TokenGate><Workspace /></TokenGate>;
}
