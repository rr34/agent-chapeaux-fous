import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { api, authenticatedObjectUrl, getAccessToken, setAccessToken } from "../api";
import { useApi } from "../hooks";
import type { Entity, SelectedObjectCandidate } from "../types";
import { Empty, ErrorState, Loading } from "./State";
import { ObjectSelectionControls } from "./ObjectSelectionControls";
import { ObjectCard } from "./object-cards/ObjectCard";
import { formatDisplayDate } from "../date-format";

type Participant = { role: string; address: string; display_name: string | null; contact_id: number | null };
type CorrespondenceMailbox = { mailbox_id: string; name: string; role: string | null; parent_mailbox_id: string | null };
type CorrespondenceItem = {
  correspondence_id: number; ref: string; display: string; medium: string; direction: string;
  subject: string | null; body: string | null; delivery_status: string | null; call_disposition: string | null;
  occurred_at_utc: string;
  email_keywords: string[]; is_read: boolean | null; mailboxes: CorrespondenceMailbox[];
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

function correspondenceMediumGroup(medium: string) {
  return ["sms", "mms", "rcs", "imessage"].includes(medium) ? "messages" : medium;
}

export function CorrespondenceScreen() {
  const [query, setQuery] = useState("");
  const [medium, setMedium] = useState("");
  const [direction, setDirection] = useState("");
  const [mailbox, setMailbox] = useState("");
  const [groupBy, setGroupBy] = useState("date");
  const [page, setPage] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");
  const parameters = new URLSearchParams({ limit: "200", offset: String(page * 200) });
  if (query.trim()) parameters.set("q", query.trim());
  if (medium) parameters.set("medium", medium);
  if (direction) parameters.set("direction", direction);
  if (mailbox) parameters.set("mailbox", mailbox);
  const { data, error, loading, reload } = useApi<{ items: CorrespondenceItem[]; mailboxes: CorrespondenceMailbox[] }>(`/api/correspondence?${parameters}`);
  useEffect(() => { setPage(0); }, [query, medium, direction, mailbox]);
  const groups = useMemo(() => {
    const grouped = new Map<string, CorrespondenceItem[]>();
    for (const item of data?.items || []) {
      const key = groupBy === "medium" ? correspondenceMediumGroup(item.medium)
        : groupBy === "direction" ? item.direction
          : groupBy === "contact" ? item.participants.find((participant) => participant.contact_id)?.display_name || "Unmatched participants"
            : item.occurred_at_utc?.slice(0, 10) || "Unknown date";
      grouped.set(key, [...(grouped.get(key) || []), item]);
    }
    return [...grouped.entries()];
  }, [data?.items, groupBy]);
  const sync = async () => {
    setSyncing(true); setNotice("");
    let polling = true;
    const poll = window.setInterval(() => { void api<{
      status: string; phase: string | null; processed: number; total: number | null;
    }>("/api/correspondence/email-sync/status").then((status) => {
      if (!polling || status.status !== "running") return;
      const amount = status.total == null ? `${status.processed}` : `${status.processed} of ${status.total}`;
      setNotice(`${status.phase || "Synchronizing email"}: ${amount}`);
    }).catch(() => {}); }, 750);
    try {
      const result = await api<{ synchronized: number; deleted: number; mode: "full" | "incremental" }>("/api/correspondence/email-sync", { method: "POST" });
      setNotice(`${result.mode === "full" ? "Full" : "Incremental"} sync complete: ${result.synchronized} email${result.synchronized === 1 ? "" : "s"} updated${result.deleted ? ` and ${result.deleted} deleted` : ""}.`);
      await reload();
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : String(caught)); }
    finally { polling = false; window.clearInterval(poll); setSyncing(false); }
  };
  return <>
    <header className="page-heading"><div><p className="eyebrow">Every channel, one record</p><h1>Correspondence</h1><p>Email, messages, calls, and voicemail consolidated without replacing their authoritative apps.</p></div><button className="button" disabled={syncing} onClick={() => void sync()}>{syncing ? "Syncing…" : "Sync email"}</button></header>
    <div className="section-filter correspondence-filters">
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subject or body" />
      <select value={medium} onChange={(event) => setMedium(event.target.value)}><option value="">All media</option>{["email", "sms", "mms", "call", "voicemail", "chat", "other"].map((value) => <option key={value}>{value}</option>)}</select>
      <select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="">All directions</option><option>inbound</option><option>outbound</option></select>
      <select aria-label="Email mailbox" value={mailbox} onChange={(event) => setMailbox(event.target.value)}><option value="">All mailboxes</option>{(data?.mailboxes || []).map((value) => <option key={value.mailbox_id} value={value.mailbox_id}>{value.name}</option>)}</select>
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
      badges: [item.medium, item.direction, ...(item.is_read === false ? ["unread"] : []),
        ...item.mailboxes.map((value) => value.name),
        ...(item.linked_todos.length ? [`${item.linked_todos.length} linked to-do${item.linked_todos.length === 1 ? "" : "s"}`] : [])],
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
  return <><form className="profile-fact-form" onSubmit={(event) => { event.preventDefault(); void save(); }}><label>Fact type<input value={factType} pattern="[a-z][a-z0-9_]*" onChange={(event) => setFactType(event.target.value)} /></label><label>Profile fact<textarea required value={text} onChange={(event) => setText(event.target.value)} /></label><button className="button" disabled={saving}>{saving ? "Saving…" : "Add profile fact"}</button></form>{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}<div className="profile-fact-list">{(data?.facts || []).map((fact) => {
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

type MusicSequence = { type: string; number: number | string | null; title: string | null };
type MusicMetadata = {
  release: { type: string | null; title: string | null; version: string | null; trackNumber: number | string | null } | null;
  work: { type: string | null; title: string | null; version: string | null; creators: string[] | null; catalogue: string[] | null };
  sequence1: MusicSequence | null;
  sequence2: MusicSequence | null;
  performers: string[] | null;
  compositionDate: string | null;
  notes: string | null;
};
export type MusicFile = { fileId: number; title: string; originalFilename: string | null; durationMs: number | null; streamUrl: string; metadata: MusicMetadata | null; metadataError: string | null };
type MusicNarration = { narrationId: string; durationMs: number; streamUrl: string };
type NarrationField = "work" | "sequence" | "creators" | "catalogue" | "compositionDate" | "performers" | "notes";
type ConcertItem =
  | { key: string; kind: "music"; file: MusicFile }
  | { key: string; kind: "narration"; file: MusicFile; title: string; text: string; status: "planned" | "generating" | "ready" | "unavailable"; narration: MusicNarration | null };

const narrationChoices: Array<{ field: NarrationField; label: string }> = [
  { field: "work", label: "Work" },
  { field: "sequence", label: "Movement" },
  { field: "creators", label: "Composer" },
  { field: "catalogue", label: "Catalogue" },
  { field: "compositionDate", label: "Date" },
  { field: "performers", label: "Performers" },
  { field: "notes", label: "Notes" },
];

function musicTrackTitle(file: MusicFile) {
  const sequence = file.metadata?.sequence2 || file.metadata?.sequence1;
  if (!sequence) return file.title;
  return `${sequence.number == null ? "" : `${sequence.number}. `}${sequence.title || sequence.type}`;
}

function spokenSequenceText(sequence: MusicSequence) {
  const type = sequence.type === "sequence" ? "section" : sequence.type;
  return `${type}${sequence.number == null ? "" : ` ${sequence.number}`}${sequence.title ? `, ${sequence.title}` : ""}`;
}

function concertIntroduction(file: MusicFile, fields: NarrationField[]) {
  const metadata = file.metadata;
  const sequence = metadata?.sequence2 || metadata?.sequence1;
  const parts: string[] = [];
  if (fields.includes("sequence") && sequence) parts.push(`Next, ${spokenSequenceText(sequence)}.`);
  if (fields.includes("work") && metadata?.work.title) parts.push(`From ${metadata.work.title}.`);
  if (fields.includes("creators") && metadata?.work.creators?.length) parts.push(`By ${metadata.work.creators.join(", ")}.`);
  if (fields.includes("catalogue") && metadata?.work.catalogue?.length) parts.push(`Catalogue ${metadata.work.catalogue.join(", ")}.`);
  if (fields.includes("compositionDate") && metadata?.compositionDate) parts.push(`Composed ${metadata.compositionDate}.`);
  if (fields.includes("performers") && metadata?.performers?.length) parts.push(`Performed by ${metadata.performers.join(", ")}.`);
  if (fields.includes("notes") && metadata?.notes) parts.push(metadata.notes.slice(0, 600));
  return parts.length ? parts.join(" ") : `Next, ${musicTrackTitle(file)}.`;
}

function concertItems(files: MusicFile[], fields: NarrationField[]): ConcertItem[] {
  return files.flatMap((file) => [
    { key: `narration:${file.fileId}`, kind: "narration", file, title: `Introduction to ${musicTrackTitle(file)}`, text: concertIntroduction(file, fields), status: "planned", narration: null },
    { key: `music:${file.fileId}`, kind: "music", file },
  ] as ConcertItem[]);
}

function formatConcertDuration(milliseconds: number) {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

function formatPlaybackTime(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

function concertProgramGroups(files: MusicFile[]) {
  const groups: Array<{ identity: string; title: string; releaseTitle: string | null; eyebrow: string; detail: string; files: MusicFile[] }> = [];
  for (const file of files) {
    const release = file.metadata?.release;
    const work = file.metadata?.work;
    const songsOnRelease = Boolean(release?.title && work?.type === "song");
    const identity = songsOnRelease
      ? JSON.stringify(["release", release?.type, release?.title, release?.version])
      : work?.title ? JSON.stringify(["work", work.type, work.title, work.version, work.creators, work.catalogue]) : `file:${file.fileId}`;
    const last = groups.at(-1);
    if (last?.identity === identity) { last.files.push(file); continue; }
    groups.push({
      identity,
      title: songsOnRelease ? release?.title || file.title : work?.title || file.title,
      releaseTitle: songsOnRelease ? null : release?.title || null,
      eyebrow: `${songsOnRelease ? release?.type || "release" : work?.type || "music"}`,
      detail: songsOnRelease ? release?.version || "" : [...(work?.catalogue || []), ...(work?.creators || [])].join(" · "),
      files: [file],
    });
  }
  return groups;
}

export function useWebMusicPlayer() {
  const [queue, setQueue] = useState<ConcertItem[]>([]);
  const [index, setIndex] = useState(-1);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hasStarted, setHasStarted] = useState(false);
  const [complete, setComplete] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [voiceVolume, setVoiceVolume] = useState(0.5);
  const [fields, setFields] = useState<NarrationField[]>(["work", "sequence", "creators"]);
  const audio = useRef<HTMLAudioElement>(null);
  const queueRef = useRef<ConcertItem[]>([]);
  const playbackVersion = useRef(0);
  const changing = useRef(false);
  const narrationPromises = useRef(new Map<string, Promise<ConcertItem | null>>());
  const current = index >= 0 ? queue[index] || null : null;
  const musicItems = queue.filter((item): item is Extract<ConcertItem, { kind: "music" }> => item.kind === "music");
  const duration = musicItems.reduce((total, item) => total + (item.file.durationMs || 0), 0);
  const durationKnown = musicItems.every((item) => (item.file.durationMs || 0) > 0);
  const summary = `${musicItems.length} ${musicItems.length === 1 ? "track" : "tracks"} · ${musicItems.length} spoken · ${durationKnown ? formatConcertDuration(duration) : "duration unavailable"}`;

  const updateQueue = (update: (previous: ConcertItem[]) => ConcertItem[]) => {
    setQueue((previous) => {
      const next = update(previous);
      queueRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    let active = true; let objectUrl = "";
    if (!current) { setSource(""); return; }
    setSource("");
    setPlaying(false);
    setPlaybackSeconds(0);
    setDurationSeconds(0);
    const streamUrl = current.kind === "music" ? current.file.streamUrl : current.narration?.streamUrl;
    if (!streamUrl) return;
    void authenticatedObjectUrl(streamUrl).then((url) => { if (!active) return; objectUrl = url; setSource(url); }).catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [current?.key]);
  useEffect(() => { if (source) void audio.current?.play().catch(() => setNotice("Concert is ready. Press play to continue.")); }, [source]);
  useEffect(() => {
    if (audio.current && current) audio.current.volume = current.kind === "narration" ? voiceVolume : 1;
  }, [current?.key, source, voiceVolume]);

  const prepareNarration = async (requestedIndex: number, version: number) => {
    const item = queueRef.current[requestedIndex];
    if (!item || item.kind !== "narration") return item || null;
    if (item.status === "ready" && item.narration) return item;
    const existing = narrationPromises.current.get(item.key);
    if (existing) return existing;
    const promise = (async () => {
      updateQueue((items) => items.map((candidate) => candidate.key === item.key && candidate.kind === "narration" ? { ...candidate, status: "generating" } : candidate));
      try {
        const result = await api<{ narration: MusicNarration }>("/api/music/narrations", { method: "POST", body: JSON.stringify({ text: item.text }) });
        if (version !== playbackVersion.current) return null;
        const ready: ConcertItem = { ...item, status: "ready", narration: result.narration };
        updateQueue((items) => items.map((candidate) => candidate.key === item.key ? ready : candidate));
        return ready;
      } catch {
        if (version !== playbackVersion.current) return null;
        updateQueue((items) => items.map((candidate) => candidate.key === item.key && candidate.kind === "narration" ? { ...candidate, status: "unavailable", narration: null } : candidate));
        return null;
      } finally {
        narrationPromises.current.delete(item.key);
      }
    })();
    narrationPromises.current.set(item.key, promise);
    return promise;
  };

  const playAt = async (requestedIndex: number) => {
    if (changing.current) return;
    const version = playbackVersion.current;
    changing.current = true;
    setTransitioning(true);
    try {
      let nextIndex = requestedIndex;
      while (nextIndex < queueRef.current.length) {
        let item = queueRef.current[nextIndex];
        if (!item) break;
        if (item.kind === "narration" && (!item.narration || item.status !== "ready")) {
          setNotice(`Preparing AI voice: ${item.title}`);
          const prepared = await prepareNarration(nextIndex, version);
          if (version !== playbackVersion.current) return;
          if (!prepared) {
            setNotice(`AI voice unavailable. Continuing with ${musicTrackTitle(item.file)}.`);
            nextIndex += 1;
            continue;
          }
          item = prepared;
        }
        setError("");
        setNotice("");
        setIndex(nextIndex);
        if (item.kind === "music") {
          const nextNarration = queueRef.current.findIndex((candidate, candidateIndex) => candidateIndex > nextIndex && candidate.kind === "narration");
          if (nextNarration >= 0) void prepareNarration(nextNarration, version);
        }
        return;
      }
      setIndex(-1);
      setComplete(true);
      setNotice("Concert complete. Playback stopped.");
    } finally {
      if (version === playbackVersion.current) {
        changing.current = false;
        setTransitioning(false);
      }
    }
  };

  const clear = () => {
    playbackVersion.current += 1;
    changing.current = false;
    narrationPromises.current.clear();
    audio.current?.pause();
    updateQueue(() => []);
    setIndex(-1);
    setHasStarted(false);
    setComplete(false);
    setTransitioning(false);
    setNotice("Concert cleared.");
    setError("");
  };

  const enqueue = (files: MusicFile[]) => {
    if (hasStarted) return;
    const present = new Set(queueRef.current.filter((item) => item.kind === "music").map((item) => item.file.fileId));
    const additions = files.filter((file) => !present.has(file.fileId));
    if (!additions.length) { setNotice("That music is already in the concert."); return; }
    updateQueue((items) => [...items, ...concertItems(additions, fields)]);
    setNotice(`${additions.length} ${additions.length === 1 ? "track" : "tracks"} added to the concert.`);
  };

  const start = () => {
    if (!musicItems.length || transitioning) return;
    setHasStarted(true);
    setComplete(false);
    void playAt(0);
  };

  const toggleField = (field: NarrationField) => {
    if (hasStarted) return;
    const nextFields = fields.includes(field) ? fields.filter((candidate) => candidate !== field) : [...fields, field];
    if (!nextFields.length) { setNotice("Keep at least one spoken metadata field."); return; }
    setFields(nextFields);
    updateQueue((items) => items.map((item) => item.kind === "narration" ? { ...item, text: concertIntroduction(item.file, nextFields), status: "planned", narration: null } : item));
  };

  const remove = (fileId: number) => {
    if (hasStarted) return;
    updateQueue((items) => items.filter((item) => item.file.fileId !== fileId));
    setNotice("Track removed from the concert.");
  };

  const togglePlayback = () => {
    const element = audio.current;
    if (!element || !source) return;
    if (element.paused) void element.play().catch(() => setNotice("Concert is ready. Press play to continue."));
    else element.pause();
  };

  const seek = (seconds: number) => {
    const element = audio.current;
    if (!element) return;
    element.currentTime = seconds;
    setPlaybackSeconds(seconds);
  };

  const progress = durationSeconds > 0 ? Math.min(100, playbackSeconds / durationSeconds * 100) : 0;

  return {
    queue, musicItems, current, error, notice, fields, hasStarted, complete, transitioning, summary, voiceVolume, setVoiceVolume, enqueue, remove, clear, start, toggleField,
    element: queue.length ? <aside className="music-mini-player" aria-label="Concert player"><span><small>{current ? current.kind === "narration" ? "AI voice · Now playing" : "Now playing" : complete ? "Concert complete" : "Concert ready"}</small><strong>{current ? current.kind === "narration" ? current.title : musicTrackTitle(current.file) : summary}</strong></span>{current ? <div className="music-player-transport"><button className="music-player-toggle" aria-label={playing ? "Pause concert" : "Play concert"} disabled={!source} onClick={togglePlayback}>{playing ? "❚❚" : "▶"}</button><div className="music-player-timeline"><input aria-label="Playback position" aria-valuetext={`${formatPlaybackTime(playbackSeconds)} of ${formatPlaybackTime(durationSeconds)}`} max={durationSeconds || 0} min="0" step="0.1" type="range" value={Math.min(playbackSeconds, durationSeconds || 0)} onChange={(event) => seek(Number(event.target.value))} style={{ "--music-progress": `${progress}%` } as CSSProperties} /><div><time>{formatPlaybackTime(playbackSeconds)}</time><time>{formatPlaybackTime(durationSeconds)}</time></div></div><audio ref={audio} src={source} preload="auto" onDurationChange={(event) => setDurationSeconds(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onEnded={() => { setPlaying(false); void playAt(index + 1); }} onLoadedMetadata={(event) => setDurationSeconds(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} onTimeUpdate={(event) => setPlaybackSeconds(event.currentTarget.currentTime)} /></div> : <button className="button" disabled={transitioning} onClick={start}>{transitioning ? "Preparing AI voice…" : complete ? "Replay concert" : "Start concert"}</button>}<button className="button button--quiet" onClick={clear}>Clear</button></aside> : null,
  };
}

export function MusicScreen({ player }: { player: ReturnType<typeof useWebMusicPlayer> }) {
  const { data, error, loading, reload } = useApi<{ files: MusicFile[] }>("/api/music?limit=500");
  const [query, setQuery] = useState("");
  const files = (data?.files || []).filter((file) => JSON.stringify(file).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const groups = useMemo(() => { const result = new Map<string, MusicFile[]>(); for (const file of files) { const name = file.metadata?.release?.title || file.metadata?.work?.title || "Other music"; result.set(name, [...(result.get(name) || []), file]); } return [...result.entries()]; }, [files]);
  const programGroups = concertProgramGroups(player.musicItems.map((item) => item.file));
  const programPositions = new Map(player.musicItems.map((item, position) => [item.file.fileId, position + 1]));
  return <><header className="page-heading"><div><p className="eyebrow">Concert builder</p><h1>Music</h1><p>Build one guided program, then play it as a concert. Library selections never start playback.</p></div>{files.length > 0 && <button className="button" disabled={player.hasStarted} onClick={() => player.enqueue(files)}>Add all results</button>}</header>
    {player.musicItems.length > 0 && <section className="concert-queue" aria-labelledby="concert-queue-heading"><header className="concert-queue-heading"><div><p className="eyebrow">One playback queue</p><h2 id="concert-queue-heading">Your concert</h2><p>{player.summary}</p></div><div className="concert-queue-actions">{!player.current && <button className="button" disabled={player.transitioning} onClick={player.start}>{player.transitioning ? "Preparing AI voice…" : player.complete ? "Replay concert" : "Start concert"}</button>}<button className="button button--quiet" onClick={player.clear}>Clear</button></div></header><div className="concert-guidance"><strong>Spoken introductions</strong><p>An AI voice introduces every track. Choose what it announces before the concert begins.</p><label className="concert-voice-volume"><span>AI voice volume <strong>{Math.round(player.voiceVolume * 100)}%</strong></span><input aria-label="AI voice volume" type="range" min="0" max="100" step="10" value={Math.round(player.voiceVolume * 100)} onChange={(event) => player.setVoiceVolume(Number(event.target.value) / 100)} /><small>Relative to music · adjustable during playback</small></label><div className="concert-guidance-fields">{narrationChoices.map(({ field, label }) => <button className={player.fields.includes(field) ? "is-selected" : ""} aria-pressed={player.fields.includes(field)} disabled={player.hasStarted} key={field} onClick={() => player.toggleField(field)}>{label}</button>)}</div>{player.hasStarted && <small>This concert is fixed while it is playing. Clear it to build another.</small>}</div><div className="concert-program-groups">{programGroups.map((group) => <section className="concert-program-group" key={group.identity}><header>{group.releaseTitle && <small>{group.releaseTitle}</small>}<span>{group.eyebrow} · {group.files.length} {group.files.length === 1 ? "selection" : "selections"}</span><h3>{group.title}</h3>{group.detail && <p>{group.detail}</p>}</header><ol className="concert-program">{group.files.flatMap((file) => { const narration = player.queue.find((item) => item.kind === "narration" && item.file.fileId === file.fileId); const music = player.queue.find((item) => item.kind === "music" && item.file.fileId === file.fileId); return [<li className={`concert-program-narration${player.current?.key === narration?.key ? " is-current" : ""}`} key={`narration:${file.fileId}`}><span className="concert-program-narration-icon">◇</span><span><small>{narration?.kind === "narration" && narration.status === "generating" ? "AI voice · Generating…" : narration?.kind === "narration" && narration.status === "ready" ? "AI voice · Ready" : narration?.kind === "narration" && narration.status === "unavailable" ? "AI voice · Unavailable — will skip" : "AI voice · Will generate"}</small><strong>{narration?.kind === "narration" ? narration.title : `Introduction to ${musicTrackTitle(file)}`}</strong>{narration?.kind === "narration" && <small>{narration.text}</small>}</span></li>, <li className={player.current?.key === music?.key ? "is-current" : ""} key={`music:${file.fileId}`}><span className="concert-program-number">{programPositions.get(file.fileId)}</span><span>{player.current?.key === music?.key && <small>Now playing</small>}<strong>{musicTrackTitle(file)}</strong><small>{file.metadata?.performers?.join(" · ") || file.originalFilename}</small></span>{!player.hasStarted && <button className="button button--quiet" onClick={() => player.remove(file.fileId)}>Remove</button>}</li>]; })}</ol></section>)}</div></section>}
    {(player.notice || player.error) && <p className={player.error ? "form-error" : "status"}>{player.error || player.notice}</p>}
    <div className="section-filter"><input aria-label="Filter music" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search work, movement, composer, performer, or notes" /></div>{loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}{!loading && !error && !groups.length && <Empty>No music found.</Empty>}<div className="library-groups">{groups.map(([name, tracks]) => <section className="library-group" key={name}><header className="library-group-heading"><h2>{name}</h2><button className="button button--quiet" disabled={player.hasStarted} onClick={() => player.enqueue(tracks)}>Add release</button></header><ul className="music-track-list">{tracks.map((track) => <li key={track.fileId}><span><strong>{musicTrackTitle(track)}</strong><small>{(track.metadata?.work.creators || []).join(", ") || track.originalFilename}</small></span><button className="button button--quiet" disabled={player.hasStarted || player.musicItems.some((item) => item.file.fileId === track.fileId)} aria-label={`Add ${musicTrackTitle(track)} to concert`} onClick={() => player.enqueue([track])}>+</button></li>)}</ul></section>)}</div></>;
}
