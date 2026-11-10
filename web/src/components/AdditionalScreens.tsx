import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { api, authenticatedObjectUrl, downloadAuthenticated, getAccessToken, setAccessToken } from "../api";
import { useApi } from "../hooks";
import type { Entity, SelectedObjectCandidate } from "../types";
import { Empty, ErrorState, Loading } from "./State";
import { ObjectSelectionControls } from "./ObjectSelectionControls";
import { ObjectCard } from "./object-cards/ObjectCard";
import { formatDisplayDate } from "../date-format";

type Participant = { role: string; address: string; display_name: string | null; contact_id: number | null };
type CorrespondenceMailbox = { mailbox_id: string; name: string; role: string | null; parent_mailbox_id: string | null };
type CorrespondenceCalendarEvent = {
  calendar_event_id: number; title: string; starts_at_utc: string; ends_at_utc: string | null;
  time_zone: string | null; is_all_day: boolean; status: string;
};
type CorrespondenceItem = {
  correspondence_id: number; ref: string; display: string; medium: string; direction: string;
  subject: string | null; body: string | null; delivery_status: string | null; call_disposition: string | null;
  occurred_at_utc: string;
  email_keywords: string[]; is_read: boolean | null; mailboxes: CorrespondenceMailbox[];
  participants: Participant[]; linked_todos: Array<{ todo_id: number; text: string; status: string }>;
  linked_calendar_events: CorrespondenceCalendarEvent[];
};
type CorrespondenceContactGroup = {
  contact_id: number; display_name: string; tags: Array<{ slug: string; label: string }>;
  correspondence_count: number; earliest_at_utc: string; latest_at_utc: string;
  media: string[]; directions: string[];
};
type CorrespondenceContactTag = { slug: string; label: string; contact_count: number };
type MessageSyncProgress = {
  status: "pending" | "running" | "complete" | "error" | "cancelled";
  completed: number;
  total: number;
  updatedAtMs: number;
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

function syncDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function messageHistoryLabel(mode: string) {
  return ({ incremental: "Since last sync", days_30: "Last 30 days", days_90: "Last 90 days", days_365: "Last year", all: "All available history" } as Record<string, string>)[mode] || "Since last sync";
}

function localDateBoundary(value: string) {
  return value ? new Date(`${value}T00:00:00`).toISOString() : "";
}

export function CorrespondenceScreen() {
  const [query, setQuery] = useState("");
  const [medium, setMedium] = useState("");
  const [direction, setDirection] = useState("");
  const [mailbox, setMailbox] = useState("");
  const [participantTag, setParticipantTag] = useState("");
  const [occurredFromDate, setOccurredFromDate] = useState("");
  const [occurredBeforeDate, setOccurredBeforeDate] = useState("");
  const [groupBy, setGroupBy] = useState("date");
  const [page, setPage] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncingMessages, setSyncingMessages] = useState(false);
  const [messageSyncProgress, setMessageSyncProgress] = useState<MessageSyncProgress | null>(null);
  const [choosingMessageHistory, setChoosingMessageHistory] = useState(false);
  const [messageHistoryMode, setMessageHistoryMode] = useState("incremental");
  const [downloadingExtension, setDownloadingExtension] = useState(false);
  const [notice, setNotice] = useState("");
  const parameters = new URLSearchParams({ limit: "200", offset: String(page * 200) });
  if (query.trim()) parameters.set("q", query.trim());
  if (medium) parameters.set("medium", medium);
  if (direction) parameters.set("direction", direction);
  if (mailbox) parameters.set("mailbox", mailbox);
  if (participantTag) parameters.set("participantTag", participantTag);
  if (occurredFromDate) parameters.set("occurredFromUtc", localDateBoundary(occurredFromDate));
  if (occurredBeforeDate) parameters.set("occurredBeforeUtc", localDateBoundary(occurredBeforeDate));
  if (groupBy === "contact") parameters.set("groupBy", "contact");
  const { data, error, loading, reload } = useApi<{
    items: CorrespondenceItem[]; contact_groups: CorrespondenceContactGroup[];
    mailboxes: CorrespondenceMailbox[]; contact_tags: CorrespondenceContactTag[]; has_more: boolean;
  }>(`/api/correspondence?${parameters}`);
  useEffect(() => { setPage(0); }, [query, medium, direction, mailbox, participantTag, occurredFromDate, occurredBeforeDate, groupBy]);
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
    try {
      await api("/api/correspondence/email-sync", { method: "POST" });
      let result: { synchronized: number; deleted: number; mode: "full" | "incremental" } | null = null;
      while (!result) {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        const status = await api<{
          status: string; phase: string | null; processed: number; total: number | null;
          error?: string; result?: { synchronized: number; deleted: number; mode: "full" | "incremental" };
        }>("/api/correspondence/email-sync/status");
        const amount = status.total == null ? `${status.processed}` : `${status.processed} of ${status.total}`;
        setNotice(`${status.phase || "Synchronizing email"}: ${amount}`);
        if (status.status === "error") throw new Error(status.error || "Email synchronization failed");
        if (status.status === "complete" && status.result) result = status.result;
      }
      setNotice(`${result.mode === "full" ? "Full" : "Incremental"} sync complete: ${result.synchronized} email${result.synchronized === 1 ? "" : "s"} updated${result.deleted ? ` and ${result.deleted} deleted` : ""}.`);
      await reload();
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSyncing(false); }
  };
  const downloadExtension = async () => {
    setDownloadingExtension(true); setNotice("");
    try {
      await downloadAuthenticated(
        "/api/extensions/google-messages-sync/download",
        "time-v3-google-messages-sync.zip",
      );
      setNotice("Extension downloaded. Extract the ZIP, then use Load unpacked in brave://extensions and select the extracted folder.");
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : String(caught)); }
    finally { setDownloadingExtension(false); }
  };
  const syncMessages = async () => {
    setChoosingMessageHistory(false);
    setMessageSyncProgress(null);
    setSyncingMessages(true); setNotice("");
    try {
      const requested = await api<{ requestId: string }>(
        "/api/correspondence/google-messages-sync/request",
        { method: "POST", body: JSON.stringify({ accountKey: "default", historyMode: messageHistoryMode }) },
      );
      let complete = false;
      while (!complete) {
        const status = await api<{
          status: "pending" | "running" | "complete" | "error" | "cancelled";
          phase: string; error: string | null; historyMode: string; createdAtMs: number; updatedAtMs: number;
          conversationIndex: number; conversationCount: number;
          messagesRead: number; messagesAccepted: number; messagesCreated: number;
          messagesUpdated: number; messagesDeduplicated: number; messagesAmbiguous: number;
          unresolvedParticipants: number; undatedSkipped: number;
        }>(`/api/correspondence/google-messages-sync/request/${requested.requestId}`);
        const conversation = status.conversationCount
          ? `Conversation ${Math.min(status.conversationCount, status.conversationIndex + 1)} of ${status.conversationCount}`
          : "Waiting for conversation discovery";
        const elapsed = Math.max(0, Date.now() - status.createdAtMs);
        const completed = status.status === "complete"
          ? status.conversationCount
          : Math.min(status.conversationCount, status.conversationIndex);
        const remaining = status.status === "running" && completed > 0
          ? (elapsed / completed) * Math.max(0, status.conversationCount - completed)
          : null;
        setMessageSyncProgress({
          status: status.status,
          completed,
          total: status.conversationCount,
          updatedAtMs: status.updatedAtMs,
        });
        setNotice([
          status.phase,
          conversation,
          `History range ${messageHistoryLabel(status.historyMode)}`,
          `Elapsed ${syncDuration(elapsed)}${remaining == null ? "" : ` · rough remaining ${syncDuration(remaining)}`}`,
          `Read ${status.messagesRead.toLocaleString()} · accepted ${status.messagesAccepted.toLocaleString()}`,
          `New ${status.messagesCreated.toLocaleString()} · refreshed ${status.messagesUpdated.toLocaleString()} · deduplicated ${status.messagesDeduplicated.toLocaleString()}`,
          `Ambiguous duplicates ${status.messagesAmbiguous.toLocaleString()} · unresolved participants ${status.unresolvedParticipants.toLocaleString()}`,
          status.undatedSkipped ? `Skipped without usable time ${status.undatedSkipped.toLocaleString()}` : "",
        ].filter(Boolean).join("\n"));
        if (status.status === "error" || status.status === "cancelled") {
          throw new Error(status.error || `Google Messages synchronization ${status.status}.`);
        }
        complete = status.status === "complete";
        if (!complete) await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      await reload();
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSyncingMessages(false); }
  };
  return <>
    <header className="page-heading"><div><p className="eyebrow">Every channel, one record</p><h1>Correspondence</h1><p>Email, messages, calls, and voicemail consolidated without replacing their authoritative apps.</p></div><div className="heading-actions"><button className="button button--quiet" disabled={downloadingExtension} onClick={() => void downloadExtension()}>{downloadingExtension ? "Downloading…" : "Download Messages extension"}</button><button className="button" disabled={syncing} onClick={() => void sync()}>{syncing ? "Syncing…" : "Sync email"}</button><button className="button" disabled={syncingMessages} onClick={() => setChoosingMessageHistory(true)}>{syncingMessages ? "Syncing…" : "Sync Google Messages"}</button></div></header>
    {choosingMessageHistory && <div className="object-editor-backdrop"><section className="object-editor message-history-dialog" role="dialog" aria-modal="true" aria-labelledby="message-history-heading"><form onSubmit={(event) => { event.preventDefault(); void syncMessages(); }}><header className="object-editor-heading"><div><p className="eyebrow">Google Messages</p><h2 id="message-history-heading">Choose history range</h2></div></header><label>Messages to synchronize<select autoFocus value={messageHistoryMode} onChange={(event) => setMessageHistoryMode(event.target.value)}><option value="incremental">Since last sync</option><option value="days_30">Last 30 days</option><option value="days_90">Last 90 days</option><option value="days_365">Last year</option><option value="all">All available history</option></select></label><p className="object-editor-note">On the first run, “Since last sync” imports 30 days. Later runs overlap the previous successful sync by two days.</p><footer className="object-editor-actions"><button className="button button--quiet" type="button" onClick={() => setChoosingMessageHistory(false)}>Cancel</button><button className="button" type="submit">Start sync</button></footer></form></section></div>}
    <div className="section-filter correspondence-filters">
      <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subject or body" />
      <select value={medium} onChange={(event) => setMedium(event.target.value)}><option value="">All media</option>{["email", "sms", "mms", "rcs", "imessage", "whatsapp", "chat", "call", "voicemail", "other"].map((value) => <option key={value}>{value}</option>)}</select>
      <select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="">All directions</option><option>inbound</option><option>outbound</option></select>
      <select aria-label="Email mailbox" value={mailbox} onChange={(event) => setMailbox(event.target.value)}><option value="">All mailboxes</option>{(data?.mailboxes || []).map((value) => <option key={value.mailbox_id} value={value.mailbox_id}>{value.name}</option>)}</select>
      <select aria-label="Participant contact tag" value={participantTag} onChange={(event) => setParticipantTag(event.target.value)}><option value="">All contact tags</option>{(data?.contact_tags || []).map((tag) => <option key={tag.slug} value={tag.slug}>{tag.label} ({tag.contact_count})</option>)}</select>
      <input aria-label="Correspondence from date" type="date" value={occurredFromDate} onChange={(event) => setOccurredFromDate(event.target.value)} />
      <input aria-label="Correspondence before date" type="date" value={occurredBeforeDate} min={occurredFromDate || undefined} onChange={(event) => setOccurredBeforeDate(event.target.value)} />
      <select value={groupBy} onChange={(event) => setGroupBy(event.target.value)}><option value="date">Group by date</option><option value="contact">Group by contact</option><option value="medium">Group by medium</option><option value="direction">Group by direction</option></select>
    </div>
    {syncingMessages && messageSyncProgress && <section className="message-sync-progress" aria-live="polite"><div className="message-sync-progress-heading"><strong>{messageSyncProgress.total ? `${messageSyncProgress.completed} of ${messageSyncProgress.total} conversations complete` : "Discovering conversations"}</strong>{messageSyncProgress.total > 0 && <span>{Math.round((messageSyncProgress.completed / messageSyncProgress.total) * 100)}%</span>}</div><progress max={messageSyncProgress.total || undefined} value={messageSyncProgress.total ? messageSyncProgress.completed : undefined} /><small>{Date.now() - messageSyncProgress.updatedAtMs > 30_000 ? `No new progress for ${syncDuration(Date.now() - messageSyncProgress.updatedAtMs)}. Automatic recovery will reload the Messages tab after 90 seconds.` : `Last activity ${syncDuration(Date.now() - messageSyncProgress.updatedAtMs)} ago.`}</small></section>}
    {notice && <p className="status correspondence-sync-status">{notice}</p>}
    {loading && <Loading />}{error && <ErrorState error={error} retry={reload} />}
    {!loading && !error && groupBy === "contact" && !(data?.contact_groups.length || 0) && <Empty>No contacts match these correspondence filters.</Empty>}
    {!loading && !error && groupBy !== "contact" && !groups.length && <Empty>No correspondence matches these filters.</Empty>}
    {groupBy === "contact" && <div className="library-groups">{(data?.contact_groups || []).map((contact) => <ObjectCard mode="compact" key={contact.contact_id} object={{
      id: contact.contact_id, type: "contacts.contact", label: "Contact", display: contact.display_name,
      attributes: [
        { label: "Correspondence", value: String(contact.correspondence_count) },
        { label: "Most recent", value: formatDisplayDate(contact.latest_at_utc) },
        { label: "First in range", value: formatDisplayDate(contact.earliest_at_utc) },
        { label: "Media", value: contact.media.join(", ") },
        { label: "Directions", value: contact.directions.join(", ") },
      ],
      badges: contact.tags.map((tag) => tag.label),
    }} controls={<ObjectSelectionControls identity={{
      mention: `@${contact.display_name}`, type: "contacts.contact", source: "native:contacts",
      id: contact.contact_id, ref: `agent-slayer://contacts/${contact.contact_id}`,
      display: contact.display_name, label: "Contact",
      detail: `Contact: ${contact.display_name}\nReference code: contact_id=${contact.contact_id}`,
    }} subject={`contact ${contact.display_name}`} />} />)}</div>}
    {groupBy !== "contact" && <div className="library-groups">{groups.map(([name, items]) => <section className="library-group" key={name}><header className="library-group-heading"><h2>{name}</h2><span>{items.length} items</span></header><ul className="library-list">{items.map((item) => <ObjectCard as="li" mode="compact" key={item.correspondence_id} object={{
      id: item.correspondence_id, type: "correspondence.item", label: "Correspondence", display: item.display,
      body: correspondencePreview(item.body), attributes: [
        { label: "Medium", value: item.medium }, { label: "Direction", value: item.direction },
        ...(item.call_disposition ? [{ label: "Call disposition", value: item.call_disposition }] : []),
        { label: "When", value: formatDisplayDate(item.occurred_at_utc) },
        { label: "Participants", value: item.participants.map((participant) => participant.display_name || participant.address).join(", ") || "None" },
      ],
      badges: [item.medium, item.direction, ...(item.is_read === false ? ["unread"] : []),
        ...item.mailboxes.map((value) => value.name),
        ...(item.linked_todos.length ? [`${item.linked_todos.length} linked to-do${item.linked_todos.length === 1 ? "" : "s"}`] : []),
        ...(item.linked_calendar_events.length ? [`${item.linked_calendar_events.length} linked event${item.linked_calendar_events.length === 1 ? "" : "s"}`] : [])],
    }} controls={<ObjectSelectionControls identity={correspondenceIdentity(item)} subject={`correspondence ${item.display}`} />} details={item.linked_todos.length || item.linked_calendar_events.length ? <>
      {item.linked_todos.length > 0 && <section><h4>Linked to-dos</h4><ul>{item.linked_todos.map((todo) => <li key={todo.todo_id}>{todo.text}</li>)}</ul></section>}
      {item.linked_calendar_events.length > 0 && <section><h4>Linked calendar events</h4><ul>{item.linked_calendar_events.map((event) => <li key={event.calendar_event_id}>{event.title} · {formatDisplayDate(event.starts_at_utc, { timeZone: event.time_zone || undefined })}</li>)}</ul></section>}
    </> : undefined} />)}</ul></section>)}</div>}
    {!loading && !error && (page > 0 || data?.has_more) && <nav className="correspondence-pages" aria-label="Correspondence pages"><button className="button button--quiet" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</button><span>Page {page + 1}</span><button className="button button--quiet" disabled={!data?.has_more} onClick={() => setPage((value) => value + 1)}>Next</button></nav>}
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

type AccountPerson = {
  personId: number;
  displayName: string;
  kind: "primary" | "managed";
  weeklyAiTokenLimit: number;
};

function IdentitiesScreen() {
  const { data, error, loading, reload } = useApi<{
    account: { displayName: string; email: string };
    selectedPerson: AccountPerson;
    people: AccountPerson[];
  }>("/api/account/people");
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [nodeCode, setNodeCode] = useState("");
  const [nodeAction, setNodeAction] = useState("");
  const { data: nodeData, error: nodeError, loading: nodesLoading, reload: reloadNodes } = useApi<{
    devices: Array<{
      node_device_id: number; device_name: string; hardware_identifier: string | null;
      token_prefix: string; device_status: "active" | "revoked"; created_at_utc: string;
      last_seen_at_utc: string | null;
    }>;
  }>("/api/node/devices");
  const createIdentity = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setStatus("");
    try {
      await api("/api/account/people", { method: "POST", body: JSON.stringify({ displayName }) });
      setDisplayName(""); setStatus("Managed Agent identity created."); await reload();
    } catch (caught) { setStatus(caught instanceof Error ? caught.message : String(caught)); }
    finally { setSaving(false); }
  };
  const selectIdentity = async (personId: number) => {
    setStatus("");
    try {
      await api(`/api/account/people/${personId}/select`, { method: "POST", body: "{}" });
      window.location.assign("/app");
    } catch (caught) { setStatus(caught instanceof Error ? caught.message : String(caught)); }
  };
  const approveNode = async (event: React.FormEvent) => {
    event.preventDefault(); setNodeAction("approve"); setStatus("");
    try {
      const result = await api<{ deviceName: string }>("/api/node/pairings/approve", {
        method: "POST", body: JSON.stringify({ userCode: nodeCode }),
      });
      setNodeCode(""); setStatus(`${result.deviceName} is approved. The node can finish linking now.`);
      await reloadNodes();
    } catch (caught) { setStatus(caught instanceof Error ? caught.message : String(caught)); }
    finally { setNodeAction(""); }
  };
  const revokeNode = async (nodeDeviceId: number) => {
    setNodeAction(`revoke:${nodeDeviceId}`); setStatus("");
    try {
      await api(`/api/node/devices/${nodeDeviceId}`, { method: "DELETE" });
      setStatus("Node access revoked."); await reloadNodes();
    } catch (caught) { setStatus(caught instanceof Error ? caught.message : String(caught)); }
    finally { setNodeAction(""); }
  };
  return <>
    {loading && <Loading label="Loading Agent identities" />}
    {error && <ErrorState error={error} retry={reload} />}
    {data && <section className="surface"><div className="section-title"><div><p className="eyebrow">Signed-in account</p><h2>{data.account.displayName}</h2><p>{data.account.email}</p></div></div>
      <div className="integration-list">{data.people.map((person) => <article className={`integration-card${person.personId === data.selectedPerson.personId ? " ready" : ""}`} key={person.personId}>
        <div><strong>{person.displayName}</strong><span>{person.kind === "primary" ? "Primary identity" : "Managed identity"}{person.personId === data.selectedPerson.personId ? " · Active" : ""}</span></div>
        {person.personId !== data.selectedPerson.personId && <button className="button button--quiet" type="button" onClick={() => void selectIdentity(person.personId)}>Use identity</button>}
      </article>)}</div>
    </section>}
    <form className="profile-fact-form" onSubmit={(event) => void createIdentity(event)}>
      <label>New identity label<input required maxLength={200} placeholder="Second Agent" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <button className="button" disabled={saving}>{saving ? "Creating…" : "Create managed identity"}</button>
    </form>
    <section className="surface">
      <div className="section-title"><div><p className="eyebrow">Hardware access</p><h2>Node devices</h2><p>A node belongs to the currently active Agent identity only.</p></div></div>
      <form className="integration-add-form" onSubmit={(event) => void approveNode(event)}>
        <label>Pairing code<input required autoComplete="off" maxLength={9} placeholder="ABCD-2345" value={nodeCode} onChange={(event) => setNodeCode(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/gu, "").slice(0, 9))} /></label>
        <button className="button" disabled={Boolean(nodeAction)}>{nodeAction === "approve" ? "Approving…" : "Approve node"}</button>
      </form>
      {nodesLoading && <Loading label="Loading node devices" />}
      {Boolean(nodeError) && <ErrorState error={nodeError} retry={reloadNodes} />}
      <div className="integration-list">{(nodeData?.devices || []).map((device) => <article className={`integration-card${device.device_status === "active" ? " ready" : ""}`} key={device.node_device_id}>
        <div><strong>{device.device_name}</strong><span>{device.device_status === "active" ? `Active · key ${device.token_prefix}…` : "Revoked"}{device.hardware_identifier ? ` · ${device.hardware_identifier}` : ""}{device.last_seen_at_utc ? ` · last used ${new Date(device.last_seen_at_utc).toLocaleString()}` : ""}</span></div>
        {device.device_status === "active" && <button className="button button--quiet" type="button" disabled={Boolean(nodeAction)} onClick={() => void revokeNode(device.node_device_id)}>{nodeAction === `revoke:${device.node_device_id}` ? "Revoking…" : "Revoke"}</button>}
      </article>)}</div>
      {!nodesLoading && !nodeError && !nodeData?.devices.length && <Empty>No node devices are linked to this identity.</Empty>}
    </section>
    {status && <p role="status">{status}</p>}
  </>;
}

export function AccountScreen({ usage }: { usage: React.ReactNode }) {
  const [tab, setTab] = useState<"profile" | "identities" | "usage" | "access">("profile");
  const [token, setToken] = useState(getAccessToken());
  const { data: authMode } = useApi<{ mode: "session" | "token" }>("/api/auth/mode");
  const { data: health, error: integrationError, loading: integrationsLoading, reload: reloadIntegrations } = useApi<{
    integrations?: Record<string, Entity>;
  }>(tab === "access" ? "/health" : null);
  const [integrationDraft, setIntegrationDraft] = useState({ name: "", url: "", token: "" });
  const [integrationAction, setIntegrationAction] = useState("");
  const [integrationStatus, setIntegrationStatus] = useState("");
  const [pendingIntegrationAction, setPendingIntegrationAction] = useState<{ name: string; action: "disconnect" | "remove" } | null>(null);
  const [refreshingTools, setRefreshingTools] = useState(false);
  const [toolRefreshStatus, setToolRefreshStatus] = useState("");
  const refreshTools = async () => {
    setRefreshingTools(true);
    setToolRefreshStatus("");
    try {
      await api("/api/integrations/mcp/refresh", { method: "POST" });
      setToolRefreshStatus("Tools refreshed. Reloading…");
      window.location.reload();
    } catch (caught) {
      setToolRefreshStatus(caught instanceof Error ? caught.message : String(caught));
      setRefreshingTools(false);
    }
  };
  const integrations = Object.entries(health?.integrations || {})
    .filter(([name]) => !name.endsWith("configuration"));
  const addIntegration = async (event: React.FormEvent) => {
    event.preventDefault();
    setIntegrationAction("add");
    setIntegrationStatus("");
    try {
      await api("/api/integrations/mcp", {
        method: "POST",
        body: JSON.stringify(integrationDraft),
      });
      setIntegrationDraft({ name: "", url: "", token: "" });
      setIntegrationStatus("Integration connected.");
      await reloadIntegrations();
    } catch (caught) {
      setIntegrationStatus(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIntegrationAction("");
    }
  };
  const changeIntegration = async (name: string, action: "connect" | "disconnect" | "remove") => {
    setIntegrationAction(`${action}:${name}`);
    setIntegrationStatus("");
    try {
      if (action === "connect") {
        const result = await api<{ authorizationUrl: string }>(`/api/integrations/${encodeURIComponent(name)}/oauth/start`, { method: "POST" });
        window.location.assign(result.authorizationUrl);
        return;
      }
      await api(`/api/integrations/${encodeURIComponent(name)}${action === "disconnect" ? "/oauth/disconnect" : ""}`, {
        method: action === "remove" ? "DELETE" : "POST",
      });
      setIntegrationStatus(`${name} ${action === "remove" ? "removed" : "disconnected"}.`);
      setPendingIntegrationAction(null);
      await reloadIntegrations();
    } catch (caught) {
      setIntegrationStatus(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIntegrationAction("");
    }
  };
  const access = <>
    {authMode?.mode === "session" ? <section className="surface"><p>Your browser uses a revocable Time v3 session stored in a secure, HTTP-only cookie.</p><button className="button button--quiet" type="button" onClick={async () => { await api("/api/auth/logout", { method: "POST", body: "{}" }); location.assign("/api/auth/start"); }}>Sign out</button></section> : <form className="profile-fact-form" onSubmit={(event) => { event.preventDefault(); setAccessToken(token); }}>
      <label>Access token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} /></label>
      <button className="button">Save token</button>
    </form>}
    <section className="surface account-integrations" aria-labelledby="account-integrations-heading">
      <div className="section-title"><div><p className="eyebrow">Connected services</p><h2 id="account-integrations-heading">Integrations</h2></div><span>{integrations.filter(([, value]) => value.ready).length} connected</span></div>
      {integrationsLoading && <Loading label="Loading integrations" />}
      {Boolean(integrationError) && <ErrorState error={integrationError} retry={reloadIntegrations} />}
      <div className="integration-list">{integrations.map(([name, integration]) => {
        const ready = Boolean(integration.ready);
        const status = integration.disabled ? "Disabled" : ready
          ? `Connected${integration.toolCount == null ? "" : ` · ${String(integration.toolCount)} tools`}`
          : integration.error ? "Connection failed" : "Disconnected";
        return <article className={`integration-card${ready ? " ready" : ""}`} key={name} title={String(integration.refreshError || integration.error || "")}>
          <div><strong>{name}</strong><span>{status}</span></div>
          {integration.userManaged
            ? <button className="button button--quiet" type="button" disabled={Boolean(integrationAction)} onClick={() => setPendingIntegrationAction({ name, action: "remove" })}>{integrationAction === `remove:${name}` ? "Removing…" : "Remove"}</button>
            : integration.oauth && !integration.disabled
              ? <button className="button button--quiet" type="button" disabled={Boolean(integrationAction)} onClick={() => ready ? setPendingIntegrationAction({ name, action: "disconnect" }) : void changeIntegration(name, "connect")}>{integrationAction.endsWith(`:${name}`) ? "Working…" : ready ? "Disconnect" : "Connect"}</button>
              : null}
        </article>;
      })}</div>
      {!integrationsLoading && !integrationError && !integrations.length && <Empty>No integrations are configured.</Empty>}
      {pendingIntegrationAction && <section className="group-delete-confirmation" role="alertdialog" aria-label="Confirm integration change"><p>{pendingIntegrationAction.action === "remove" ? `Remove ${pendingIntegrationAction.name}? Its locally stored token and tools will be deleted.` : `Disconnect ${pendingIntegrationAction.name}? Local OAuth credentials and its tools will be removed.`}</p><div><button className="button button--quiet" onClick={() => setPendingIntegrationAction(null)}>Cancel</button><button className="button button--danger" onClick={() => void changeIntegration(pendingIntegrationAction.name, pendingIntegrationAction.action)}>{pendingIntegrationAction.action === "remove" ? "Remove" : "Disconnect"}</button></div></section>}
      <form className="integration-add-form" onSubmit={(event) => void addIntegration(event)}>
        <h3>Add token integration</h3>
        <div className="object-editor-grid">
          <label>Name<input required pattern="[A-Za-z0-9_-]+" value={integrationDraft.name} onChange={(event) => setIntegrationDraft({ ...integrationDraft, name: event.target.value })} /></label>
          <label>Server URL<input required type="url" value={integrationDraft.url} onChange={(event) => setIntegrationDraft({ ...integrationDraft, url: event.target.value })} /></label>
        </div>
        <label>Bearer token<input required type="password" value={integrationDraft.token} onChange={(event) => setIntegrationDraft({ ...integrationDraft, token: event.target.value })} /></label>
        <button className="button" disabled={Boolean(integrationAction)}>{integrationAction === "add" ? "Connecting…" : "Connect integration"}</button>
      </form>
      {integrationStatus && <p role="status" className="account-tool-refresh-status">{integrationStatus}</p>}
    </section>
    <section className="surface account-tool-refresh" aria-labelledby="account-tool-refresh-heading">
      <div>
        <p className="eyebrow">Connected services</p>
        <h2 id="account-tool-refresh-heading">Tool catalog</h2>
        <p>Rediscover tools and schemas from every enabled integration.</p>
      </div>
      <button className="button button--quiet" type="button" disabled={refreshingTools} onClick={() => void refreshTools()}>
        {refreshingTools ? "Refreshing tools…" : "Refresh tools"}
      </button>
      {toolRefreshStatus && <p className="account-tool-refresh-status" role="status">{toolRefreshStatus}</p>}
    </section>
  </>;
  return <>
    <header className="page-heading"><div><p className="eyebrow">Identity and service</p><h1>Account</h1><p>Your durable profile, model usage, and this browser’s access.</p></div></header>
    <nav className="account-tabs">
      <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>Profile</button>
      {authMode?.mode === "session" && <button className={tab === "identities" ? "active" : ""} onClick={() => setTab("identities")}>Agent identities</button>}
      <button className={tab === "usage" ? "active" : ""} onClick={() => setTab("usage")}>AI usage</button>
      <button className={tab === "access" ? "active" : ""} onClick={() => setTab("access")}>Access</button>
    </nav>
    {tab === "profile" ? <ProfileScreen /> : tab === "identities" ? <IdentitiesScreen /> : tab === "usage" ? usage : access}
  </>;
}

type MusicSequence = { type: string; number: number | string | null; title: string | null };
type MusicMetadata = {
  release: { type: string | null; title: string | null; version: string | null; discNumber: number | string | null; side: string | null; trackNumber: number | string | null } | null;
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
type MusicWorkGroup = { key: string; title: string; type: string | null; creators: string[]; catalogue: string[]; files: MusicFile[] };
type MusicReleaseGroup = { key: string; title: string; type: string | null; version: string | null; release: boolean; files: MusicFile[]; works: MusicWorkGroup[] };

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

function musicOrderNumber(value: number | string | null | undefined) {
  return typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10) || Number.MAX_SAFE_INTEGER;
}

function sortWebMusicWork(files: MusicFile[]) {
  return [...files].sort((left, right) => (
    musicOrderNumber(left.metadata?.sequence1?.number) - musicOrderNumber(right.metadata?.sequence1?.number)
    || musicOrderNumber(left.metadata?.sequence2?.number) - musicOrderNumber(right.metadata?.sequence2?.number)
    || musicOrderNumber(left.metadata?.release?.trackNumber) - musicOrderNumber(right.metadata?.release?.trackNumber)
    || left.fileId - right.fileId
  ));
}

function sortWebMusicRelease(files: MusicFile[]) {
  return [...files].sort((left, right) => (
    musicOrderNumber(left.metadata?.release?.discNumber) - musicOrderNumber(right.metadata?.release?.discNumber)
    || String(left.metadata?.release?.side ?? "").localeCompare(String(right.metadata?.release?.side ?? ""))
    || musicOrderNumber(left.metadata?.release?.trackNumber) - musicOrderNumber(right.metadata?.release?.trackNumber)
    || left.fileId - right.fileId
  ));
}

function webMusicReleaseGroups(files: MusicFile[]): MusicReleaseGroup[] {
  const releases = new Map<string, MusicReleaseGroup & { workMap: Map<string, MusicWorkGroup> }>();
  for (const file of files) {
    const release = file.metadata?.release;
    const work = file.metadata?.work;
    const workTitle = work?.title || (release ? "Tracks" : file.title || file.originalFilename || `File ${file.fileId}`);
    const creators = work?.creators ?? [];
    const catalogue = work?.catalogue ?? [];
    const workKey = JSON.stringify([work?.type ?? "unknown", workTitle, creators, catalogue]);
    const releaseKey = release ? JSON.stringify([release.type, release.title, release.version]) : `standalone:${workKey}`;
    const group = releases.get(releaseKey) ?? {
      key: releaseKey,
      title: release?.title || workTitle,
      type: release?.type ?? work?.type ?? null,
      version: release?.version ?? null,
      release: Boolean(release),
      files: [],
      works: [],
      workMap: new Map<string, MusicWorkGroup>(),
    };
    const workGroup = group.workMap.get(workKey) ?? { key: workKey, title: workTitle, type: work?.type ?? null, creators, catalogue, files: [] };
    workGroup.files.push(file);
    group.workMap.set(workKey, workGroup);
    group.files.push(file);
    releases.set(releaseKey, group);
  }
  for (const group of releases.values()) {
    group.files = sortWebMusicRelease(group.files);
    group.works = [...group.workMap.values()]
      .map((work) => ({ ...work, files: sortWebMusicWork(work.files) }))
      .sort((left, right) => musicOrderNumber(left.files[0]?.metadata?.release?.trackNumber) - musicOrderNumber(right.files[0]?.metadata?.release?.trackNumber) || left.title.localeCompare(right.title));
  }
  return [...releases.values()].map(({ workMap: _workMap, ...group }) => group).sort((left, right) => left.title.localeCompare(right.title));
}

function concertDescriptionText(files: MusicFile[]) {
  const tracks = files.map((file, index) => {
    const metadata = file.metadata;
    const title = musicTrackTitle(file);
    const details = [
      metadata?.work.title && metadata.work.title !== title ? metadata.work.title : null,
      metadata?.work.creators?.length ? metadata.work.creators.join(", ") : null,
      metadata?.performers?.length ? `Performed by ${metadata.performers.join(", ")}` : null,
      metadata?.release?.title ? `From ${metadata.release.title}` : null,
    ].filter((value): value is string => Boolean(value));
    return `${index + 1}. ${[title, ...details].join(" — ")}`;
  });
  return `Concert\n\n${tracks.join("\n")}`;
}

async function copyTextToClipboard(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall back for browsers that expose Clipboard but block it outside a secure context.
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard is unavailable");
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

export function useWebMusicPlayer(onMusicScreen = false) {
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
  const [voiceVolume, setVoiceVolume] = useState(0.7);
  const [fields, setFields] = useState<NarrationField[]>(["work", "sequence", "creators"]);
  const [concertExpanded, setConcertExpanded] = useState(false);
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
  useEffect(() => { if (!onMusicScreen) setConcertExpanded(false); }, [onMusicScreen]);

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
    setConcertExpanded(false);
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

  const copyDescription = async () => {
    const text = concertDescriptionText(musicItems.map((item) => item.file));
    try {
      await copyTextToClipboard(text);
      setNotice("Concert description copied.");
    } catch {
      setNotice("Could not copy the concert description.");
    }
  };

  const progress = durationSeconds > 0 ? Math.min(100, playbackSeconds / durationSeconds * 100) : 0;
  const playerStatus = current ? current.kind === "narration" ? "AI voice · Now playing" : "Now playing" : complete ? "Concert complete" : "Concert ready";
  const playerTitle = current ? current.kind === "narration" ? current.title : musicTrackTitle(current.file) : summary;
  const playerIdentity = <><small>{playerStatus}</small><strong>{playerTitle}</strong></>;

  return {
    queue, musicItems, current, error, notice, fields, hasStarted, complete, transitioning, summary, voiceVolume, setVoiceVolume, concertExpanded, setConcertExpanded, enqueue, remove, clear, start, toggleField, copyDescription,
    element: queue.length ? <aside className="music-mini-player" aria-label="Concert player">{onMusicScreen ? <button className="music-mini-player-summary" aria-label={concertExpanded ? "Collapse concert" : "Expand concert"} aria-expanded={concertExpanded} onClick={() => setConcertExpanded((value) => !value)}>{playerIdentity}</button> : <span>{playerIdentity}</span>}{current ? <div className="music-player-transport"><button className="music-player-toggle" aria-label={playing ? "Pause concert" : "Play concert"} disabled={!source} onClick={togglePlayback}>{playing ? "❚❚" : "▶"}</button><div className="music-player-timeline"><input aria-label="Playback position" aria-valuetext={`${formatPlaybackTime(playbackSeconds)} of ${formatPlaybackTime(durationSeconds)}`} max={durationSeconds || 0} min="0" step="0.1" type="range" value={Math.min(playbackSeconds, durationSeconds || 0)} onChange={(event) => seek(Number(event.target.value))} style={{ "--music-progress": `${progress}%` } as CSSProperties} /><div><time>{formatPlaybackTime(playbackSeconds)}</time><time>{formatPlaybackTime(durationSeconds)}</time></div></div><audio ref={audio} src={source} preload="auto" onDurationChange={(event) => setDurationSeconds(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onEnded={() => { setPlaying(false); void playAt(index + 1); }} onLoadedMetadata={(event) => setDurationSeconds(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} onTimeUpdate={(event) => setPlaybackSeconds(event.currentTarget.currentTime)} /></div> : <button className="button" disabled={transitioning} onClick={start}>{transitioning ? "Preparing AI voice…" : complete ? "Replay concert" : "Start concert"}</button>}<button className="button button--quiet" onClick={clear}>Clear</button></aside> : null,
  };
}

function WebMusicTrackList({ files, player }: { files: MusicFile[]; player: ReturnType<typeof useWebMusicPlayer> }) {
  return <ul className="music-track-list">{files.map((track) => <li key={track.fileId}><span><strong>{musicTrackTitle(track)}</strong><small>{track.metadata?.performers?.join(" · ") || track.originalFilename}</small></span><button className="button button--quiet music-add-button" disabled={player.hasStarted || player.musicItems.some((item) => item.file.fileId === track.fileId)} aria-label={`Add ${musicTrackTitle(track)} to concert`} onClick={() => player.enqueue([track])}>+</button></li>)}</ul>;
}

function WebMusicLibraryGroup({ group, player }: { group: MusicReleaseGroup; player: ReturnType<typeof useWebMusicPlayer> }) {
  const standalone = !group.release && group.works.length === 1 ? group.works[0] : null;
  return <section className="library-group" key={group.key}>
    <header className="library-group-heading"><div><small>{group.type || "music"}</small><h2>{group.title}</h2>{group.version && <p>{group.version}</p>}{standalone && <p>{[...standalone.catalogue, ...standalone.creators].join(" · ")}</p>}</div><button className="button button--quiet music-add-button" disabled={player.hasStarted} aria-label={`Add ${group.title} to concert`} onClick={() => player.enqueue(group.files)}>+</button></header>
    {group.release ? <div className="music-work-groups">{group.works.map((work) => <section className="music-work-group" key={work.key}><header className="music-work-heading"><span><small>{work.type || "work"}</small><strong>{work.title}</strong>{(work.catalogue.length > 0 || work.creators.length > 0) && <em>{[...work.catalogue, ...work.creators].join(" · ")}</em>}</span><button className="button button--quiet music-add-button" disabled={player.hasStarted} aria-label={`Add ${work.title} to concert`} onClick={() => player.enqueue(work.files)}>+</button></header><WebMusicTrackList files={work.files} player={player} /></section>)}</div> : <WebMusicTrackList files={group.files} player={player} />}
  </section>;
}

export function MusicScreen({ player }: { player: ReturnType<typeof useWebMusicPlayer> }) {
  const { data, error, loading, reload } = useApi<{ files: MusicFile[] }>("/api/music?limit=500");
  const [query, setQuery] = useState("");
  const files = (data?.files || []).filter((file) => JSON.stringify(file).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const groups = useMemo(() => webMusicReleaseGroups(files), [files]);
  const orderedFiles = groups.flatMap((group) => group.files);
  const programGroups = concertProgramGroups(player.musicItems.map((item) => item.file));
  const programPositions = new Map(player.musicItems.map((item, position) => [item.file.fileId, position + 1]));
  return <div className={`music-screen${player.concertExpanded ? " concert-expanded" : ""}`}><header className="page-heading"><div><p className="eyebrow">Concert builder</p><h1>Music</h1><p>Build one guided program, then play it as a concert. Library selections never start playback.</p></div>{orderedFiles.length > 0 && <button className="button" disabled={player.hasStarted} onClick={() => player.enqueue(orderedFiles)}>Add all results</button>}</header>
    {(player.notice || player.error) && <p className={player.error ? "form-error" : "status"}>{player.error || player.notice}</p>}
    <div className="section-filter"><input aria-label="Filter music" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search work, movement, composer, performer, or notes" /></div>{loading && <Loading />}{Boolean(error) && <ErrorState error={error} retry={reload} />}{!loading && !error && !groups.length && <Empty>No music found.</Empty>}<div className="library-groups">{groups.map((group) => <WebMusicLibraryGroup group={group} player={player} key={group.key} />)}</div>
    {player.musicItems.length > 0 && player.concertExpanded && <section className="concert-queue is-expanded" aria-label="Concert">
        <header className="concert-queue-heading"><div><p className="eyebrow">One playback queue</p><h2 id="concert-queue-heading">Your concert</h2><p>{player.summary}</p></div><div className="concert-queue-actions"><button className="button button--quiet" aria-expanded="true" onClick={() => player.setConcertExpanded(false)}>Collapse</button>{!player.current && <button className="button" disabled={player.transitioning} onClick={player.start}>{player.transitioning ? "Preparing AI voice…" : player.complete ? "Replay concert" : "Start concert"}</button>}<button className="button button--quiet" onClick={() => void player.copyDescription()}>Copy concert description</button><button className="button button--quiet" onClick={player.clear}>Clear</button></div></header>
        <div className="concert-guidance"><strong>Spoken introductions</strong><p>An AI voice introduces every track. Choose what it announces before the concert begins.</p><label className="concert-voice-volume"><span>AI voice volume <strong>{Math.round(player.voiceVolume * 100)}%</strong></span><input aria-label="AI voice volume" type="range" min="0" max="100" step="10" value={Math.round(player.voiceVolume * 100)} onChange={(event) => player.setVoiceVolume(Number(event.target.value) / 100)} /><small>Relative to music · adjustable during playback</small></label><div className="concert-guidance-fields">{narrationChoices.map(({ field, label }) => <button className={player.fields.includes(field) ? "is-selected" : ""} aria-pressed={player.fields.includes(field)} disabled={player.hasStarted} key={field} onClick={() => player.toggleField(field)}>{label}</button>)}</div>{player.hasStarted && <small>This concert is fixed while it is playing. Clear it to build another.</small>}</div>
        <div className="concert-program-groups">{programGroups.map((group) => <section className="concert-program-group" key={group.identity}><header>{group.releaseTitle && <small>{group.releaseTitle}</small>}<span>{group.eyebrow} · {group.files.length} {group.files.length === 1 ? "selection" : "selections"}</span><h3>{group.title}</h3>{group.detail && <p>{group.detail}</p>}</header><ol className="concert-program">{group.files.flatMap((file) => { const narration = player.queue.find((item) => item.kind === "narration" && item.file.fileId === file.fileId); const music = player.queue.find((item) => item.kind === "music" && item.file.fileId === file.fileId); return [<li className={`concert-program-narration${player.current?.key === narration?.key ? " is-current" : ""}`} key={`narration:${file.fileId}`}><span className="concert-program-narration-icon">◇</span><span><small>{narration?.kind === "narration" && narration.status === "generating" ? "AI voice · Generating…" : narration?.kind === "narration" && narration.status === "ready" ? "AI voice · Ready" : narration?.kind === "narration" && narration.status === "unavailable" ? "AI voice · Unavailable — will skip" : "AI voice · Will generate"}</small><strong>{narration?.kind === "narration" ? narration.title : `Introduction to ${musicTrackTitle(file)}`}</strong>{narration?.kind === "narration" && <small>{narration.text}</small>}</span></li>, <li className={player.current?.key === music?.key ? "is-current" : ""} key={`music:${file.fileId}`}><span className="concert-program-number">{programPositions.get(file.fileId)}</span><span>{player.current?.key === music?.key && <small>Now playing</small>}<strong>{musicTrackTitle(file)}</strong><small>{file.metadata?.performers?.join(" · ") || file.originalFilename}</small></span>{!player.hasStarted && <button className="button button--quiet" onClick={() => player.remove(file.fileId)}>Remove</button>}</li>]; })}</ol></section>)}</div>
    </section>}
  </div>;
}
