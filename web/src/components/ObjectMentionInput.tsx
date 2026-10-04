import {
  type ChangeEvent, type KeyboardEvent, type RefObject,
  useEffect, useMemo, useState,
} from "react";
import { api } from "../api";
import type { ObjectSearchCandidate, SelectedObjectCandidate } from "../types";

const groupOrder = [
  ["Contacts", ["contacts."]],
  ["Events", ["calendar.event"]],
  ["To-dos", ["todos."]],
  ["Routines", ["calendar.routine"]],
  ["Files", ["files."]],
  ["Journal", ["journal."]],
  ["Briefings", ["interaction_guide."]],
  ["Check-in", ["catch_up."]],
  ["Library and video", ["video."]],
  ["Profile", ["profile."]],
] as const;

const maximumSelections = 12;

interface ActiveMention {
  start: number;
  end: number;
  query: string;
}

function groupFor(type: string) {
  return groupOrder.find(([, prefixes]) => prefixes.some((prefix) => type.startsWith(prefix)))?.[0]
    || "Other";
}

function mentionAtCursor(value: string, cursor: number, selections: SelectedObjectCandidate[]) {
  const prefix = value.slice(0, cursor);
  const match = /(^|[\s([{])@([^@\n]{0,100})$/u.exec(prefix);
  if (!match || /[,;:!?()[\]{}]/u.test(match[2])) return null;
  const start = match.index + match[1].length;
  const fragment = match[2];
  const exactSelection = selections.find(({ mention }) => mention === `@${fragment}`);
  if (exactSelection) return null;
  const selectedPrefix = selections.find(({ display }) => fragment.startsWith(`${display} `));
  if (selectedPrefix) return null;
  return { start, end: cursor, query: fragment.trimStart() } satisfies ActiveMention;
}

function submissionCandidate(candidate: ObjectSearchCandidate): SelectedObjectCandidate {
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

export function ObjectMentionInput({
  value, onChange, selections, onSelectionsChange, textareaRef,
}: {
  value: string;
  onChange: (value: string) => void;
  selections: SelectedObjectCandidate[];
  onSelectionsChange: (selections: SelectedObjectCandidate[]) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [activeMention, setActiveMention] = useState<ActiveMention | null>(null);
  const [results, setResults] = useState<ObjectSearchCandidate[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = activeMention?.query.trim() || "";
    if (!query) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api<{ objects: ObjectSearchCandidate[] }>(
          `/api/native-objects/search?q=${encodeURIComponent(query)}&limit=48`,
          { signal: controller.signal },
        );
        setResults(response.objects || []);
        setActiveIndex(0);
      } catch (caught) {
        if ((caught as Error).name !== "AbortError") {
          setResults([]);
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 140);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeMention?.query]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ObjectSearchCandidate[]>();
    for (const candidate of results) {
      const group = groupFor(candidate.domainType);
      const entries = groups.get(group) || [];
      entries.push(candidate);
      groups.set(group, entries);
    }
    const names = [...groupOrder.map(([name]) => name), "Other"];
    return names.flatMap((name) => groups.has(name) ? [[name, groups.get(name)!] as const] : []);
  }, [results]);
  const orderedResults = grouped.flatMap(([, candidates]) => candidates);
  const open = activeMention !== null;

  const update = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    const cursor = event.target.selectionStart ?? next.length;
    onChange(next);
    onSelectionsChange(selections.filter(({ mention }) => next.includes(mention)));
    setActiveMention(mentionAtCursor(next, cursor, selections));
  };

  const refreshAtCursor = () => {
    const field = textareaRef.current;
    if (!field) return;
    setActiveMention(mentionAtCursor(value, field.selectionStart ?? value.length, selections));
  };

  const choose = (candidate: ObjectSearchCandidate) => {
    if (!activeMention) return;
    const selected = submissionCandidate(candidate);
    if (!selections.some(({ ref }) => ref === selected.ref) && selections.length >= maximumSelections) {
      setError(`A request can reference up to ${maximumSelections} objects.`);
      return;
    }
    setError(null);
    const suffix = value.slice(activeMention.end);
    const spacer = suffix.startsWith(" ") ? "" : " ";
    const next = value.slice(0, activeMention.start) + selected.mention + spacer + suffix;
    const cursor = activeMention.start + selected.mention.length + spacer.length;
    onChange(next);
    onSelectionsChange([
      ...selections.filter(({ ref }) => ref !== selected.ref),
      selected,
    ]);
    setActiveMention(null);
    setResults([]);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(cursor, cursor);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setActiveMention(null);
      return;
    }
    if (!orderedResults.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + direction + orderedResults.length) % orderedResults.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      choose(orderedResults[Math.min(activeIndex, orderedResults.length - 1)]);
    }
  };

  const remove = (selection: SelectedObjectCandidate) => {
    const start = value.indexOf(selection.mention);
    let next = value;
    if (start >= 0) {
      const end = start + selection.mention.length;
      const removeEnd = value[end] === " " ? end + 1 : end;
      next = value.slice(0, start) + value.slice(removeEnd);
    }
    onChange(next);
    onSelectionsChange(selections.filter(({ ref }) => ref !== selection.ref));
  };

  return <div className="mention-composer">
    {selections.length > 0 && <div className="mention-bindings" aria-label="Objects referenced in this request">
      {selections.map((selection) => <span className="mention-binding" key={selection.ref}>
        <span>{selection.label}: {selection.display}</span>
        <button type="button" onClick={() => remove(selection)} aria-label={`Remove ${selection.display} from this request`}>×</button>
      </span>)}
    </div>}
    <textarea
      ref={textareaRef}
      value={value}
      onChange={update}
      onClick={refreshAtCursor}
      onKeyUp={(event) => { if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) refreshAtCursor(); }}
      onBlur={(event) => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setActiveMention(null); }}
      onKeyDown={onKeyDown}
      placeholder="What would you like Chapeaux Fous to do? Type @ to reference an object."
      rows={3}
      aria-label="Agent request"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls="object-mention-listbox"
      aria-activedescendant={open && orderedResults[activeIndex] ? `object-mention-${orderedResults[activeIndex].type}-${orderedResults[activeIndex].id}` : undefined}
    />
    {open && <div className="mention-picker" id="object-mention-listbox" role="listbox" aria-label="Objects">
      {!activeMention.query.trim() && <p className="mention-picker-state">Type after @ to find an object.</p>}
      {loading && <p className="mention-picker-state">Searching objects…</p>}
      {error && <p className="mention-picker-state mention-picker-error">{error}</p>}
      {!loading && activeMention.query.trim() && !error && !orderedResults.length && <p className="mention-picker-state">No matching objects.</p>}
      {grouped.map(([name, candidates]) => <section className="mention-group" role="group" aria-label={name} key={name}>
        <h3>{name}</h3>
        {candidates.map((candidate) => {
          const index = orderedResults.indexOf(candidate);
          const selected = index === activeIndex;
          return <button
            id={`object-mention-${candidate.type}-${candidate.id}`}
            className={selected ? "active" : ""}
            type="button"
            role="option"
            aria-selected={selected}
            key={candidate.ref}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => choose(candidate)}
          >
            <strong>{candidate.title}</strong>
            {candidate.detail && <span>{candidate.detail}</span>}
          </button>;
        })}
      </section>)}
    </div>}
  </div>;
}
