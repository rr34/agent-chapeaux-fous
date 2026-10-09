import { useEffect, useMemo, useState } from "react";
import { api, downloadAuthenticated } from "../api";
import type {
  NetworkObject, ObjectNetworkGraph, ObjectSearchCandidate, SelectedObjectCandidate,
} from "../types";
import type { AddAgentReference } from "./AgentReferenceButton";
import {
  CalendarEventEditor, CalendarRoutineEditor, ContactEditor, TodoEditor, toggleTodoCompletion,
} from "./EditableItems";
import { FirstClassObjectCard, type FirstClassObjectCardAction } from "./FirstClassObjectCard";

const supportedTypes = new Set([
  "contacts.contact", "todos.todo_group", "todos.personal_task", "payments.invoice",
  "journal.group", "journal.tracker", "journal.entry", "calendar.event", "calendar.routine",
  "files.file", "profile.fact", "catch_up.question", "video.script", "video.content_group",
  "video.content_item",
]);
const editableTypes = new Set([
  "contacts.contact", "todos.personal_task", "calendar.event", "calendar.routine",
]);

function identityOf(object: NetworkObject | SelectedObjectCandidate) {
  return { type: object.type, source: object.source, id: object.id, ref: object.ref };
}

function graphUrl(object: NetworkObject | SelectedObjectCandidate) {
  const query = new URLSearchParams({
    type: object.type,
    source: object.source,
    id: String(object.id),
    ref: object.ref,
  });
  return `/api/object-network?${query}`;
}

function selectionOf(object: NetworkObject): SelectedObjectCandidate {
  return {
    mention: `@${object.display}`,
    type: object.type,
    source: object.source,
    id: object.id,
    ref: object.ref,
    display: object.display,
    label: object.label,
  };
}

function attributeValue(object: NetworkObject, label: string) {
  return object.attributes.find((attribute) => attribute.label === label)?.value;
}

function NetworkGlyph({ broken = false }: { broken?: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={broken ? "M7.2 8.2 5 6m12 12-2.2-2.2M8.6 15.7 5 18m10.4-9.7L19 6" : "M7.3 8.1 4.8 6.4m11.9 1.7 2.5-1.7M7.3 15.9l-2.5 1.7m11.9-1.7 2.5 1.7"} />
    {!broken && <path d="M8 12h8" />}
    <circle cx="4" cy="6" r="2" />
    <circle cx="20" cy="6" r="2" />
    <circle cx="4" cy="18" r="2" />
    <circle cx="20" cy="18" r="2" />
    {!broken && <circle cx="12" cy="12" r="2.2" />}
  </svg>;
}

function NetworkCard({
  object, focus = false, onToggleComplete, onEdit, onRespond, onDownload,
  onOpen, onDisconnect, busy,
}: {
  object: NetworkObject;
  focus?: boolean;
  onToggleComplete?: () => void;
  onEdit?: () => void;
  onRespond?: () => void;
  onDownload?: () => void;
  onOpen?: () => void;
  onDisconnect?: () => void;
  busy?: boolean;
}) {
  const complete = attributeValue(object, "Status") === "complete";
  const actions: FirstClassObjectCardAction[] = [
    ...(onToggleComplete ? [{ key: "complete", label: complete ? "Reopen" : "Complete", onClick: onToggleComplete, disabled: busy }] : []),
    ...(onEdit ? [{ key: "edit", label: "Edit", onClick: onEdit }] : []),
    ...(onRespond ? [{ key: "respond", label: "Agent", onClick: onRespond }] : []),
    ...(onDownload ? [{ key: "download", label: "Download", onClick: onDownload }] : []),
    ...(object.links || []).map((link) => ({ key: `${link.label}-${link.href}`, label: link.label, href: link.href })),
    ...(onOpen ? [{ key: "network", label: "Network", onClick: onOpen, title: `Open network for ${object.display}` }] : []),
    ...(onDisconnect ? [{ key: "disconnect", label: "Disconnect", onClick: onDisconnect, disabled: busy, danger: true }] : []),
  ];
  return <FirstClassObjectCard
    object={object}
    focus={focus}
    className="network-object-card"
    actions={actions}
  />;
}

function NetworkObjectEditor({ object, onClose, onChanged }: {
  object: NetworkObject;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  if (object.type === "contacts.contact") {
    return <ContactEditor contactId={object.id} onClose={onClose} onChanged={onChanged} />;
  }
  if (object.type === "todos.personal_task") {
    return <TodoEditor todoId={object.id} onClose={onClose} onChanged={onChanged} />;
  }
  if (object.type === "calendar.event") {
    return <CalendarEventEditor eventId={object.id} recurring={false} onClose={onClose} onChanged={onChanged} />;
  }
  if (object.type === "calendar.routine") {
    return <CalendarRoutineEditor routineId={object.id} onClose={onClose} onChanged={onChanged} />;
  }
  return null;
}

function candidateIdentity(candidate: ObjectSearchCandidate): SelectedObjectCandidate {
  return {
    mention: `@${candidate.title}`,
    type: candidate.domainType,
    source: candidate.source,
    id: candidate.id,
    ref: candidate.ref,
    display: candidate.title,
    label: candidate.label,
  };
}

function ObjectNetworkExplorer({ initial, onClose, onReference }: {
  initial: SelectedObjectCandidate;
  onClose: () => void;
  onReference?: AddAgentReference;
}) {
  const [graph, setGraph] = useState<ObjectNetworkGraph | null>(null);
  const [history, setHistory] = useState<NetworkObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [linking, setLinking] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ObjectSearchCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [changingRef, setChangingRef] = useState("");
  const [editingObject, setEditingObject] = useState<NetworkObject | null>(null);

  const load = async (object: NetworkObject | SelectedObjectCandidate) => {
    setLoading(true);
    setError("");
    setGraph(null);
    try {
      setGraph(await api<ObjectNetworkGraph>(graphUrl(object)));
      setLinking(false);
      setQuery("");
      setResults([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setHistory([]);
    void load(initial);
  }, [initial.ref]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !editingObject) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [editingObject, onClose]);
  useEffect(() => {
    const text = query.trim();
    if (!linking || text.length < 2 || !graph) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const parameters = new URLSearchParams({ q: text, limit: "48" });
        graph.connectableTypes.forEach((domainType) => parameters.append("domainType", domainType));
        const response = await api<{ objects: ObjectSearchCandidate[] }>(
          `/api/native-objects/search?${parameters}`,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) setResults(response.objects || []);
      } catch (caught) {
        if ((caught as Error).name !== "AbortError") setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 140);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, linking, graph?.focus.ref]);

  const connectedRefs = useMemo(() => new Set([
    graph?.focus.ref,
    ...(graph?.connections.map(({ object }) => object.ref) || []),
  ]), [graph]);
  const choices = results.filter((candidate) => graph?.connectableTypes.includes(candidate.domainType)
    && !connectedRefs.has(candidate.ref));

  const refreshGraph = async () => {
    if (!graph) return;
    setGraph(await api<ObjectNetworkGraph>(graphUrl(graph.focus)));
  };

  const toggleTodo = async (object: NetworkObject) => {
    setChangingRef(object.ref);
    setError("");
    try {
      await toggleTodoCompletion(object.id);
      await refreshGraph();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setChangingRef("");
    }
  };

  const respondTo = (object: NetworkObject) => {
    onReference?.(selectionOf(object), `${object.label.toLowerCase()} ${object.display}`);
  };

  const downloadFile = (object: NetworkObject) => {
    const filename = attributeValue(object, "Filename") || object.display || `file-${object.id}`;
    void downloadAuthenticated(`/api/files/${object.id}/download`, filename);
  };

  const changeConnection = async (target: NetworkObject | SelectedObjectCandidate, linked: boolean) => {
    if (!graph) return;
    setChangingRef(target.ref);
    setError("");
    try {
      setGraph(await api<ObjectNetworkGraph>("/api/object-network/connections", {
        method: "POST",
        body: JSON.stringify({
          from: identityOf(graph.focus),
          to: identityOf(target),
          linked,
        }),
      }));
      setLinking(false);
      setQuery("");
      setResults([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setChangingRef("");
    }
  };

  const openObject = (object: NetworkObject) => {
    if (!graph) return;
    setHistory((current) => [...current, graph.focus]);
    void load(object);
  };
  const goBack = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((current) => current.slice(0, -1));
    void load(previous);
  };

  return <div className="object-editor-backdrop network-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="object-editor object-network" role="dialog" aria-modal="true" aria-label="Object connections">
      <header className="network-heading">
        <div className="network-heading-object">
          {history.length > 0 && <button className="network-back-button" type="button" onClick={goBack} aria-label="Back">←</button>}
          {graph && <NetworkCard
            object={graph.focus}
            focus
            onToggleComplete={graph.focus.type === "todos.personal_task" ? () => void toggleTodo(graph.focus) : undefined}
            onEdit={editableTypes.has(graph.focus.type) ? () => setEditingObject(graph.focus) : undefined}
            onRespond={onReference && graph.focus.respondable ? () => respondTo(graph.focus) : undefined}
            onDownload={graph.focus.type === "files.file" ? () => downloadFile(graph.focus) : undefined}
            busy={changingRef === graph.focus.ref}
          />}
        </div>
        <button className="button button--quiet" type="button" onClick={onClose}>Close</button>
      </header>
      {loading && !graph && <p className="object-editor-state">Opening object…</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {graph && <>
        <div className="network-rail" aria-label="Connected objects">
          {graph.connections.map(({ object, removable }) => <NetworkCard
            key={object.ref}
            object={object}
            onToggleComplete={object.type === "todos.personal_task" ? () => void toggleTodo(object) : undefined}
            onEdit={editableTypes.has(object.type) ? () => setEditingObject(object) : undefined}
            onRespond={onReference && object.respondable ? () => respondTo(object) : undefined}
            onDownload={object.type === "files.file" ? () => downloadFile(object) : undefined}
            onOpen={() => openObject(object)}
            onDisconnect={removable ? () => void changeConnection(object, false) : undefined}
            busy={changingRef === object.ref}
          />)}
          {graph.connections.length === 0 && <p className="network-empty">No connected objects.</p>}
        </div>
        {graph.truncated && <p className="object-editor-note">Showing the first 100 connected objects.</p>}
        {graph.connectableTypes.length > 0 && <div className="network-linker">
          {!linking
            ? <button className="button button--quiet" type="button" onClick={() => setLinking(true)}>Connect</button>
            : <>
              <div className="network-search-row">
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an object" aria-label="Find an object to connect" />
                <button className="button button--quiet" type="button" onClick={() => { setLinking(false); setQuery(""); }}>Cancel</button>
              </div>
              {searching && <small>Searching…</small>}
              {query.trim().length >= 2 && !searching && choices.length === 0 && <small>No available objects match.</small>}
              {choices.length > 0 && <div className="network-search-results">{choices.map((candidate) => {
                const identity = candidateIdentity(candidate);
                return <FirstClassObjectCard
                  mode="compact"
                  key={candidate.ref}
                  object={{
                    type: candidate.domainType,
                    label: candidate.label,
                    display: candidate.title,
                    body: candidate.detail,
                  }}
                  onOpen={() => void changeConnection(identity, true)}
                  openLabel={`Connect ${candidate.title}`}
                  openDisabled={changingRef === candidate.ref}
                />;
              })}</div>}
            </>}
        </div>}
      </>}
      {editingObject && <NetworkObjectEditor
        object={editingObject}
        onClose={() => setEditingObject(null)}
        onChanged={refreshGraph}
      />}
    </section>
  </div>;
}

export function ObjectNetworkButton({ identity, subject, onReference }: {
  identity: SelectedObjectCandidate;
  subject: string;
  onReference?: AddAgentReference;
}) {
  const [open, setOpen] = useState(false);
  if (!supportedTypes.has(identity.type)) return null;
  const label = `Show connections for ${subject}`;
  return <>
    <button
      className="object-network-button"
      type="button"
      title={label}
      aria-label={label}
      onClick={() => setOpen(true)}
    ><NetworkGlyph /></button>
    {open && <ObjectNetworkExplorer initial={identity} onClose={() => setOpen(false)} onReference={onReference} />}
  </>;
}
