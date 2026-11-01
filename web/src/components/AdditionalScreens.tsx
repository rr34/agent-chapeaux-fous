import { useEffect, useMemo, useRef, useState } from "react";
import { api, authenticatedObjectUrl, getAccessToken, setAccessToken } from "../api";
import { useApi } from "../hooks";
import type { Entity, SelectedObjectCandidate } from "../types";
import { Empty, ErrorState, Loading } from "./State";
import { ObjectSelectionControls } from "./ObjectSelectionControls";
import { ObjectCard } from "./object-cards/ObjectCard";
import { formatDisplayDate } from "../date-format";

type Participant = { role: string; address: string; display_name: string | null; contact_id: number | null };
type CorrespondenceItem = {
  correspondence_id: number; ref: string; display: string; medium: string; direction: string;
  subject: string | null; body: string | null; delivery_status: string | null; call_disposition: string | null;
  occurred_at_utc: string;
  participants: Participant[]; linked_todos: Array<{ todo_id: number; text: string; status: string }>;
};

function correspondenceIdentity(item: CorrespondenceItem): SelectedObjectCandidate {
  return {
    mention: `@${item.display}`,
    type: "correspondence.item",
    source: "native:correspondence",
    id: item.correspondence_id,
    ref: item.ref,
    display: item.display,
    label: "Correspondence item",
    detail: `Correspondence: ${item.display}\nReference code: correspondence_id=${item.correspondence_id}; ref=${item.ref}`,
  };
}

function correspondencePreview(value: string | null) {
  if (!value) return null;
  const document = new DOMParser().parseFromString(value.replaceAll("<br>", "\n"), "text/html");
  return document.body.textContent?.trim() || null;
}

export function CorrespondenceScreen() {
  const [query, setQuery] = useState("");
  const [medium, setMedium] = useState("");
  const [direction, setDirection] = useState("");
  const [groupBy, setGroupBy] = useState("date");
  const [page, setPage] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const parameters = new URLSearchParams({ limit: "200", offset: String(page * 200) });
  if (query.trim()) parameters.set("q", query.trim());
  if (medium) parameters.set("medium", medium);
  if (direction) parameters.set("direction", direction);
  const { data, error, loading, reload } = useApi<{ items: CorrespondenceItem[] }>(`/api/correspondence?${parameters}`);
  useEffect(() => { setPage(0); }, [query, medium, direction]);
  const groups = useMemo(() => {
    const grouped = new Map<string, CorrespondenceItem[]>();
    for (const item of data?.items || []) {
      const key = groupBy === "medium" ? item.medium
        : groupBy === "direction" ? item.direction
          : groupBy === "contact" ? item.participants.find((participant) => participant.contact_id)?.display_name || "Unmatched participants"
            : item.occurred_at_utc?.slice(0, 10) || "Unknown date";
      grouped.set(key, [...(grouped.get(key) || []), item]);
    }
    return [...grouped.entries()];
  }, [data?.items, groupBy]);
  const sync = async () => {
    setSyncing(true); setNotice("");
    try {
      const result = await api<{ synchronized: number }>("/api/correspondence/email-sync", { method: "POST" });
      setNotice(`Synchronized ${result.synchronized} email${result.synchronized === 1 ? "" : "s"}.`);
      await reload();
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSyncing(false); }
  };
  return <>
    <header className="page-heading"><div><p className="eyebrow">Every channel, one record</p><h1>Correspondence</h1><p>Email, messages, calls, and voicemail consolidated without replacing their authoritative apps.</p></div><button className="button" disabled={syncing} onClick={() => void sync()}>{syncing ? "Syncing…" : "Sync email"}</button></header>
    <div className="section-filter correspondence-filters">
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subject or body" />
      <select value={medium} onChange={(event) => setMedium(event.target.value)}><option value="">All media</option>{["email", "sms", "mms", "call", "voicemail", "chat", "other"].map((value) => <option key={value}>{value}</option>)}</select>
      <select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="">All directions</option><option>inbound</option><option>outbound</option></select>
      <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}><option value="date">Group by date</option><option value="contact">Group by contact</option><option value="medium">Group by medium</option><option value="direction">Group by direction</option></select>
    </div>
    {notice && <p className="status">{notice}</p>}
    {loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}
    {!loading && !error && !groups.length && <Empty>No correspondence matches these filters.</Empty>}
    <div className="library-groups">{groups.map(([name, items]) => <section className="library-group" key={name}><header className="library-group-heading"><h2>{name}</h2><span>{items.length} items</span></header><ul className="library-list">{items.map((item) => <ObjectCard as="li" mode="compact" key={item.correspondence_id} object={{
      id: item.correspondence_id, type: "correspondence.item", label: "Correspondence", display: item.display,
      body: correspondencePreview(item.body), attributes: [
        { label: "Medium", value: item.medium }, { label: "Direction", value: item.direction },
        ...(item.call_disposition ? [{ label: "Call disposition", value: item.call_disposition }] : []),
        { label: "When", value: formatDisplayDate(item.occurred_at_utc) },
        { label: "Participants", value: item.participants.map((participant) => participant.display_name || participant.address).join(", ") || "None" },
      ],
      badges: [item.medium, item.direction, ...(item.linked_todos.length ? [`${item.linked_todos.length} linked to-do${item.linked_todos.length === 1 ? "" : "s"}`] : [])],
    }} controls={<ObjectSelectionControls identity={correspondenceIdentity(item)} subject={`correspondence ${item.display}`} />} details={item.linked_todos.length ? <section><h4>Linked to-dos</h4><ul>{item.linked_todos.map((todo) => <li key={todo.todo_id}>{todo.text}</li>)}</ul></section> : undefined} />)}</ul></section>)}</div>
    {!loading && !error && (page > 0 || (data?.items.length || 0) === 200) && <nav className="correspondence-pages" aria-label="Correspondence pages"><button className="button button--quiet" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><span>Page {page + 1}</span><button className="button button--quiet" disabled={(data?.items.length || 0) < 200} onClick={() => setPage((value) => value + 1)}>Next</button></nav>}
  </>;
}

export function ProfileScreen() {
  const { data, error, loading, reload } = useApi<{ facts: Entity[] }>("/api/profile-facts?status=active");
  const [factType, setFactType] = useState("preference");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await api("/api/profile-facts", { method: "POST", body: JSON.stringify({ factType, text }) }); setText(""); await reload(); }
    finally { setSaving(false); }
  };
  return <><form className="profile-fact-form" onSubmit={(event) => { event.preventDefault(); void save(); }}><label>Fact type<input value={factType} pattern="[a-z][a-z0-9_]*" onChange={(event) => setFactType(event.target.value)} /></label><label>Profile fact<textarea required value={text} onChange={(event) => setText(event.target.value)} /></label><button className="button" disabled={saving}>{saving ? "Saving…" : "Add profile fact"}</button></form>{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}<div className="card-grid">{(data?.facts || []).map((fact) => {
    const identity: SelectedObjectCandidate = {
      mention: `@${String(fact.text).slice(0, 160)}`,
      type: "profile.fact", source: "native:profile", id: Number(fact.id),
      ref: `agent-slayer://profile-facts/${fact.id}`, display: String(fact.text), label: "Profile fact",
      detail: `Profile fact: ${fact.text}\nReference code: profile_fact_id=${fact.id}`,
    };
    return <ObjectCard key={String(fact.id)} object={{ id: Number(fact.id), type: "profile.fact", label: "Profile fact", display: String(fact.text), badges: [String(fact.factType)] }} controls={<ObjectSelectionControls identity={identity} subject={`profile fact ${fact.text}`} />} actions={[{ key: "archive", label: "Archive", onClick: async () => { await api(`/api/profile-facts/${fact.id}`, { method: "DELETE" }); await reload(); } }]} />;
  })}</div></>;
}

export function AccountScreen({ usage }: { usage: React.ReactNode }) {
  const [tab, setTab] = useState<"profile" | "usage" | "access">("profile");
  const [token, setToken] = useState(getAccessToken());
  return <><header className="page-heading"><div><p className="eyebrow">Identity and service</p><h1>Account</h1><p>Your durable profile, model usage, and this browser’s access.</p></div></header><nav className="account-tabs"><button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>Profile</button><button className={tab === "usage" ? "active" : ""} onClick={() => setTab("usage")}>AI usage</button><button className={tab === "access" ? "active" : ""} onClick={() => setTab("access")}>Access</button></nav>{tab === "profile" ? <ProfileScreen /> : tab === "usage" ? usage : <form className="profile-fact-form" onSubmit={(event) => { event.preventDefault(); setAccessToken(token); }}><label>Access token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} /></label><button className="button">Save token</button></form>}</>;
}

export type MusicFile = { fileId: number; title: string; originalFilename: string | null; durationMs: number | null; streamUrl: string; metadata: any; metadataError: string | null };
export function useWebMusicPlayer() {
  const [queue, setQueue] = useState<MusicFile[]>([]);
  const [index, setIndex] = useState(0);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const current = queue[index] || null;
  useEffect(() => {
    let active = true; let objectUrl = "";
    if (!current) { setSource(""); return; }
    void authenticatedObjectUrl(current.streamUrl).then((url) => { if (!active) return; objectUrl = url; setSource(url); }).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [current?.fileId]);
  useEffect(() => { if (source) void audio.current?.play().catch(() => {}); }, [source]);
  return {
    queue, current, error,
    enqueue: (files: MusicFile[]) => setQueue((existing) => [...existing, ...files.filter((file) => !existing.some((item) => item.fileId === file.fileId))]),
    play: (file: MusicFile) => { setQueue((existing) => { const position = existing.findIndex((item) => item.fileId === file.fileId); if (position >= 0) { setIndex(position); return existing; } setIndex(existing.length); return [...existing, file]; }); },
    clear: () => { setQueue([]); setIndex(0); },
    element: current ? <aside className="music-mini-player"><span><small>Now playing</small><strong>{current.title}</strong></span><audio ref={audio} src={source} controls onEnded={() => setIndex((value) => value + 1 < queue.length ? value + 1 : value)} /><button onClick={() => { setQueue([]); setIndex(0); }}>Clear</button></aside> : null,
  };
}

export function MusicScreen({ player }: { player: ReturnType<typeof useWebMusicPlayer> }) {
  const { data, error, loading, reload } = useApi<{ files: MusicFile[] }>("/api/music?limit=500");
  const [query, setQuery] = useState("");
  const files = (data?.files || []).filter((file) => JSON.stringify(file).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const groups = useMemo(() => { const result = new Map<string, MusicFile[]>(); for (const file of files) { const name = file.metadata?.release?.title || file.metadata?.work?.title || "Other music"; result.set(name, [...(result.get(name) || []), file]); } return [...result.entries()]; }, [files]);
  return <><header className="page-heading"><div><p className="eyebrow">Library playback</p><h1>Music</h1><p>Browse the same authenticated music library available on mobile.</p></div>{files.length > 0 && <button className="button" onClick={() => player.enqueue(files)}>Add all to queue</button>}</header><div className="section-filter"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search work, movement, composer, performer, or notes" /></div>{player.error && <p className="form-error">{player.error}</p>}{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}{!loading && !error && !groups.length && <Empty>No music found.</Empty>}<div className="library-groups">{groups.map(([name, tracks]) => <section className="library-group" key={name}><header className="library-group-heading"><h2>{name}</h2><button className="button button--quiet" onClick={() => player.enqueue(tracks)}>Add release</button></header><ul className="music-track-list">{tracks.map((track) => <li key={track.fileId}><span><strong>{track.metadata?.sequence2?.title || track.metadata?.sequence1?.title || track.title}</strong><small>{(track.metadata?.work?.creators || []).join(", ") || track.originalFilename}</small></span><button onClick={() => player.play(track)}>Play</button><button onClick={() => player.enqueue([track])}>Queue</button></li>)}</ul></section>)}</div></>;
}
