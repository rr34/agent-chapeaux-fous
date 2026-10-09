import type { SelectedObjectCandidate } from "./types";

const objectTypeNames: Record<string, { singular: string; plural: string }> = {
  "agent.exchange": { singular: "exchange", plural: "exchanges" },
  "calendar.event": { singular: "calendar event", plural: "calendar events" },
  "calendar.routine": { singular: "calendar routine", plural: "calendar routines" },
  "catch_up.question": { singular: "check-in question", plural: "check-in questions" },
  "contacts.contact": { singular: "contact", plural: "contacts" },
  "files.file": { singular: "file", plural: "files" },
  "journal.entry": { singular: "journal entry", plural: "journal entries" },
  "journal.group": { singular: "journal group", plural: "journal groups" },
  "journal.tracker": { singular: "journal tracker", plural: "journal trackers" },
  "payments.invoice": { singular: "invoice", plural: "invoices" },
  "profile.fact": { singular: "profile fact", plural: "profile facts" },
  "todos.personal_task": { singular: "to-do", plural: "to-dos" },
  "todos.todo_group": { singular: "to-do group", plural: "to-do groups" },
  "video.content_group": { singular: "library group", plural: "library groups" },
  "video.content_item": { singular: "library item", plural: "library items" },
  "video.script": { singular: "video script", plural: "video scripts" },
};

function fallbackTypeNames(selection: SelectedObjectCandidate) {
  const singular = selection.label.trim().toLocaleLowerCase() || "object";
  return { singular, plural: `${singular}s` };
}

function joinTypeCounts(parts: string[]) {
  if (parts.length < 2) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

export function selectedObjectSummary(selections: SelectedObjectCandidate[]) {
  const groups = new Map<string, { count: number; names: { singular: string; plural: string } }>();
  for (const selection of selections) {
    const existing = groups.get(selection.type);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.set(selection.type, {
      count: 1,
      names: objectTypeNames[selection.type] ?? fallbackTypeNames(selection),
    });
  }
  const counts = [...groups.values()].map(({ count, names }) => (
    `${count} ${count === 1 ? names.singular : names.plural}`
  ));
  return `${joinTypeCounts(counts)} selected for this request`;
}
