import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { api, ApiError, downloadAuthenticated, getAccessToken, setAccessToken } from "./api";
import { useApi, localToday } from "./hooks";
import { CalendarGrid, DailyPaper, DayTimeline, ScheduledTodos } from "./components/DailyPaper";
import { Empty, ErrorState, Loading } from "./components/State";
import type { DailyPaperModel, Entity, RequestRecord, StoredFileBinding } from "./types";

const navigation = [
  ["agent", "Agent"], ["hats", "Hats"], ["calendar", "Calendar"], ["routine", "Routine"],
  ["todos", "To do"], ["content", "Library"], ["video-scripts", "Video Scripts"],
  ["files", "Files"], ["contacts", "Contacts"], ["journal", "Journal"],
  ["interactions", "Check-in"], ["ai-usage", "AI Usage"],
] as const;

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

function calendarDateHeading(localDate: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${localDate}T12:00:00Z`));
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

function AgentScreen() {
  const { data, error, loading, reload } = useApi<{ requests: RequestRecord[] }>("/api/requests?limit=50", 3000);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!text.trim()) return;
    setSubmitError(null);
    setSending(true);
    try { await api("/api/requests", { method: "POST", body: JSON.stringify({ text }) }); setText(""); await reload(); }
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
        <footer><span className={`status-dot status-${request.status}`} />{request.status.replaceAll("_", " ")}<code>{request.requestId.slice(0, 8)}</code></footer>
      </article>) : !loading && <Empty>No requests yet. Start with what is on your mind.</Empty>}
    </section>
    <form className="composer" onSubmit={submit}><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="What would you like Chapeaux Fous to do?" rows={3} /><button className="button" disabled={sending || !text.trim()}>{sending ? "Sending…" : "Send"}</button></form>
  </>;
}

function CalendarScreen() {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [date, setDate] = useState(localToday(timeZone));
  const [selectedDate, setSelectedDate] = useState(date);
  const [size, setSize] = useState<"letter" | "a4">("letter");
  const query = new URLSearchParams({ date, timeZone, paperSize: size, includeCompletedTodos: "false" });
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
      const result = await api<{ file: StoredFileBinding }>("/api/daily-paper/pdf", { method: "POST", body: JSON.stringify({ date, timeZone, paperSize: size, includeCompletedTodos: false }) });
      await downloadAuthenticated(result.file.downloadUrl, result.file.originalFilename || `daily-paper-${date}.pdf`);
    } catch (caught) { setGenerationError(caught); }
    finally { setGenerating(false); }
  };
  return <>
    <PageHeading eyebrow="Authoritative calendar" title="Calendar" detail="A shared React view for the screen and the page." actions={<>
      <label className="compact-field">Date<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelectedDate(event.target.value); }} /></label>
      <label className="compact-field">Paper<select value={size} onChange={(event) => setSize(event.target.value as "letter" | "a4")}><option value="letter">Letter</option><option value="a4">A4</option></select></label>
      <button className="button" onClick={() => void generate()} disabled={generating || !data}>{generating ? "Making PDF…" : "Download daily PDF"}</button>
    </>} />
    {generationError && <ErrorState
      error={generationError}
      retry={() => void generate()}
      dismiss={() => setGenerationError(null)}
    />}
    {loading && <Loading label="Composing your day" />}{error && <ErrorState error={error} retry={reload} />}
    {data && <div className="calendar-screen">
      <section className="surface calendar-overview"><div className="section-title"><div><p className="eyebrow">Two weeks</p><h2>{data.rangeHeading}</h2></div><button className="button button--quiet" onClick={() => window.print()}>Print browser view</button></div><CalendarGrid days={data.calendarDays} selectedDate={selectedDay?.localDate} onSelect={setSelectedDate} /></section>
      <div className="calendar-lower"><section className="surface"><p className="eyebrow">{calendarDateHeading(selectedDay?.localDate || data.date)}</p><h2>Selected day’s timeline</h2><DayTimeline events={selectedEvents} timeZone={data.timeZone} /></section><section className="surface"><p className="eyebrow">Attached work</p><h2>Scheduled to-dos</h2><ScheduledTodos todos={selectedTodos} /></section></div>
      <details className="paper-preview surface"><summary>Preview the printed page</summary><DailyPaper model={data} preview /></details>
    </div>}
  </>;
}

function TodoScreen() {
  const { data, error, loading, reload } = useApi<{ todos: Entity[] }>("/api/todos?scope=all&limit=1000");
  const [draft, setDraft] = useState("");
  const add = async (event: FormEvent) => { event.preventDefault(); await api("/api/todos", { method: "POST", body: JSON.stringify({ text: draft, status: "todo" }) }); setDraft(""); await reload(); };
  const toggle = async (todo: Entity) => { await api(`/api/todos/${todo.id}`, { method: "PATCH", body: JSON.stringify({ version: todo.version, status: todo.status === "complete" ? "todo" : "complete" }) }); await reload(); };
  const todos = data?.todos || [];
  return <><PageHeading eyebrow="Unscheduled work" title="To do" detail={`${todos.length} items across your lists.`} actions={<form className="inline-create" onSubmit={(event) => void add(event)}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a task" required /><button className="button">Add</button></form>} />
    {loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}<div className="group-list">{todos.map((todo) => <article className={`todo-row ${todo.status === "complete" ? "is-complete" : ""}`} key={todo.id}><button className="todo-check" onClick={() => void toggle(todo)} aria-label={`Mark ${textKey(todo, "text", "title")} ${todo.status === "complete" ? "open" : "complete"}`}>{todo.status === "complete" ? "✓" : ""}</button><div><strong>{textKey(todo, "text", "title")}</strong><small>{textKey(todo, "groupName") || "Inbox"}{readKey(todo, "sequence") ? ` · #${readKey(todo, "sequence")}` : ""}</small></div><span className="pill">{todo.status}</span></article>)}</div></>;
}

function ContactsScreen() {
  const { data, error, loading, reload } = useApi<{ contacts: Entity[] }>("/api/contacts?scope=all&limit=10000");
  const [draft, setDraft] = useState("");
  const create = async (event: FormEvent) => { event.preventDefault(); await api("/api/contacts", { method: "POST", body: JSON.stringify({ displayName: draft, kind: "person", methods: [], tags: [] }) }); setDraft(""); await reload(); };
  return <><PageHeading eyebrow="People & organizations" title="Contacts" detail="Phone, message, and email links stay native-friendly for the future mobile client." actions={<form className="inline-create" onSubmit={(event) => void create(event)}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Contact name" required /><button className="button">Add</button></form>} />
    {loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}<div className="contact-grid">{data?.contacts?.map((contact) => { const methods = (contact.methods as Entity[] | undefined) || []; return <article className="contact-card" key={contact.id}><div className="contact-monogram">{textKey(contact, "displayName", "name").slice(0, 2).toUpperCase()}</div><h2>{textKey(contact, "displayName", "name")}</h2><p>{textKey(contact, "organizationName")}</p><div className="contact-actions">{methods.map((method, index) => { const kind = String(method.kind); const value = String(method.value || ""); const href = kind === "phone" ? `tel:${value}` : kind === "email" ? `mailto:${value}` : kind === "url" ? value : null; return href ? <a className="button button--quiet" href={href} key={index}>{kind === "phone" ? "Call" : kind === "email" ? "Email" : "Open"}</a> : null; })}{methods.filter((method) => method.kind === "phone").map((method, index) => <a className="button button--quiet" href={`sms:${method.value}`} key={`sms-${index}`}>Text</a>)}</div>{(contact.tags as string[] | undefined)?.map((tag) => <span className="pill" key={tag}>{tag}</span>)}</article>; })}</div></>;
}

const genericScreens: Record<string, { eyebrow: string; title: string; detail: string; url: string; key: string }> = {
  content: { eyebrow: "Reference shelf", title: "Library", detail: "Reusable material and published content.", url: "/api/content-items?limit=1000", key: "content" },
  "video-scripts": { eyebrow: "Production", title: "Video Scripts", detail: "Scripts grounded in completed conversations.", url: "/api/video-scripts?status=all&limit=500", key: "scripts" },
  files: { eyebrow: "Durable artifacts", title: "Files", detail: "Uploads, generated documents, and their source evidence.", url: "/api/files?limit=200", key: "files" },
  interactions: { eyebrow: "Guided conversations", title: "Check-in", detail: "Resumable briefings and recurring reviews.", url: "/api/interaction-guides?status=active&limit=500", key: "guides" },
};

function GenericScreen({ kind }: { kind: keyof typeof genericScreens }) {
  const config = genericScreens[kind];
  const { data, error, loading, reload } = useApi<Record<string, unknown>>(config.url);
  const entities = ((data?.[config.key] as Entity[] | undefined) || []);
  return <><PageHeading eyebrow={config.eyebrow} title={config.title} detail={config.detail} />{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}{!loading && !entities.length && <Empty>Nothing here yet.</Empty>}<div className="card-grid">{entities.map((entity, index) => { const entityId = entity.id || entity.fileId; return <article className="entity-card" key={entityId || index}><div className="entity-meta"><span className="pill">{textKey(entity, "status", "contentStatus", "mediaKind") || config.title}</span>{readKey(entity, "sequence") != null && <span>#{String(entity.sequence)}</span>}</div><h2>{textKey(entity, "title", "name", "originalFilename") || `Item ${entityId || index + 1}`}</h2><p>{textKey(entity, "description", "summary", "contentText")}</p>{kind === "files" && entityId && <button className="button button--quiet" onClick={() => void downloadAuthenticated(`/api/files/${entityId}/download`, textKey(entity, "originalFilename") || `file-${entityId}`)}>Download</button>}</article>; })}</div></>;
}

function HatsScreen() {
  const { data, error, loading, reload } = useApi<Record<string, unknown>>("/api/hats");
  const hats = ((data?.hats as Entity[] | undefined) || (data?.catalog as Entity[] | undefined) || []);
  return <><PageHeading eyebrow="Ways of working" title="Hats" detail={String(data?.introduction || "Name a hat when you want a particular working stance.")} />{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}<div className="hat-grid">{hats.map((hat, index) => <article className="hat-card" key={hat.id || index}><div className="hat-shape">{textKey(hat, "label", "title").slice(0, 10)}</div><h2>{textKey(hat, "title", "label", "name")}</h2><p>{textKey(hat, "description", "summary")}</p></article>)}</div></>;
}

function RoutineScreen() {
  const today = localToday(); const start = new Date(`${today}T00:00:00`); const end = new Date(start); end.setDate(end.getDate() + 14);
  const { data, error, loading, reload } = useApi<{ routines: Entity[]; occurrences: Entity[] }>(`/api/calendar-routines/preview?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`);
  return <><PageHeading eyebrow="Reusable rhythms" title="Routine" detail="Patterns become concrete calendar events only when generated." />{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}<div className="card-grid">{data?.routines?.map((routine) => <article className="entity-card" key={routine.id}><span className="pill">Routine</span><h2>{routine.title}</h2><p>{textKey(routine, "description", "recurrenceRule")}</p></article>)}</div></>;
}

function JournalScreen() {
  const { data: trackers, error, loading, reload } = useApi<{ trackers: Entity[] }>("/api/journal-trackers?limit=200");
  const { data: entries } = useApi<{ entries: Entity[] }>("/api/journal-entries?limit=100");
  return <><PageHeading eyebrow="A record of lived time" title="Journal" detail="Trackers and recent entries, kept alongside the calendar without pretending they are appointments." />{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}<div className="journal-layout"><div className="card-grid">{trackers?.trackers?.map((tracker) => <article className="entity-card" key={tracker.id}><span className="pill">Tracker</span><h2>{tracker.name || tracker.title}</h2><p>{textKey(tracker, "description", "unit")}</p></article>)}</div><section className="surface"><h2>Recent entries</h2>{entries?.entries?.map((entry, index) => <div className="journal-entry" key={entry.id || index}><strong>{textKey(entry, "trackerName", "title")}</strong><span>{textKey(entry, "occurredAtUtc", "createdAtUtc")}</span><p>{textKey(entry, "contentText", "text", "numberValue")}</p></div>)}</section></div></>;
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
  const go = (next: string) => { setView(next); history.replaceState(null, "", `#${next}`); };
  const saveToken = (event: FormEvent) => {
    event.preventDefault();
    if (!tokenDraft.trim()) return;
    setAccessToken(tokenDraft);
    setEditingToken(false);
  };
  let screen: ReactNode;
  if (view === "agent") screen = <AgentScreen />;
  else if (view === "calendar") screen = <CalendarScreen />;
  else if (view === "todos") screen = <TodoScreen />;
  else if (view === "contacts") screen = <ContactsScreen />;
  else if (view === "hats") screen = <HatsScreen />;
  else if (view === "routine") screen = <RoutineScreen />;
  else if (view === "journal") screen = <JournalScreen />;
  else if (view === "ai-usage") screen = <UsageScreen />;
  else screen = <GenericScreen kind={view as keyof typeof genericScreens} />;
  return <div className="app-shell"><aside className="sidebar"><a className="brand" href="/app"><img src="/icon.svg" alt="" /><span>Chapeaux<br />Fous</span></a><nav>{navigation.map(([id, label]) => <button className={view === id ? "active" : ""} onClick={() => go(id)} key={id}><span>{label.slice(0, 1)}</span>{label}</button>)}</nav><div className="token-settings">
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
