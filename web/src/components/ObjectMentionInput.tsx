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

interface MentionSegment {
  start: number;
  end: number;
  text: string;
  selection?: SelectedObjectCandidate;
}

interface MentionPopover {
  selection: SelectedObjectCandidate;
  left: number;
  bottom: number;
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
    detail: candidate.detail,
  };
}

function mentionSegments(value: string, selections: SelectedObjectCandidate[]) {
  const matches: MentionSegment[] = [];
  for (const selection of selections) {
    let offset = 0;
    while (offset < value.length) {
      const start = value.indexOf(selection.mention, offset);
      if (start < 0) break;
      const end = start + selection.mention.length;
      const before = value[start - 1] ?? "";
      const after = value[end] ?? "";
      if ((!before || /[\s([{]/u.test(before))
          && (!after || /[\s,.;:!?()[\]{}]/u.test(after))) {
        matches.push({ start, end, text: selection.mention, selection });
      }
      offset = end;
    }
  }
  matches.sort((left, right) => left.start - right.start || right.end - left.end);
  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.start > cursor) {
      segments.push({ start: cursor, end: match.start, text: value.slice(cursor, match.start) });
    }
    segments.push(match);
    cursor = match.end;
  }
  if (cursor < value.length) segments.push({ start: cursor, end: value.length, text: value.slice(cursor) });
  return segments;
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
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const [popover, setPopover] = useState<MentionPopover | null>(null);

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
  const highlightedSegments = useMemo(() => mentionSegments(value, selections), [value, selections]);
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

  const selectMention = (start: number, end: number) => {
    const field = textareaRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(start, end);
  };

  const showMentionDetails = (target: HTMLElement, selection: SelectedObjectCandidate) => {
    const composer = target.closest(".mention-composer");
    if (!composer) return;
    const composerBounds = composer.getBoundingClientRect();
    const tokenBounds = target.getBoundingClientRect();
    const maximumWidth = Math.min(360, composerBounds.width - 24);
    setPopover({
      selection,
      left: Math.max(12, Math.min(
        tokenBounds.left - composerBounds.left,
        composerBounds.width - maximumWidth - 12,
      )),
      bottom: composerBounds.bottom - tokenBounds.top + 8,
    });
  };

  return <div className="mention-composer">
    <div className="mention-input-shell">
      <div className="mention-highlight-layer" aria-label="Selected object references">
        <div className="mention-highlight-content" style={{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }}>
          {highlightedSegments.map((segment) => segment.selection
            ? <span
              className="mention-inline-token"
              key={`${segment.selection.ref}-${segment.start}`}
              tabIndex={0}
              aria-describedby="mention-object-detail"
              onMouseEnter={(event) => showMentionDetails(event.currentTarget, segment.selection!)}
              onMouseLeave={() => setPopover(null)}
              onFocus={(event) => showMentionDetails(event.currentTarget, segment.selection!)}
              onBlur={() => setPopover(null)}
              onMouseDown={(event) => { event.preventDefault(); selectMention(segment.start, segment.end); }}
            >
              {segment.text}
            </span>
            : <span aria-hidden="true" key={`text-${segment.start}`}>{segment.text}</span>)}
        </div>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={update}
        onClick={refreshAtCursor}
        onScroll={(event) => setScroll({ left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop })}
        onKeyUp={(event) => { if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) refreshAtCursor(); }}
        onBlur={(event) => { if (!event.currentTarget.parentElement?.parentElement?.contains(event.relatedTarget as Node | null)) setActiveMention(null); }}
        onKeyDown={onKeyDown}
        placeholder="What would you like Chapeaux Fous to do? Type @ to reference an object."
        rows={3}
        aria-label="Agent request"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="object-mention-listbox"
        aria-activedescendant={open && orderedResults[activeIndex] ? `object-mention-${orderedResults[activeIndex].type}-${orderedResults[activeIndex].id}` : undefined}
      />
    </div>
    {popover && <div className="mention-object-popover" role="tooltip" id="mention-object-detail" style={{ left: popover.left, bottom: popover.bottom }}>
      <strong>{popover.selection.display}</strong>
      <span>{popover.selection.label}</span>
      {popover.selection.detail && <small>{popover.selection.detail}</small>}
      <small>Delete the highlighted text to remove this reference.</small>
    </div>}
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
