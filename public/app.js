const elements = {
  form: document.querySelector("#request-form"),
  text: document.querySelector("#request-text"),
  send: document.querySelector("#send"),
  requestFile: document.querySelector("#request-file"),
  requestFileLabel: document.querySelector("#request-file-label"),
  removeRequestFile: document.querySelector("#remove-request-file"),
  record: document.querySelector("#record"),
  recordLabel: document.querySelector("#record-label"),
  recordTimer: document.querySelector("#record-timer"),
  status: document.querySelector("#composer-status"),
  runtime: document.querySelector("#runtime"),
  integrationsButton: document.querySelector("#integrations-button"),
  integrationsDialog: document.querySelector("#integrations-dialog"),
  integrationList: document.querySelector("#integration-list"),
  usage: document.querySelector("#usage"),
  refresh: document.querySelector("#refresh"),
  newConversation: document.querySelector("#new-conversation"),
  list: document.querySelector("#request-list"),
  empty: document.querySelector("#empty"),
  template: document.querySelector("#request-template"),
  tracePanel: document.querySelector("#trace-panel"),
  traceHeading: document.querySelector("#trace-heading"),
  traceEvents: document.querySelector("#trace-events"),
  copyTrace: document.querySelector("#copy-trace"),
  closeTrace: document.querySelector("#close-trace"),
  tokenDialog: document.querySelector("#token-dialog"),
  tokenForm: document.querySelector("#token-form"),
  token: document.querySelector("#token"),
  agentViewButton: document.querySelector("#agent-view-button"),
  viewSelector: document.querySelector("#view-selector"),
  agentView: document.querySelector("#agent-view"),
  calendarView: document.querySelector("#calendar-view"),
  todosView: document.querySelector("#todos-view"),
  contentView: document.querySelector("#content-view"),
  contactsView: document.querySelector("#contacts-view"),
  logsView: document.querySelector("#logs-view"),
  calendarMonthLabel: document.querySelector("#calendar-month-label"),
  calendarTimeZone: document.querySelector("#calendar-time-zone"),
  calendarGrid: document.querySelector("#calendar-grid"),
  calendarSearch: document.querySelector("#calendar-search"),
  calendarSearchIncludeArchived: document.querySelector("#calendar-search-include-archived"),
  calendarSearchResults: document.querySelector("#calendar-search-results"),
  calendarSearchCount: document.querySelector("#calendar-search-count"),
  calendarSearchResultList: document.querySelector("#calendar-search-result-list"),
  calendarLayout: document.querySelector("#calendar-layout"),
  calendarScheduleMode: document.querySelector("#calendar-schedule-mode"),
  calendarScheduleTask: document.querySelector("#calendar-schedule-task"),
  calendarScheduleHint: document.querySelector("#calendar-schedule-hint"),
  cancelCalendarSchedule: document.querySelector("#cancel-calendar-schedule"),
  agendaDate: document.querySelector("#agenda-date"),
  agendaList: document.querySelector("#agenda-list"),
  previousMonth: document.querySelector("#previous-month"),
  today: document.querySelector("#today"),
  nextMonth: document.querySelector("#next-month"),
  newEvent: document.querySelector("#new-event"),
  eventDialog: document.querySelector("#event-dialog"),
  eventForm: document.querySelector("#event-form"),
  eventDialogTitle: document.querySelector("#event-dialog-title"),
  eventId: document.querySelector("#event-id"),
  eventVersion: document.querySelector("#event-version"),
  eventTitle: document.querySelector("#event-title"),
  eventAllDay: document.querySelector("#event-all-day"),
  eventStart: document.querySelector("#event-start"),
  eventEnd: document.querySelector("#event-end"),
  eventLocation: document.querySelector("#event-location"),
  eventDescription: document.querySelector("#event-description"),
  eventStatus: document.querySelector("#event-status"),
  eventRepeatEnabled: document.querySelector("#event-repeat-enabled"),
  eventRepeatFields: document.querySelector("#event-repeat-fields"),
  eventRepeatInterval: document.querySelector("#event-repeat-interval"),
  eventRepeatFrequency: document.querySelector("#event-repeat-frequency"),
  eventRepeatWeekdays: document.querySelector("#event-repeat-weekdays"),
  eventRepeatEnd: document.querySelector("#event-repeat-end"),
  eventRepeatCountLabel: document.querySelector("#event-repeat-count-label"),
  eventRepeatCount: document.querySelector("#event-repeat-count"),
  eventRepeatUntilLabel: document.querySelector("#event-repeat-until-label"),
  eventRepeatUntil: document.querySelector("#event-repeat-until"),
  eventRepeatSummary: document.querySelector("#event-repeat-summary"),
  eventFormError: document.querySelector("#event-form-error"),
  eventInviteDraft: document.querySelector("#event-invite-draft"),
  eventInviteDialog: document.querySelector("#event-invite-dialog"),
  eventInviteForm: document.querySelector("#event-invite-form"),
  eventInviteTitle: document.querySelector("#event-invite-title"),
  eventInviteSearch: document.querySelector("#event-invite-search"),
  eventInviteContactList: document.querySelector("#event-invite-contact-list"),
  eventInviteFormError: document.querySelector("#event-invite-form-error"),
  eventInviteResult: document.querySelector("#event-invite-result"),
  eventInviteCount: document.querySelector("#event-invite-count"),
  eventInviteSubmit: document.querySelector("#event-invite-submit"),
  todoScope: document.querySelector("#todo-scope"),
  todoGroupFilter: document.querySelector("#todo-group-filter"),
  todoContactFilter: document.querySelector("#todo-contact-filter"),
  todoCount: document.querySelector("#todo-count"),
  moveOverdueTodos: document.querySelector("#move-overdue-todos"),
  todoList: document.querySelector("#todo-list"),
  newTodo: document.querySelector("#new-todo"),
  newTodoGroup: document.querySelector("#new-todo-group"),
  todoDialog: document.querySelector("#todo-dialog"),
  todoForm: document.querySelector("#todo-form"),
  todoDialogTitle: document.querySelector("#todo-dialog-title"),
  todoId: document.querySelector("#todo-id"),
  todoVersion: document.querySelector("#todo-version"),
  todoText: document.querySelector("#todo-text"),
  todoGroup: document.querySelector("#todo-group"),
  todoNewGroup: document.querySelector("#todo-new-group"),
  todoSequence: document.querySelector("#todo-sequence"),
  todoContact: document.querySelector("#todo-contact"),
  todoScheduled: document.querySelector("#todo-scheduled"),
  todoAllDay: document.querySelector("#todo-all-day"),
  todoDue: document.querySelector("#todo-due"),
  todoStatus: document.querySelector("#todo-status"),
  todoRepeatEnabled: document.querySelector("#todo-repeat-enabled"),
  todoRepeatFields: document.querySelector("#todo-repeat-fields"),
  todoRepeatInterval: document.querySelector("#todo-repeat-interval"),
  todoRepeatFrequency: document.querySelector("#todo-repeat-frequency"),
  todoRepeatWeekdays: document.querySelector("#todo-repeat-weekdays"),
  todoRepeatEnd: document.querySelector("#todo-repeat-end"),
  todoRepeatCountLabel: document.querySelector("#todo-repeat-count-label"),
  todoRepeatCount: document.querySelector("#todo-repeat-count"),
  todoRepeatUntilLabel: document.querySelector("#todo-repeat-until-label"),
  todoRepeatUntil: document.querySelector("#todo-repeat-until"),
  todoRepeatSummary: document.querySelector("#todo-repeat-summary"),
  todoFormError: document.querySelector("#todo-form-error"),
  contentSearch: document.querySelector("#content-search"),
  contentStatusFilter: document.querySelector("#content-status-filter"),
  contentGroupFilter: document.querySelector("#content-group-filter"),
  contentCount: document.querySelector("#content-count"),
  contentList: document.querySelector("#content-list"),
  newContent: document.querySelector("#new-content"),
  newContentGroup: document.querySelector("#new-content-group"),
  contentDialog: document.querySelector("#content-dialog"),
  contentForm: document.querySelector("#content-form"),
  contentDialogTitle: document.querySelector("#content-dialog-title"),
  contentId: document.querySelector("#content-id"),
  contentVersion: document.querySelector("#content-version"),
  contentTitle: document.querySelector("#content-title"),
  contentGroup: document.querySelector("#content-group"),
  contentNewGroup: document.querySelector("#content-new-group"),
  contentSequence: document.querySelector("#content-sequence"),
  contentType: document.querySelector("#content-type"),
  contentStatus: document.querySelector("#content-status"),
  contentHost: document.querySelector("#content-host"),
  contentPublished: document.querySelector("#content-published"),
  contentUrl: document.querySelector("#content-url"),
  contentDescription: document.querySelector("#content-description"),
  contentTranscript: document.querySelector("#content-transcript"),
  contentFormError: document.querySelector("#content-form-error"),
  contactSearch: document.querySelector("#contact-search"),
  contactTagFilter: document.querySelector("#contact-tag-filter"),
  contactRenameTag: document.querySelector("#contact-rename-tag"),
  contactIncludeInactive: document.querySelector("#contact-include-inactive"),
  reviewContactDuplicates: document.querySelector("#review-contact-duplicates"),
  contactCount: document.querySelector("#contact-count"),
  contactBulkActions: document.querySelector("#contact-bulk-actions"),
  contactSelectedCount: document.querySelector("#contact-selected-count"),
  contactBulkTag: document.querySelector("#contact-bulk-tag"),
  contactAddTag: document.querySelector("#contact-add-tag"),
  contactDeleteSelected: document.querySelector("#contact-delete-selected"),
  contactClearSelection: document.querySelector("#contact-clear-selection"),
  contactList: document.querySelector("#contact-list"),
  newContact: document.querySelector("#new-contact"),
  contactDialog: document.querySelector("#contact-dialog"),
  contactForm: document.querySelector("#contact-form"),
  contactDialogTitle: document.querySelector("#contact-dialog-title"),
  contactId: document.querySelector("#contact-id"),
  contactVersion: document.querySelector("#contact-version"),
  contactDisplayName: document.querySelector("#contact-display-name"),
  contactKind: document.querySelector("#contact-kind"),
  contactOrganizationName: document.querySelector("#contact-organization-name"),
  contactBirthDate: document.querySelector("#contact-birth-date"),
  contactTags: document.querySelector("#contact-tags"),
  contactStatus: document.querySelector("#contact-status"),
  contactNotes: document.querySelector("#contact-notes"),
  contactMethodList: document.querySelector("#contact-method-list"),
  addContactMethod: document.querySelector("#add-contact-method"),
  contactFormError: document.querySelector("#contact-form-error"),
  contactDuplicatesDialog: document.querySelector("#contact-duplicates-dialog"),
  contactDuplicateList: document.querySelector("#contact-duplicate-list"),
  logGroupFilter: document.querySelector("#log-group-filter"),
  logTrackerFilter: document.querySelector("#log-tracker-filter"),
  logCount: document.querySelector("#log-count"),
  logList: document.querySelector("#log-list"),
  newLogEntry: document.querySelector("#new-log-entry"),
  logDialog: document.querySelector("#log-dialog"),
  logForm: document.querySelector("#log-form"),
  logTracker: document.querySelector("#log-tracker"),
  newLogTrackerFields: document.querySelector("#new-log-tracker-fields"),
  logTrackerName: document.querySelector("#log-tracker-name"),
  logGroupName: document.querySelector("#log-group-name"),
  logGroupOptions: document.querySelector("#log-group-options"),
  logContent: document.querySelector("#log-content"),
  logNumber: document.querySelector("#log-number"),
  logUnit: document.querySelector("#log-unit"),
  logOccurred: document.querySelector("#log-occurred"),
  logFormError: document.querySelector("#log-form-error"),
};

let accessToken = localStorage.getItem("agent-slayer-token") || "";
let lastHealth = null;
let activeTrace = null;
let recorder = null;
let recordingStream = null;
let recordingChunks = [];
let recordingStartedAt = null;
let recordingTimer = null;
let activeView = "agent";
let calendarCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedCalendarDate = new Date();
let calendarEvents = [];
let calendarSearchTimer = null;
let calendarSearchSequence = 0;
let activeTodos = [];
let calendarSchedulingTodo = null;
let calendarSchedulingBusy = false;
let eventInviteEventId = null;
let eventInviteContacts = [];
let eventInviteSelectedContactIds = new Set();
let eventInviteCreated = false;
let displayedTodos = [];
let todoGroups = [];
let todoContacts = [];
let contentItems = [];
let contentGroups = [];
let contentSearchTimer = null;
let loadedTodoRecurrenceTimeZone = null;
let todoRecurrenceDirty = false;
let movingOverdueTodos = false;
let moveOverdueFeedbackTimer = null;
let contacts = [];
let contactDuplicateReview = { groups: [], hasMore: false };
const selectedContactIds = new Set();
let logTrackers = [];
let logEntries = [];
const requestNodes = new Map();

function authHeaders(extra = {}) {
  return { ...extra, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
}

async function api(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options, headers: authHeaders(options.headers) });
  let body;
  try { body = await response.json(); } catch { body = {}; }
  if (response.status === 401) {
    elements.tokenDialog.showModal();
    throw new Error("Access token required");
  }
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function node(tag, className = "", textContent = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (textContent !== "") element.textContent = textContent;
  return element;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

function updateRequestFileSelection() {
  const file = elements.requestFile.files?.[0] ?? null;
  elements.requestFileLabel.hidden = !file;
  elements.removeRequestFile.hidden = !file;
  elements.requestFileLabel.textContent = file ? `${file.name} · ${formatFileSize(file.size)}` : "";
}

async function copyText(text, button = null) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  if (button) {
    const original = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = original; }, 1200);
  }
}

function formatDisplayTime(value, { timeZone = null, fallback = "—" } = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    ...(timeZone ? { timeZone } : {}),
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => timeParts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")}`;
}

function formatDisplayDate(value, { includeTime = true, fallback = "—", timeZone = null } = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  const dateParts = new Intl.DateTimeFormat("en-GB", {
    ...(timeZone ? { timeZone } : {}),
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
  }).formatToParts(date);
  const part = (type) => dateParts.find((candidate) => candidate.type === type)?.value ?? "";
  const dateLabel = `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")}`;
  if (!includeTime) return dateLabel;
  return `${dateLabel} at ${formatDisplayTime(date, { timeZone, fallback })}`;
}

const recurrenceWeekdays = [
  ["MO", "Mon"], ["TU", "Tue"], ["WE", "Wed"], ["TH", "Thu"],
  ["FR", "Fri"], ["SA", "Sat"], ["SU", "Sun"],
];
const recurrenceFrequencyLabels = {
  DAILY: ["day", "days"], WEEKLY: ["week", "weeks"],
  MONTHLY: ["month", "months"], YEARLY: ["year", "years"],
};

function recurrenceParts(rule) {
  const values = {};
  for (const segment of String(rule || "").replace(/^RRULE:/i, "").split(";")) {
    const separator = segment.indexOf("=");
    if (separator > 0) values[segment.slice(0, separator).toUpperCase()] = segment.slice(separator + 1);
  }
  return values;
}

function selectedRepeatWeekdays() {
  return [...elements.todoRepeatWeekdays.querySelectorAll('input[type="checkbox"]:checked')]
    .map(({ value }) => value);
}

function repeatAnchorWeekday(value) {
  const date = value
    ? new Date(value.includes("T") ? value : `${value}T12:00:00`)
    : new Date();
  return ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][date.getDay()];
}

function scheduledWeekday() {
  return repeatAnchorWeekday(elements.todoScheduled.value);
}

function ensureRepeatWeekday() {
  if (elements.todoRepeatFrequency.value !== "WEEKLY" || selectedRepeatWeekdays().length) return;
  const fallback = scheduledWeekday();
  const checkbox = elements.todoRepeatWeekdays.querySelector(`input[value="${fallback}"]`);
  if (checkbox) checkbox.checked = true;
}

function buildTodoRecurrenceRule() {
  if (!elements.todoRepeatEnabled.checked) return null;
  const interval = Number(elements.todoRepeatInterval.value);
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) {
    throw new Error("Repeat interval must be a whole number from 1 to 999.");
  }
  const frequency = elements.todoRepeatFrequency.value;
  const parts = [`FREQ=${frequency}`, `INTERVAL=${interval}`];
  if (frequency === "WEEKLY") {
    ensureRepeatWeekday();
    const weekdays = selectedRepeatWeekdays();
    if (!weekdays.length) throw new Error("Choose at least one weekday.");
    parts.push(`BYDAY=${weekdays.join(",")}`);
  }
  if (elements.todoRepeatEnd.value === "count") {
    const count = Number(elements.todoRepeatCount.value);
    if (!Number.isInteger(count) || count < 1 || count > 9999) {
      throw new Error("Occurrences must be a whole number from 1 to 9999.");
    }
    parts.push(`COUNT=${count}`);
  } else if (elements.todoRepeatEnd.value === "until") {
    const until = elements.todoRepeatUntil.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("Choose the last recurrence date.");
    parts.push(`UNTIL=${until.replaceAll("-", "")}T235959`);
  }
  return parts.join(";");
}

function describeTodoRecurrence(rule) {
  if (!rule) return "Does not repeat";
  const parts = recurrenceParts(rule);
  const interval = Math.max(1, Number(parts.INTERVAL) || 1);
  const labels = recurrenceFrequencyLabels[parts.FREQ] || ["period", "periods"];
  let description = interval === 1 ? `Every ${labels[0]}` : `Every ${interval} ${labels[1]}`;
  if (parts.FREQ === "WEEKLY" && parts.BYDAY) {
    const labelsByValue = Object.fromEntries(recurrenceWeekdays);
    const days = parts.BYDAY.split(",").map((day) => labelsByValue[day] || day);
    description += ` on ${days.join(", ")}`;
  }
  if (parts.COUNT) description += `, ${parts.COUNT} occurrences`;
  if (parts.UNTIL) {
    const match = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL);
    if (match) description += `, through ${formatDisplayDate(new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00`), { includeTime: false })}`;
  }
  return description;
}

function updateTodoRecurrenceEditor() {
  const enabled = elements.todoRepeatEnabled.checked;
  elements.todoRepeatFields.hidden = !enabled;
  if (!enabled) return;
  const weekly = elements.todoRepeatFrequency.value === "WEEKLY";
  elements.todoRepeatWeekdays.hidden = !weekly;
  if (weekly) ensureRepeatWeekday();
  const ending = elements.todoRepeatEnd.value;
  elements.todoRepeatCountLabel.hidden = ending !== "count";
  elements.todoRepeatUntilLabel.hidden = ending !== "until";
  try {
    elements.todoRepeatSummary.textContent = describeTodoRecurrence(buildTodoRecurrenceRule());
  } catch (error) {
    elements.todoRepeatSummary.textContent = error.message;
  }
}

function loadTodoRecurrenceEditor(rule, recurrenceTimeZone = null) {
  loadedTodoRecurrenceTimeZone = recurrenceTimeZone || null;
  todoRecurrenceDirty = false;
  const parts = recurrenceParts(rule);
  elements.todoRepeatEnabled.checked = Boolean(rule);
  elements.todoRepeatFrequency.value = recurrenceFrequencyLabels[parts.FREQ] ? parts.FREQ : "WEEKLY";
  elements.todoRepeatInterval.value = String(Math.max(1, Number(parts.INTERVAL) || 1));
  for (const checkbox of elements.todoRepeatWeekdays.querySelectorAll('input[type="checkbox"]')) {
    checkbox.checked = (parts.BYDAY || "").split(",").includes(checkbox.value);
  }
  elements.todoRepeatEnd.value = parts.COUNT ? "count" : parts.UNTIL ? "until" : "never";
  elements.todoRepeatCount.value = parts.COUNT || "10";
  const untilMatch = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL || "");
  elements.todoRepeatUntil.value = untilMatch ? `${untilMatch[1]}-${untilMatch[2]}-${untilMatch[3]}` : "";
  updateTodoRecurrenceEditor();
}

function selectedEventRepeatWeekdays() {
  return [...elements.eventRepeatWeekdays.querySelectorAll('input[type="checkbox"]:checked')]
    .map(({ value }) => value);
}

function ensureEventRepeatWeekday() {
  if (elements.eventRepeatFrequency.value !== "WEEKLY" || selectedEventRepeatWeekdays().length) return;
  const weekday = repeatAnchorWeekday(elements.eventStart.value);
  const checkbox = elements.eventRepeatWeekdays.querySelector(`input[value="${weekday}"]`);
  if (checkbox) checkbox.checked = true;
}

function buildEventRecurrenceRule() {
  if (!elements.eventRepeatEnabled.checked) return null;
  const interval = Number(elements.eventRepeatInterval.value);
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) {
    throw new Error("Repeat interval must be a whole number from 1 to 999.");
  }
  const frequency = elements.eventRepeatFrequency.value;
  const parts = [`FREQ=${frequency}`, `INTERVAL=${interval}`];
  if (frequency === "WEEKLY") {
    ensureEventRepeatWeekday();
    const weekdays = selectedEventRepeatWeekdays();
    if (!weekdays.length) throw new Error("Choose at least one weekday.");
    parts.push(`BYDAY=${weekdays.join(",")}`);
  }
  if (elements.eventRepeatEnd.value === "count") {
    const count = Number(elements.eventRepeatCount.value);
    if (!Number.isInteger(count) || count < 1 || count > 9999) {
      throw new Error("Occurrences must be a whole number from 1 to 9999.");
    }
    parts.push(`COUNT=${count}`);
  } else if (elements.eventRepeatEnd.value === "until") {
    const until = elements.eventRepeatUntil.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("Choose the last recurrence date.");
    parts.push(`UNTIL=${until.replaceAll("-", "")}T235959`);
  }
  return parts.join(";");
}

function updateEventRecurrenceEditor() {
  const enabled = elements.eventRepeatEnabled.checked;
  elements.eventRepeatFields.hidden = !enabled;
  if (!enabled) return;
  const weekly = elements.eventRepeatFrequency.value === "WEEKLY";
  elements.eventRepeatWeekdays.hidden = !weekly;
  if (weekly) ensureEventRepeatWeekday();
  const ending = elements.eventRepeatEnd.value;
  elements.eventRepeatCountLabel.hidden = ending !== "count";
  elements.eventRepeatUntilLabel.hidden = ending !== "until";
  try {
    elements.eventRepeatSummary.textContent = describeTodoRecurrence(buildEventRecurrenceRule());
  } catch (error) {
    elements.eventRepeatSummary.textContent = error.message;
  }
}

function loadEventRecurrenceEditor(rule) {
  const parts = recurrenceParts(rule);
  elements.eventRepeatEnabled.checked = Boolean(rule);
  elements.eventRepeatFrequency.value = recurrenceFrequencyLabels[parts.FREQ] ? parts.FREQ : "WEEKLY";
  elements.eventRepeatInterval.value = String(Math.max(1, Number(parts.INTERVAL) || 1));
  for (const checkbox of elements.eventRepeatWeekdays.querySelectorAll('input[type="checkbox"]')) {
    checkbox.checked = (parts.BYDAY || "").split(",").includes(checkbox.value);
  }
  elements.eventRepeatEnd.value = parts.COUNT ? "count" : parts.UNTIL ? "until" : "never";
  elements.eventRepeatCount.value = parts.COUNT || "10";
  const untilMatch = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL || "");
  elements.eventRepeatUntil.value = untilMatch ? `${untilMatch[1]}-${untilMatch[2]}-${untilMatch[3]}` : "";
  updateEventRecurrenceEditor();
}

function formatTime(milliseconds) {
  return formatDisplayDate(milliseconds);
}

function formatClock(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, Number(milliseconds) || 0) / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function formatDuration(milliseconds) {
  const seconds = Number(milliseconds) / 1000;
  if (!Number.isFinite(seconds)) return "—";
  return `${Math.max(.1, seconds).toFixed(1)} s`;
}

function progressDetail(progress) {
  if (!progress) return "";
  const elapsedMs = Math.max(0, Date.now() - Number(progress.startedAtMs || Date.now()));
  const quietMs = Math.max(0, Date.now() - Number(progress.lastActivityAtMs || progress.startedAtMs || Date.now()));
  const parts = [`${formatDuration(elapsedMs)} elapsed`];
  if (progress.modelCalls) parts.push(`${progress.modelCalls} model call${progress.modelCalls === 1 ? "" : "s"}`);
  if (progress.toolCalls) parts.push(`${progress.toolCalls} tool call${progress.toolCalls === 1 ? "" : "s"}`);
  if (elapsedMs >= 120_000) parts.unshift("Still working");
  if (quietMs >= 60_000) parts.push(`${formatDuration(quietMs)} since last activity`);
  return parts.join(" · ");
}

function updateProgressClocks() {
  for (const progress of document.querySelectorAll(".request-progress[data-progress]")) {
    try {
      progress.querySelector(".progress-detail").textContent = progressDetail(JSON.parse(progress.dataset.progress));
    } catch {
      // The next request poll replaces malformed progress state.
    }
  }
}

function usageWindows(usage) {
  return (usage?.buckets ?? []).flatMap((bucket) => ["primary", "secondary"].flatMap((kind) => {
    const window = bucket[kind];
    return window ? [{ ...window, bucketId: bucket.id, bucketName: bucket.name, kind }] : [];
  }));
}

function resetLabel(timestamp) {
  if (!timestamp) return "reset unknown";
  const milliseconds = Math.max(0, timestamp * 1000 - Date.now());
  const minutes = Math.ceil(milliseconds / 60000);
  if (minutes < 60) return `resets in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `resets in ${hours}h ${remainder}m`;
}

function healthUsageLabel(model) {
  const name = model?.displayName || "Model";
  const windows = usageWindows(model?.usage).filter((window) => Number.isFinite(window.remainingPercent));
  if (!windows.length) return `${name} usage unavailable`;
  const limiting = windows.toSorted((left, right) => left.remainingPercent - right.remainingPercent)[0];
  return `${name} ${limiting.remainingPercent}% left · ${resetLabel(limiting.resetsAt)}`;
}

function requestUsageLabel(usage) {
  if (!usage) return "";
  const deltas = (usage.windows ?? []).map((window) => window.usedPercentDelta).filter(Number.isFinite);
  const largestDelta = deltas.length ? Math.max(...deltas) : null;
  const tokens = usage.tokenUsage?.totalTokens;
  const parts = [];
  if (largestDelta == null) parts.push("quota update pending");
  else if (largestDelta === 0) parts.push("quota change <1%");
  else parts.push(`+${largestDelta}% quota`);
  if (Number.isFinite(tokens)) parts.push(`${tokens.toLocaleString()} tokens`);
  const remaining = (usage.windows ?? []).map((window) => window.remainingPercent).filter(Number.isFinite);
  if (remaining.length) parts.push(`${Math.min(...remaining)}% left`);
  return parts.join(" · ");
}

function selectionTouchesRequests() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  return elements.list.contains(range.commonAncestorContainer) || range.intersectsNode(elements.list);
}

function requestNode(request, index) {
  let node = requestNodes.get(request.requestId);
  if (!node) {
    node = elements.template.content.firstElementChild.cloneNode(true);
    node.dataset.requestId = request.requestId;
    node.querySelector(".request-number").addEventListener("click", (event) => {
      copyText(request.requestId, event.currentTarget);
    });
    node.querySelector(".copy-response").addEventListener("click", (event) => {
      copyText(node.querySelector(".agent-response p").textContent, event.currentTarget);
    });
    node.querySelector(".show-trace").addEventListener("click", () => showTrace(request.requestId));
    requestNodes.set(request.requestId, node);
  }
  node.dataset.status = request.status;
  node.querySelector(".conversation-start").hidden = !request.conversationStarted;
  const requestNumber = node.querySelector(".request-number");
  requestNumber.textContent = `Request ${request.requestId.slice(0, 8)}`;
  requestNumber.title = `Copy request ID ${request.requestId}`;
  requestNumber.setAttribute("aria-label", `Copy request ID ${request.requestId}`);
  node.querySelector(".request-channel").textContent = request.channel === "voice" ? "Voice" : "Typed";
  node.querySelector(".request-status").textContent = request.status;
  const time = node.querySelector("time");
  time.dateTime = new Date(request.submittedAtMs).toISOString();
  time.textContent = formatTime(request.submittedAtMs);
  const elapsed = node.querySelector(".request-elapsed");
  elapsed.textContent = Number.isFinite(request.elapsedMs) ? `${formatDuration(request.elapsedMs)} elapsed` : "";
  elapsed.hidden = !elapsed.textContent;
  node.querySelector(".user-request").textContent = request.request;
  const response = node.querySelector(".agent-response");
  response.hidden = !request.response;
  if (request.response) response.querySelector("p").textContent = request.response;
  const error = node.querySelector(".request-error");
  error.hidden = !request.error;
  error.textContent = request.error || "";
  const usage = node.querySelector(".request-usage");
  usage.textContent = requestUsageLabel(request.usage);
  usage.hidden = !usage.textContent;
  const progress = node.querySelector(".request-progress");
  progress.hidden = !request.progress;
  if (request.progress) {
    progress.dataset.progress = JSON.stringify(request.progress);
    progress.querySelector(".progress-label").textContent = request.progress.label;
    progress.querySelector(".progress-detail").textContent = progressDetail(request.progress);
  } else {
    delete progress.dataset.progress;
  }
  node.style.order = index;
  return node;
}

async function loadRequests({ force = false } = {}) {
  if (!force && selectionTouchesRequests()) return;
  const body = await api("/api/requests?limit=100");
  const seen = new Set();
  body.requests.forEach((request, index) => {
    seen.add(request.requestId);
    const node = requestNode(request, index);
    if (!node.isConnected) elements.list.append(node);
  });
  for (const [id, node] of requestNodes) {
    if (!seen.has(id)) { node.remove(); requestNodes.delete(id); }
  }
  elements.empty.hidden = body.requests.length > 0;
}

function traceLabel(event, index) {
  const labels = {
    "request.received": "USER REQUEST",
    "context.sent": "CONTEXT SENT",
    "tools.sent": "TOOLS SENT",
    "model.request": "MODEL REQUEST",
    "model.response": "MODEL RESPONSE",
    "model.usage": "MODEL USAGE",
    "tool.call": "TOOL CALL",
    "tool.result": "TOOL RESULT",
    "assistant.response": "FINAL RESPONSE",
  };
  return `${index + 1}. ${labels[event.type] || event.type.toUpperCase()} · ${event.status || event.phase}`;
}

async function showTrace(requestId) {
  const body = await api(`/api/requests/${requestId}/trace`);
  activeTrace = body;
  elements.traceHeading.textContent = `Trace ${requestId.slice(0, 8)}`;
  elements.traceEvents.replaceChildren();
  body.events.forEach((event, index) => {
    const details = document.createElement("details");
    details.className = "trace-event";
    if (["request.received", "context.sent", "tools.sent", "model.request", "tool.call", "tool.result", "assistant.response", "request.error"].includes(event.type)) details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = traceLabel(event, index);
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(event, null, 2);
    details.append(summary, pre);
    elements.traceEvents.append(details);
  });
  elements.tracePanel.hidden = false;
  elements.tracePanel.scrollTop = 0;
}

async function loadHealth() {
  const response = await fetch("/health", { cache: "no-store" });
  let body;
  try { body = await response.json(); } catch { body = { ready: false, error: `Invalid health response (${response.status})` }; }
  lastHealth = { checkedAtUtc: new Date().toISOString(), httpStatus: response.status, body };
  const commit = body.runtime?.commit || "uncommitted";
  elements.runtime.textContent = `${commit}${body.runtime?.dirty ? "-dirty" : ""}`;
  elements.runtime.classList.toggle("ready", Boolean(body.ready));
  elements.runtime.classList.toggle("not-ready", !body.ready);
  elements.runtime.title = `${body.ready ? "Ready" : "Not ready"}. Click to copy full health diagnostics.`;
  elements.usage.textContent = healthUsageLabel(body.model);
  elements.usage.classList.toggle("ready", Boolean(body.model?.usage));
  elements.usage.classList.toggle("not-ready", !body.model?.usage);
  renderIntegrations(body.integrations ?? {});
  updateEventInviteDraftAvailability();
}

function renderIntegrations(integrations) {
  const oauthEntries = Object.entries(integrations).filter(([, integration]) => integration.oauth);
  const connected = oauthEntries.filter(([, integration]) => integration.ready).length;
  elements.integrationsButton.textContent = connected ? `Integrations · ${connected}` : "Integrations";
  elements.integrationsButton.classList.toggle("ready", connected > 0);
  elements.integrationList.replaceChildren();
  if (oauthEntries.length === 0) {
    elements.integrationList.append(node("p", "empty", "No OAuth integrations are configured."));
    return;
  }
  for (const [name, integration] of oauthEntries) {
    const card = node("article", "integration-card");
    const identity = node("div", "integration-identity");
    identity.append(
      node("strong", "", name),
      node("span", "", integration.disabled ? "Disabled" : integration.ready ? "Connected" : "Disconnected"),
    );
    card.classList.toggle("ready", Boolean(integration.ready));
    card.append(identity);
    if (!integration.disabled) {
      const action = node("button", integration.ready ? "secondary compact disconnect-integration" : "compact connect-integration");
      action.type = "button";
      action.dataset.name = name;
      action.textContent = integration.ready ? "Disconnect" : "Connect";
      card.append(action);
    }
    elements.integrationList.append(card);
  }
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
}

function localDateTimeInput(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return `${localDateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function inputToIso(value, allDay = false) {
  if (!value) return null;
  const date = new Date(allDay && !value.includes("T") ? `${value}T00:00` : value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function startOfDay(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function monthGridRange(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const gridStart = addDays(first, -((first.getDay() + 6) % 7));
  const gridEnd = addDays(last, 7 - ((last.getDay() + 6) % 7));
  return { first, gridStart, gridEnd };
}

function occursOnDay(calendarEvent, day) {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  const start = new Date(calendarEvent.startsAtUtc).getTime();
  const end = calendarEvent.endsAtUtc ? new Date(calendarEvent.endsAtUtc).getTime() : start;
  return start < dayEnd && (end > dayStart || (start >= dayStart && start < dayEnd));
}

function todosDueOnDay(day) {
  const key = localDateKey(day);
  return activeTodos.filter((todo) => todo.dueAtUtc && localDateKey(todo.dueAtUtc) === key);
}

function todosScheduledOnDay(day) {
  const key = localDateKey(day);
  return activeTodos.filter((todo) => todo.scheduledAtUtc && localDateKey(todo.scheduledAtUtc) === key);
}

function formatEventTime(calendarEvent) {
  if (calendarEvent.isAllDay) return "";
  const timeZone = calendarEvent.timeZone || null;
  const start = formatDisplayTime(calendarEvent.startsAtUtc, { timeZone });
  return calendarEvent.endsAtUtc
    ? `${start}–${formatDisplayTime(calendarEvent.endsAtUtc, { timeZone })}`
    : start;
}

function calendarEventCopyText(calendarEvent) {
  const timeZone = calendarEvent.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const start = new Date(calendarEvent.startsAtUtc);
  const end = calendarEvent.endsAtUtc ? new Date(calendarEvent.endsAtUtc) : null;
  const date = (value) => formatDisplayDate(value, { includeTime: false, timeZone });
  const dateTime = (value) => formatDisplayDate(value, { timeZone });
  const time = (value) => formatDisplayTime(value, { timeZone });
  let when;
  if (calendarEvent.isAllDay) {
    const startDate = date(start);
    const inclusiveEnd = end && end > start ? new Date(end.getTime() - 1) : null;
    const endDate = inclusiveEnd ? date(inclusiveEnd) : null;
    when = endDate && endDate !== startDate ? `${startDate}–${endDate} · All day` : `${startDate} · All day`;
  } else if (!end) {
    when = dateTime(start);
  } else if (date(start) === date(end)) {
    when = `${dateTime(start)}–${time(end)}`;
  } else {
    when = `${dateTime(start)}–${dateTime(end)}`;
  }
  const lines = [calendarEvent.title, `When: ${when}`];
  if (!calendarEvent.isAllDay) lines.push(`Time zone: ${timeZone}`);
  if (calendarEvent.recurrenceRule) lines.push(`Repeats: ${describeTodoRecurrence(calendarEvent.recurrenceRule)}`);
  if (calendarEvent.location) lines.push(`Where: ${calendarEvent.location}`);
  if (calendarEvent.description) lines.push("", calendarEvent.description);
  return lines.join("\n");
}

function switchView(view) {
  if (view !== "calendar" && calendarSchedulingTodo) cancelCalendarScheduling({ render: false });
  activeView = view;
  elements.agentView.hidden = view !== "agent";
  elements.calendarView.hidden = view !== "calendar";
  elements.todosView.hidden = view !== "todos";
  elements.contentView.hidden = view !== "content";
  elements.contactsView.hidden = view !== "contacts";
  elements.logsView.hidden = view !== "logs";
  elements.agentViewButton.classList.toggle("active", view === "agent");
  if (view === "agent") {
    elements.agentViewButton.setAttribute("aria-current", "page");
    elements.viewSelector.value = "";
  } else {
    elements.agentViewButton.removeAttribute("aria-current");
    elements.viewSelector.value = view;
  }
  if (view === "calendar") void refreshCalendar();
  if (view === "todos") void refreshTodos();
  if (view === "content") void refreshContent();
  if (view === "contacts") void refreshContacts();
  if (view === "logs") void refreshLogs();
}

async function refreshCalendar() {
  const { gridStart, gridEnd } = monthGridRange(calendarCursor);
  try {
    const [calendarBody, todoBody, groupBody] = await Promise.all([
      api(`/api/calendar-events?from=${encodeURIComponent(gridStart.toISOString())}&to=${encodeURIComponent(gridEnd.toISOString())}`),
      api("/api/todos?scope=active&limit=1000"),
      api("/api/todo-groups"),
    ]);
    calendarEvents = calendarBody.events;
    activeTodos = todoBody.todos;
    todoGroups = groupBody.groups;
    if (calendarSchedulingTodo) {
      calendarSchedulingTodo = activeTodos.find(({ id }) => id === calendarSchedulingTodo.id) ?? null;
      updateCalendarSchedulingMode();
    }
    renderCalendar();
    if (elements.calendarSearch.value.trim()) void searchCalendarEvents();
  } catch (error) {
    elements.calendarGrid.replaceChildren(node("p", "empty", error.message || "Calendar unavailable."));
  }
}

function setCalendarSearchMode(enabled) {
  elements.calendarSearchResults.hidden = !enabled;
  elements.calendarLayout.hidden = enabled;
  if (enabled) elements.calendarMonthLabel.textContent = "Search calendar";
}

function formatCalendarSearchWhen(calendarEvent) {
  const timeZone = calendarEvent.timeZone || null;
  const start = formatDisplayDate(calendarEvent.startsAtUtc, {
    includeTime: !calendarEvent.isAllDay,
    timeZone,
  });
  if (!calendarEvent.endsAtUtc) return start;
  if (calendarEvent.isAllDay) {
    const inclusiveEnd = new Date(new Date(calendarEvent.endsAtUtc).getTime() - 1);
    const end = formatDisplayDate(inclusiveEnd, { includeTime: false, timeZone });
    return end === start ? start : `${start} – ${end}`;
  }
  const endDate = formatDisplayDate(calendarEvent.endsAtUtc, { includeTime: false, timeZone });
  const startDate = formatDisplayDate(calendarEvent.startsAtUtc, { includeTime: false, timeZone });
  return endDate === startDate
    ? `${start}–${formatDisplayTime(calendarEvent.endsAtUtc, { timeZone })}`
    : `${start} – ${formatDisplayDate(calendarEvent.endsAtUtc, { timeZone })}`;
}

function renderCalendarSearchResults(events, { error = null } = {}) {
  elements.calendarSearchResultList.replaceChildren();
  if (error) {
    elements.calendarSearchCount.textContent = "Search unavailable";
    elements.calendarSearchResultList.append(node("p", "empty", error));
    return;
  }
  elements.calendarSearchCount.textContent = `${events.length} ${events.length === 1 ? "event" : "events"}`;
  if (events.length === 0) {
    elements.calendarSearchResultList.append(node("p", "empty", "No stored calendar events match that search."));
    return;
  }
  for (const calendarEvent of events) {
    const item = node("article", "calendar-search-result");
    const open = node("button", "calendar-search-result-open");
    open.type = "button";
    open.append(
      node("strong", "", calendarEvent.title),
      node("span", "calendar-search-result-when", formatCalendarSearchWhen(calendarEvent)),
    );
    const details = [
      calendarEvent.location,
      calendarEvent.recurrenceRule ? describeTodoRecurrence(calendarEvent.recurrenceRule) : null,
      calendarEvent.status === "archived" ? "Archived" : null,
    ].filter(Boolean);
    if (details.length) open.append(node("span", "calendar-search-result-meta", details.join(" · ")));
    if (calendarEvent.description) open.append(node("span", "calendar-search-result-description", calendarEvent.description));
    open.addEventListener("click", () => openEventEditor(calendarEvent));
    const copy = node("button", "secondary compact", "Copy details");
    copy.type = "button";
    copy.setAttribute("aria-label", `Copy calendar event details: ${calendarEvent.title}`);
    copy.addEventListener("click", (event) => void copyText(calendarEventCopyText(calendarEvent), event.currentTarget));
    item.append(open, copy);
    elements.calendarSearchResultList.append(item);
  }
}

async function searchCalendarEvents() {
  const query = elements.calendarSearch.value.trim();
  const sequence = ++calendarSearchSequence;
  if (!query) {
    setCalendarSearchMode(false);
    renderCalendar();
    return;
  }
  setCalendarSearchMode(true);
  elements.calendarSearchCount.textContent = "Searching…";
  elements.calendarSearchResultList.replaceChildren();
  try {
    const parameters = new URLSearchParams({
      q: query,
      includeArchived: String(elements.calendarSearchIncludeArchived.checked),
      limit: "200",
    });
    const body = await api(`/api/calendar-events/search?${parameters}`);
    if (sequence !== calendarSearchSequence) return;
    renderCalendarSearchResults(body.events);
  } catch (error) {
    if (sequence !== calendarSearchSequence) return;
    renderCalendarSearchResults([], { error: error.message || "Calendar search unavailable." });
  }
}

function queueCalendarSearch() {
  clearTimeout(calendarSearchTimer);
  if (!elements.calendarSearch.value.trim()) {
    void searchCalendarEvents();
    return;
  }
  calendarSearchTimer = setTimeout(() => void searchCalendarEvents(), 200);
}

function renderCalendar() {
  const { first, gridStart, gridEnd } = monthGridRange(calendarCursor);
  elements.calendarMonthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(first);
  elements.calendarTimeZone.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
  elements.calendarGrid.replaceChildren();
  const todayKey = localDateKey(new Date());
  const selectedKey = localDateKey(selectedCalendarDate);
  for (let day = new Date(gridStart); day < gridEnd; day = addDays(day, 1)) {
    const date = new Date(day);
    const events = calendarEvents.filter((calendarEvent) => occursOnDay(calendarEvent, date));
    const scheduled = todosScheduledOnDay(date);
    const due = todosDueOnDay(date);
    const button = node("button", "calendar-day");
    button.type = "button";
    button.classList.toggle("outside", date.getMonth() !== calendarCursor.getMonth());
    button.classList.toggle("today", localDateKey(date) === todayKey);
    button.classList.toggle("selected", localDateKey(date) === selectedKey);
    button.setAttribute("aria-label", formatDisplayDate(date, { includeTime: false }));
    button.append(node("span", "day-number", String(date.getDate())));
    const items = node("span", "day-items");
    const visible = [
      ...events.map((value) => ({ type: "event", value })),
      ...scheduled.map((value) => ({ type: "todo", value, marker: value.isAllDay ? "All day" : "◷" })),
      ...due.map((value) => ({ type: "todo", value, marker: "Due" })),
    ];
    for (const item of visible.slice(0, 3)) {
      items.append(item.type === "event"
        ? node("span", `day-event ${item.value.status}`, `${item.value.isAllDay ? "" : `${formatEventTime(item.value)} `}${item.value.title}`)
        : node("span", "day-todo", `${item.marker} ${item.value.text}`));
    }
    if (visible.length > 3) items.append(node("span", "day-more", `+${visible.length - 3} more`));
    button.append(items);
    button.disabled = calendarSchedulingBusy;
    button.addEventListener("click", () => {
      if (calendarSchedulingTodo) void scheduleTodoOnDate(date);
      else {
        selectedCalendarDate = date;
        renderCalendar();
      }
    });
    elements.calendarGrid.append(button);
  }
  renderAgenda();
}

function scheduledDateOnDay(_todo, date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function updateCalendarSchedulingMode() {
  const todo = calendarSchedulingTodo;
  elements.calendarView.classList.toggle("scheduling", Boolean(todo));
  elements.calendarScheduleMode.hidden = !todo;
  elements.cancelCalendarSchedule.disabled = calendarSchedulingBusy;
  if (!todo) return;
  elements.calendarScheduleTask.textContent = todo.text;
  elements.calendarScheduleHint.textContent = "Choose a day. This task will be scheduled for that whole day.";
}

function beginCalendarScheduling(todo) {
  elements.calendarSearch.value = "";
  calendarSearchSequence += 1;
  setCalendarSearchMode(false);
  calendarSchedulingTodo = todo;
  calendarSchedulingBusy = false;
  if (todo.scheduledAtUtc) {
    selectedCalendarDate = new Date(todo.scheduledAtUtc);
    calendarCursor = new Date(selectedCalendarDate.getFullYear(), selectedCalendarDate.getMonth(), 1);
  } else {
    selectedCalendarDate = new Date();
    calendarCursor = new Date(selectedCalendarDate.getFullYear(), selectedCalendarDate.getMonth(), 1);
  }
  updateCalendarSchedulingMode();
  switchView("calendar");
}

function cancelCalendarScheduling({ render = true } = {}) {
  calendarSchedulingTodo = null;
  calendarSchedulingBusy = false;
  updateCalendarSchedulingMode();
  if (render && activeView === "calendar") renderCalendar();
}

async function scheduleTodoOnDate(date) {
  if (!calendarSchedulingTodo || calendarSchedulingBusy) return;
  const todo = calendarSchedulingTodo;
  const scheduled = scheduledDateOnDay(todo, date);
  const payload = { version: todo.version, scheduledAtUtc: scheduled.toISOString(), isAllDay: true };
  if (todo.scheduledAtUtc && todo.dueAtUtc) {
    const previousScheduled = new Date(todo.scheduledAtUtc);
    const dayDifference = Math.round((
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
      - Date.UTC(previousScheduled.getFullYear(), previousScheduled.getMonth(), previousScheduled.getDate())
    ) / 86_400_000);
    const movedDue = new Date(todo.dueAtUtc);
    movedDue.setDate(movedDue.getDate() + dayDifference);
    payload.dueAtUtc = movedDue.toISOString();
  }
  calendarSchedulingBusy = true;
  updateCalendarSchedulingMode();
  renderCalendar();
  try {
    await api(`/api/todos/${todo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    selectedCalendarDate = new Date(date);
    cancelCalendarScheduling({ render: false });
    await refreshCalendar();
  } catch (error) {
    calendarSchedulingBusy = false;
    updateCalendarSchedulingMode();
    renderCalendar();
    window.alert(error.message || "Could not schedule the task.");
  }
}

function renderAgenda() {
  const events = calendarEvents.filter((calendarEvent) => occursOnDay(calendarEvent, selectedCalendarDate));
  const todoEntries = [
    ...todosScheduledOnDay(selectedCalendarDate).map((todo) => ({
      todo, timing: todo.isAllDay ? "All-day task" : "Scheduled task",
    })),
    ...todosDueOnDay(selectedCalendarDate).map((todo) => ({ todo, timing: "Task due" })),
  ];
  elements.agendaDate.textContent = formatDisplayDate(selectedCalendarDate, { includeTime: false });
  elements.agendaList.replaceChildren();
  if (events.length === 0 && todoEntries.length === 0) {
    elements.agendaList.append(node("p", "agenda-empty", "Nothing scheduled. Add an event here or tell Slayer what to put on the calendar."));
    return;
  }
  for (const calendarEvent of events) {
    const item = node("div", "agenda-event");
    const button = node("button", "agenda-item");
    button.type = "button";
    button.append(
      node("strong", "", calendarEvent.title),
      node("span", "", [formatEventTime(calendarEvent), calendarEvent.location].filter(Boolean).join(" · ")),
    );
    if (calendarEvent.seriesId) {
      button.title = "Edit this recurring event series.";
      button.addEventListener("click", () => openEventEditor({
        ...calendarEvent,
        id: calendarEvent.seriesId,
        startsAtUtc: calendarEvent.seriesStartsAtUtc,
        endsAtUtc: calendarEvent.seriesEndsAtUtc,
        readOnly: false,
      }));
    } else if (calendarEvent.readOnly) {
      button.disabled = true;
      button.title = "This item is generated from a contact record.";
    } else {
      button.addEventListener("click", () => openEventEditor(calendarEvent));
    }
    const copy = node("button", "secondary compact agenda-event-copy", "Copy details");
    copy.type = "button";
    copy.setAttribute("aria-label", `Copy calendar event details: ${calendarEvent.title}`);
    copy.addEventListener("click", (event) => void copyText(calendarEventCopyText(calendarEvent), event.currentTarget));
    item.append(button, copy);
    elements.agendaList.append(item);
  }
  for (const { todo, timing } of todoEntries) {
    const button = node("button", "agenda-item todo");
    button.type = "button";
    button.append(node("strong", "", todo.text), node("span", "", `${timing} · ${todo.status.replaceAll("_", " ")}`));
    button.addEventListener("click", () => openTodoEditor(todo));
    elements.agendaList.append(button);
  }
}

function setEventInputTypes(allDay) {
  const oldStart = elements.eventStart.value;
  const oldEnd = elements.eventEnd.value;
  elements.eventStart.type = allDay ? "date" : "datetime-local";
  elements.eventEnd.type = allDay ? "date" : "datetime-local";
  if (allDay) {
    elements.eventStart.value = oldStart.slice(0, 10);
    elements.eventEnd.value = oldEnd.slice(0, 10);
  } else {
    elements.eventStart.value = oldStart ? `${oldStart.slice(0, 10)}T09:00` : "";
    elements.eventEnd.value = oldEnd ? `${oldEnd.slice(0, 10)}T10:00` : "";
  }
}

function setTodoScheduledInputType(allDay) {
  const previous = elements.todoScheduled.value;
  elements.todoScheduled.type = allDay ? "date" : "datetime-local";
  if (allDay) elements.todoScheduled.value = previous.slice(0, 10);
  else if (previous) elements.todoScheduled.value = `${previous.slice(0, 10)}T09:00`;
}

function openEventEditor(calendarEvent = null) {
  elements.eventForm.reset();
  elements.eventFormError.textContent = "";
  elements.eventDialogTitle.textContent = calendarEvent ? "Edit event" : "New event";
  elements.eventId.value = calendarEvent?.id ?? "";
  elements.eventVersion.value = calendarEvent?.version ?? "";
  elements.eventTitle.value = calendarEvent?.title ?? "";
  elements.eventAllDay.checked = Boolean(calendarEvent?.isAllDay);
  setEventInputTypes(Boolean(calendarEvent?.isAllDay));
  if (calendarEvent) {
    elements.eventStart.value = calendarEvent.isAllDay ? localDateKey(calendarEvent.startsAtUtc) : localDateTimeInput(calendarEvent.startsAtUtc);
    elements.eventEnd.value = calendarEvent.endsAtUtc
      ? (calendarEvent.isAllDay ? localDateKey(calendarEvent.endsAtUtc) : localDateTimeInput(calendarEvent.endsAtUtc))
      : "";
    elements.eventLocation.value = calendarEvent.location ?? "";
    elements.eventDescription.value = calendarEvent.description ?? "";
    elements.eventStatus.value = calendarEvent.status;
  } else {
    const start = new Date(selectedCalendarDate.getFullYear(), selectedCalendarDate.getMonth(), selectedCalendarDate.getDate(), 9);
    elements.eventStart.value = localDateTimeInput(start);
    elements.eventEnd.value = localDateTimeInput(new Date(start.getTime() + 3_600_000));
    elements.eventStatus.value = "active";
  }
  loadEventRecurrenceEditor(calendarEvent?.recurrenceRule ?? null);
  updateEventInviteDraftAvailability();
  elements.eventDialog.showModal();
  elements.eventTitle.focus();
}

function updateEventInviteDraftAvailability() {
  const saved = Boolean(elements.eventId.value);
  const emailReady = Boolean(lastHealth?.body?.integrations?.email?.ready);
  elements.eventInviteDraft.hidden = !saved;
  elements.eventInviteDraft.disabled = !emailReady;
  elements.eventInviteDraft.title = emailReady
    ? "Create an email draft from the currently saved event details."
    : "Connect Fastmail email before creating an invitation draft.";
}

function preferredInviteEmail(contact) {
  return contact.methods
    .filter((method) => method.kind === "email" && method.canReceive && /^[^\s@]+@[^\s@]+$/.test(method.value.trim()))
    .toSorted((left, right) => Number(right.isPrimary) - Number(left.isPrimary))[0]?.value.trim() || null;
}

function updateEventInviteSelection() {
  const count = eventInviteSelectedContactIds.size;
  elements.eventInviteCount.textContent = `${count} selected`;
  elements.eventInviteSubmit.disabled = eventInviteCreated || count === 0;
}

function renderEventInviteContacts() {
  const query = elements.eventInviteSearch.value.trim().toLocaleLowerCase();
  const visible = eventInviteContacts.filter(({ contact, email }) => (
    !query || contact.displayName.toLocaleLowerCase().includes(query) || email.toLocaleLowerCase().includes(query)
  ));
  elements.eventInviteContactList.replaceChildren();
  if (visible.length === 0) {
    elements.eventInviteContactList.append(node(
      "p", "empty",
      query ? "No invitation contacts match that search." : "No active contacts have a receivable email address.",
    ));
    updateEventInviteSelection();
    return;
  }
  for (const { contact, email } of visible) {
    const choice = node("label", "event-invite-choice");
    const checkbox = node("input");
    checkbox.type = "checkbox";
    checkbox.value = String(contact.id);
    checkbox.checked = eventInviteSelectedContactIds.has(contact.id);
    checkbox.disabled = eventInviteCreated;
    const identity = node("span");
    identity.append(node("strong", "", contact.displayName), node("small", "", email));
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) eventInviteSelectedContactIds.add(contact.id);
      else eventInviteSelectedContactIds.delete(contact.id);
      updateEventInviteSelection();
    });
    choice.append(checkbox, identity);
    elements.eventInviteContactList.append(choice);
  }
  updateEventInviteSelection();
}

async function openEventInviteDraft() {
  const eventId = Number(elements.eventId.value);
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return;
  if (!lastHealth?.body?.integrations?.email?.ready) {
    elements.eventFormError.textContent = "Connect Fastmail email before creating an invitation draft.";
    return;
  }
  eventInviteEventId = eventId;
  eventInviteContacts = [];
  eventInviteSelectedContactIds = new Set();
  eventInviteCreated = false;
  elements.eventInviteFormError.textContent = "";
  elements.eventInviteResult.textContent = "";
  elements.eventInviteSearch.value = "";
  elements.eventInviteTitle.textContent = `Invite contacts to ${elements.eventTitle.value}`;
  elements.eventInviteContactList.replaceChildren(node("p", "empty", "Loading contacts…"));
  elements.eventInviteSubmit.textContent = "Create Fastmail draft";
  updateEventInviteSelection();
  elements.eventInviteDialog.showModal();
  try {
    const body = await api("/api/contacts?scope=active&limit=1000");
    eventInviteContacts = body.contacts.flatMap((contact) => {
      const email = preferredInviteEmail(contact);
      return email && !contact.isSelf ? [{ contact, email }] : [];
    });
    renderEventInviteContacts();
    elements.eventInviteSearch.focus();
  } catch (error) {
    elements.eventInviteContactList.replaceChildren();
    elements.eventInviteFormError.textContent = error.message || "Could not load invitation contacts.";
  }
}

async function createEventInviteDraft(event) {
  event.preventDefault();
  if (!eventInviteEventId || eventInviteSelectedContactIds.size === 0 || eventInviteCreated) return;
  elements.eventInviteFormError.textContent = "";
  elements.eventInviteResult.textContent = "";
  elements.eventInviteSubmit.disabled = true;
  try {
    const body = await api(`/api/calendar-events/${eventInviteEventId}/invite-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: [...eventInviteSelectedContactIds] }),
    });
    eventInviteCreated = true;
    elements.eventInviteResult.textContent = `Draft created in Fastmail for ${body.draft.recipientCount} ${body.draft.recipientCount === 1 ? "recipient" : "recipients"}.`;
    elements.eventInviteSubmit.textContent = "Draft created";
    for (const checkbox of elements.eventInviteContactList.querySelectorAll('input[type="checkbox"]')) checkbox.disabled = true;
  } catch (error) {
    elements.eventInviteFormError.textContent = error.message || "Could not create the Fastmail draft.";
  } finally {
    updateEventInviteSelection();
  }
}

async function saveEvent(event) {
  event.preventDefault();
  elements.eventFormError.textContent = "";
  const submit = elements.eventForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const allDay = elements.eventAllDay.checked;
    const payload = {
      title: elements.eventTitle.value,
      description: elements.eventDescription.value,
      location: elements.eventLocation.value,
      startsAtUtc: inputToIso(elements.eventStart.value, allDay),
      endsAtUtc: inputToIso(elements.eventEnd.value, allDay),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      isAllDay: allDay,
      status: elements.eventStatus.value,
      recurrenceRule: buildEventRecurrenceRule(),
    };
    const id = elements.eventId.value;
    if (id) payload.version = elements.eventVersion.value;
    await api(id ? `/api/calendar-events/${id}` : "/api/calendar-events", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    elements.eventDialog.close();
    await refreshCalendar();
  } catch (error) {
    elements.eventFormError.textContent = error.message || "Could not save the event.";
  } finally {
    submit.disabled = false;
  }
}

async function refreshTodos() {
  try {
    const [body, groupBody, contactBody] = await Promise.all([
      api(`/api/todos?scope=${encodeURIComponent(elements.todoScope.value)}&limit=1000`),
      api("/api/todo-groups"),
      api("/api/contacts?scope=all&limit=10000"),
    ]);
    displayedTodos = body.todos;
    todoGroups = groupBody.groups;
    todoContacts = contactBody.contacts;
    const selectedGroup = elements.todoGroupFilter.value;
    elements.todoGroupFilter.replaceChildren(node("option", "", "All groups"));
    elements.todoGroupFilter.firstElementChild.value = "";
    for (const group of todoGroups) {
      const option = node("option", "", group.name);
      option.value = String(group.id);
      elements.todoGroupFilter.append(option);
    }
    elements.todoGroupFilter.value = todoGroups.some(({ id }) => String(id) === selectedGroup) ? selectedGroup : "";
    const selectedContact = elements.todoContactFilter.value;
    elements.todoContactFilter.replaceChildren(
      node("option", "", "All contacts"),
      node("option", "", "No contact"),
    );
    elements.todoContactFilter.children[0].value = "";
    elements.todoContactFilter.children[1].value = "none";
    for (const contact of todoContacts) {
      const label = `${contact.displayName}${contact.status === "active" ? "" : ` (${contact.status})`}`;
      const option = node("option", "", label);
      option.value = String(contact.id);
      elements.todoContactFilter.append(option);
    }
    elements.todoContactFilter.value = selectedContact === "none"
      || todoContacts.some(({ id }) => String(id) === selectedContact)
      ? selectedContact
      : "";
    renderTodos();
  } catch (error) {
    elements.todoList.replaceChildren(node("p", "empty", error.message || "To-Do List unavailable."));
  }
}

function formatTodoDateTime(value) {
  return formatDisplayDate(value);
}

function renderTodos() {
  elements.todoList.replaceChildren();
  const visibleTodos = displayedTodos.filter((todo) => {
    const matchesGroup = !elements.todoGroupFilter.value
      || String(todo.groupId) === elements.todoGroupFilter.value;
    const matchesContact = !elements.todoContactFilter.value
      || (elements.todoContactFilter.value === "none"
        ? todo.relatedContactId == null
        : String(todo.relatedContactId) === elements.todoContactFilter.value);
    return matchesGroup && matchesContact;
  });
  elements.todoCount.textContent = `${visibleTodos.length} ${visibleTodos.length === 1 ? "task" : "tasks"}`;
  const overdueCount = displayedTodos.filter((todo) => (
    ["todo", "ai_suggested"].includes(todo.status)
      && todo.scheduledAtUtc
      && new Date(todo.scheduledAtUtc) < startOfDay(new Date())
  )).length;
  elements.moveOverdueTodos.disabled = movingOverdueTodos;
  elements.moveOverdueTodos.title = overdueCount === 0
    ? "Move every active task scheduled before today onto today"
    : `Move ${overdueCount} overdue scheduled ${overdueCount === 1 ? "task" : "tasks"} onto today`;
  const groupedTodos = new Map();
  const visibleGroups = elements.todoGroupFilter.value
    ? todoGroups.filter(({ id }) => String(id) === elements.todoGroupFilter.value)
    : todoGroups;
  for (const group of visibleGroups) {
    groupedTodos.set(group.id, { name: group.name, archivedAtUtc: group.archivedAtUtc, todos: [] });
  }
  for (const todo of visibleTodos) {
    const group = groupedTodos.get(todo.groupId) ?? {
      name: todo.groupName, archivedAtUtc: todo.groupArchivedAtUtc, todos: [],
    };
    group.todos.push(todo);
    groupedTodos.set(todo.groupId, group);
  }
  if (groupedTodos.size === 0) {
    elements.todoList.append(node("p", "empty", "No to-do groups in this view."));
    return;
  }
  for (const [groupId, group] of groupedTodos) {
    const section = node("section", "todo-group-section");
    section.dataset.groupId = String(groupId);
    const heading = node("header", "todo-group-heading");
    const headingTitle = node("div", "todo-group-heading-title");
    headingTitle.append(node("h3", "", group.name));
    const headingActions = node("div", "todo-group-heading-actions");
    const top = node("button", "secondary compact", "⇈");
    const up = node("button", "secondary compact", "↑");
    const down = node("button", "secondary compact", "↓");
    const bottom = node("button", "secondary compact", "⇊");
    top.type = up.type = down.type = bottom.type = "button";
    top.title = "Move group to top";
    up.title = "Move group up";
    down.title = "Move group down";
    bottom.title = "Move group to bottom";
    top.setAttribute("aria-label", `Move ${group.name} group to top`);
    up.setAttribute("aria-label", `Move ${group.name} group up`);
    down.setAttribute("aria-label", `Move ${group.name} group down`);
    bottom.setAttribute("aria-label", `Move ${group.name} group to bottom`);
    top.addEventListener("click", () => void moveTodoGroup(groupId, "top"));
    up.addEventListener("click", () => void moveTodoGroup(groupId, "up"));
    down.addEventListener("click", () => void moveTodoGroup(groupId, "down"));
    bottom.addEventListener("click", () => void moveTodoGroup(groupId, "bottom"));
    if (!group.archivedAtUtc && group.name.toLowerCase() !== "inbox") {
      const rename = node("button", "secondary compact", "Rename");
      const archive = node("button", "secondary compact", "Archive group");
      rename.type = "button";
      archive.type = "button";
      rename.addEventListener("click", () => void renameTodoGroup(groupId, group.name));
      archive.addEventListener("click", () => void archiveTodoGroup(groupId, group.name));
      headingTitle.append(rename, archive);
    }
    headingTitle.append(top, up, down, bottom);
    headingActions.append(node("span", "", `${group.todos.length} ${group.todos.length === 1 ? "task" : "tasks"}`));
    if (group.archivedAtUtc) {
      headingActions.append(node("span", "todo-group-archived", "Archived group"));
    } else {
      const addTask = node("button", "secondary compact", "Add task");
      addTask.type = "button";
      addTask.setAttribute("aria-label", `Add task to ${group.name}`);
      addTask.addEventListener("click", () => openTodoEditor(null, groupId));
      headingActions.append(addTask);
    }
    heading.append(headingTitle, headingActions);
    const cards = node("div", "todo-group-cards");
    for (const todo of group.todos) {
      const card = node("article", `todo-card ${todo.status === "complete" ? "completed" : ""}`);
      const check = node("button", "todo-check", todo.status === "complete" ? "✓" : "");
      check.type = "button";
      check.setAttribute("aria-label", todo.status === "complete" ? `Reopen ${todo.text}` : `Complete ${todo.text}`);
      check.addEventListener("click", async () => {
        check.disabled = true;
        try {
          await api(`/api/todos/${todo.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version: todo.version, status: todo.status === "complete" ? "todo" : "complete" }),
          });
          await refreshTodos();
          if (activeView === "calendar") await refreshCalendar();
        } catch (error) {
          window.alert(error.message || "Could not update the todo.");
          check.disabled = false;
        }
      });
      const body = node("div", "todo-body");
      const title = node("h3");
      const text = node("button", "todo-text", todo.text);
      text.type = "button";
      text.title = "Copy task text";
      text.setAttribute("aria-label", `Copy task text: ${todo.text}`);
      text.addEventListener("click", (event) => void copyText(todo.text, event.currentTarget));
      title.append(text);
      body.append(title);
      const metadata = node("div", "todo-meta");
      if (todo.sequence != null) metadata.append(node("span", "todo-pill", `#${todo.sequence}`));
      metadata.append(node("span", "todo-pill", todo.status.replaceAll("_", " ")));
      if (todo.relatedContactId != null) {
        const relatedContact = todoContacts.find(({ id }) => id === todo.relatedContactId);
        const contactName = todo.relatedContactName
          ?? relatedContact?.displayName
          ?? `Contact #${todo.relatedContactId}`;
        const contactStatus = todo.relatedContactStatus && todo.relatedContactStatus !== "active"
          ? ` (${todo.relatedContactStatus})`
          : "";
        if (relatedContact) {
          const contactLink = node("button", "todo-pill todo-contact-pill", `${contactName}${contactStatus}`);
          contactLink.type = "button";
          contactLink.title = `Open ${contactName}`;
          contactLink.addEventListener("click", () => openContactEditor(relatedContact));
          metadata.append(contactLink);
        } else {
          metadata.append(node("span", "todo-pill todo-contact-pill", `${contactName}${contactStatus}`));
        }
      }
      if (todo.scheduledAtUtc) {
        metadata.append(node(
          "span",
          "todo-pill",
          `scheduled ${formatDisplayDate(todo.scheduledAtUtc, { includeTime: !todo.isAllDay })}`,
        ));
      }
      if (todo.dueAtUtc) {
        const due = new Date(todo.dueAtUtc);
        metadata.append(node("span", `todo-pill ${todo.status !== "complete" && due < new Date() ? "overdue" : ""}`, `due ${formatTodoDateTime(due)}`));
      }
      if (todo.recurrenceRule) metadata.append(node("span", "todo-pill", describeTodoRecurrence(todo.recurrenceRule)));
      body.append(metadata);
      const actions = node("div", "todo-actions");
      const schedule = node("button", "secondary compact", todo.scheduledAtUtc ? "Reschedule" : "Schedule");
      const top = node("button", "secondary compact", "⇈");
      const up = node("button", "secondary compact", "↑");
      const down = node("button", "secondary compact", "↓");
      const bottom = node("button", "secondary compact", "⇊");
      const edit = node("button", "secondary compact", "Edit");
      schedule.type = top.type = up.type = down.type = bottom.type = edit.type = "button";
      schedule.title = todo.scheduledAtUtc ? "Choose a new day on the calendar" : "Choose a day on the calendar";
      top.title = "Move task to top of group";
      up.title = "Move task up";
      down.title = "Move task down";
      bottom.title = "Move task to bottom of group";
      top.setAttribute("aria-label", `Move ${todo.text} to top of group`);
      up.setAttribute("aria-label", `Move ${todo.text} up`);
      down.setAttribute("aria-label", `Move ${todo.text} down`);
      bottom.setAttribute("aria-label", `Move ${todo.text} to bottom of group`);
      schedule.addEventListener("click", () => beginCalendarScheduling(todo));
      top.addEventListener("click", () => void moveTodo(todo, "top", visibleTodos));
      up.addEventListener("click", () => void moveTodo(todo, "up", visibleTodos));
      down.addEventListener("click", () => void moveTodo(todo, "down", visibleTodos));
      bottom.addEventListener("click", () => void moveTodo(todo, "bottom", visibleTodos));
      edit.addEventListener("click", () => openTodoEditor(todo));
      if (["todo", "ai_suggested"].includes(todo.status)) actions.append(schedule);
      actions.append(top, up, down, bottom, edit);
      card.append(check, body, actions);
      cards.append(card);
    }
    section.append(heading, cards);
    elements.todoList.append(section);
  }
}

async function moveOverdueTodosToToday() {
  if (movingOverdueTodos) return;
  movingOverdueTodos = true;
  clearTimeout(moveOverdueFeedbackTimer);
  elements.moveOverdueTodos.textContent = "Moving…";
  renderTodos();
  try {
    const result = await api("/api/todos/move-overdue-to-today", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        localDate: localDateKey(new Date()),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    await refreshTodos();
    elements.moveOverdueTodos.textContent = result.movedCount === 0
      ? "Nothing overdue"
      : `Moved ${result.movedCount} to today`;
    moveOverdueFeedbackTimer = setTimeout(() => {
      elements.moveOverdueTodos.textContent = "Move overdue to today";
    }, 2500);
  } catch (error) {
    elements.moveOverdueTodos.textContent = "Move overdue to today";
    window.alert(error.message || "Could not move overdue tasks to today.");
  } finally {
    movingOverdueTodos = false;
    renderTodos();
  }
}

async function moveTodoGroup(groupId, movement) {
  const currentIndex = todoGroups.findIndex(({ id }) => id === groupId);
  const targetIndex = movement === "top"
    ? 0
    : movement === "bottom"
      ? todoGroups.length - 1
      : currentIndex + (movement === "up" ? -1 : 1);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= todoGroups.length || targetIndex === currentIndex) return;
  const orderedGroupIds = todoGroups.map(({ id }) => id);
  orderedGroupIds.splice(currentIndex, 1);
  orderedGroupIds.splice(targetIndex, 0, groupId);
  try {
    await api("/api/todo-groups/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedGroupIds }),
    });
    await refreshTodos();
  } catch (error) {
    window.alert(error.message || "Could not reorder the group.");
  }
}

async function moveTodo(todo, movement, visibleTodos) {
  const groupTodos = visibleTodos.filter(({ groupId }) => groupId === todo.groupId);
  const currentIndex = groupTodos.findIndex(({ id }) => id === todo.id);
  const targetIndex = movement === "top"
    ? 0
    : movement === "bottom"
      ? groupTodos.length - 1
      : currentIndex + (movement === "up" ? -1 : 1);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= groupTodos.length || targetIndex === currentIndex) return;
  const orderedTodoIds = groupTodos.map(({ id }) => id);
  orderedTodoIds.splice(currentIndex, 1);
  orderedTodoIds.splice(targetIndex, 0, todo.id);
  try {
    await api(`/api/todo-groups/${todo.groupId}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedTodoIds }),
    });
    await refreshTodos();
  } catch (error) {
    window.alert(error.message || "Could not reorder the task.");
  }
}

function openTodoEditor(todo = null, groupId = null) {
  elements.todoForm.reset();
  elements.todoFormError.textContent = "";
  elements.todoDialogTitle.textContent = todo ? "Edit todo" : "New todo";
  elements.todoId.value = todo?.id ?? "";
  elements.todoVersion.value = todo?.version ?? "";
  populateTodoGroupEditor(todo?.groupId ?? groupId ?? (elements.todoGroupFilter.value || todoGroups[0]?.id || ""));
  populateTodoContactEditor(todo);
  elements.todoText.value = todo?.text ?? "";
  elements.todoSequence.value = todo?.sequence ?? "";
  elements.todoAllDay.checked = Boolean(todo?.isAllDay);
  setTodoScheduledInputType(elements.todoAllDay.checked);
  elements.todoScheduled.value = todo?.scheduledAtUtc
    ? (todo.isAllDay ? localDateKey(todo.scheduledAtUtc) : localDateTimeInput(todo.scheduledAtUtc))
    : "";
  elements.todoDue.value = localDateTimeInput(todo?.dueAtUtc);
  elements.todoStatus.value = todo?.status ?? "todo";
  loadTodoRecurrenceEditor(todo?.recurrenceRule ?? null, todo?.recurrenceTimeZone ?? null);
  elements.todoDialog.showModal();
  elements.todoText.focus();
}

function populateTodoGroupEditor(selectedGroupId) {
  elements.todoGroup.replaceChildren();
  for (const group of todoGroups) {
    const option = node("option", "", group.name);
    option.value = String(group.id);
    elements.todoGroup.append(option);
  }
  elements.todoGroup.value = String(selectedGroupId ?? "");
}

function populateTodoContactEditor(todo = null) {
  elements.todoContact.replaceChildren(node("option", "", "No contact"));
  elements.todoContact.firstElementChild.value = "";
  for (const contact of todoContacts) {
    const label = `${contact.displayName}${contact.status === "active" ? "" : ` (${contact.status})`}`;
    const option = node("option", "", label);
    option.value = String(contact.id);
    elements.todoContact.append(option);
  }
  if (todo?.relatedContactId != null
      && !todoContacts.some(({ id }) => id === todo.relatedContactId)) {
    const option = node("option", "", todo.relatedContactName ?? `Contact #${todo.relatedContactId}`);
    option.value = String(todo.relatedContactId);
    elements.todoContact.append(option);
  }
  elements.todoContact.value = todo?.relatedContactId == null ? "" : String(todo.relatedContactId);
}

async function saveTodo(event) {
  event.preventDefault();
  elements.todoFormError.textContent = "";
  const submit = elements.todoForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const payload = {
      text: elements.todoText.value,
      groupId: Number(elements.todoGroup.value),
      sequence: elements.todoSequence.value ? Number(elements.todoSequence.value) : null,
      relatedContactId: elements.todoContact.value ? Number(elements.todoContact.value) : null,
      scheduledAtUtc: inputToIso(elements.todoScheduled.value, elements.todoAllDay.checked),
      isAllDay: elements.todoAllDay.checked && Boolean(elements.todoScheduled.value),
      dueAtUtc: inputToIso(elements.todoDue.value),
      status: elements.todoStatus.value,
    };
    if (todoRecurrenceDirty) {
      payload.recurrenceRule = buildTodoRecurrenceRule();
      payload.recurrenceTimeZone = payload.recurrenceRule
        ? (loadedTodoRecurrenceTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone)
        : null;
    }
    const id = elements.todoId.value;
    if (id) payload.version = elements.todoVersion.value;
    await api(id ? `/api/todos/${id}` : "/api/todos", {
      method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    elements.todoDialog.close();
    if (activeView === "calendar") await refreshCalendar();
    else await refreshTodos();
  } catch (error) {
    elements.todoFormError.textContent = error.message || "Could not save the todo.";
  } finally {
    submit.disabled = false;
  }
}

async function createTodoGroup({ selectFilter = true } = {}) {
  const name = window.prompt("Name the new to-do group:")?.trim();
  if (!name) return null;
  try {
    const body = await api("/api/todo-groups", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    await refreshTodos();
    if (selectFilter) {
      elements.todoGroupFilter.value = String(body.group.id);
      renderTodos();
    }
    return body.group;
  } catch (error) {
    window.alert(error.message || "Could not create the group.");
    return null;
  }
}

async function archiveTodoGroup(groupId, groupName) {
  const confirmed = window.confirm(
    `Archive the ${groupName} group? This fails if it has active tasks. Terminal tasks will retain this historical group.`,
  );
  if (!confirmed) return;
  try {
    const result = await api(`/api/todo-groups/${groupId}/archive`, { method: "POST" });
    const retained = result.retainedTerminalTaskCount
      ? ` ${result.retainedTerminalTaskCount} terminal ${result.retainedTerminalTaskCount === 1 ? "task retains" : "tasks retain"} this historical group.`
      : "";
    elements.status.textContent = `${groupName} was archived.${retained}`;
    await refreshTodos();
  } catch (error) {
    window.alert(error.message || "Could not archive the group.");
  }
}

async function renameTodoGroup(groupId, currentName) {
  const name = window.prompt("New name for this to-do group:", currentName)?.trim();
  if (!name || name === currentName) return;
  try {
    const result = await api(`/api/todo-groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    elements.status.textContent = `${result.group.previousName} was renamed to ${result.group.name}.`;
    await refreshTodos();
    if (activeView === "calendar") await refreshCalendar();
  } catch (error) {
    window.alert(error.message || "Could not rename the group.");
  }
}

function contentTypeLabel(value) {
  return {
    mobileUGC_tutorial: "Mobile UGC tutorial",
    mobileUGC_ad: "Mobile UGC ad",
    webUGC_tutorial: "Web UGC tutorial",
    webUGC_ad: "Web UGC ad",
    video_ad: "Video ad",
    podcast: "Podcast",
    image: "Image",
    unknown: "Unknown",
  }[value] || value;
}

function safeContentUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

async function refreshContent() {
  const parameters = new URLSearchParams({ limit: "5000" });
  if (elements.contentGroupFilter.value) parameters.set("groupId", elements.contentGroupFilter.value);
  if (elements.contentStatusFilter.value) parameters.set("status", elements.contentStatusFilter.value);
  if (elements.contentSearch.value.trim()) parameters.set("q", elements.contentSearch.value.trim());
  try {
    const [body, groupBody] = await Promise.all([
      api(`/api/content-items?${parameters}`),
      api("/api/content-groups"),
    ]);
    contentItems = body.content;
    contentGroups = groupBody.groups;
    const selectedGroup = elements.contentGroupFilter.value;
    elements.contentGroupFilter.replaceChildren(node("option", "", "All groups"));
    elements.contentGroupFilter.firstElementChild.value = "";
    for (const group of contentGroups) {
      const option = node("option", "", group.name);
      option.value = String(group.id);
      elements.contentGroupFilter.append(option);
    }
    elements.contentGroupFilter.value = contentGroups.some(({ id }) => String(id) === selectedGroup)
      ? selectedGroup
      : "";
    renderContent();
  } catch (error) {
    elements.contentList.replaceChildren(node("p", "empty", error.message || "Content unavailable."));
  }
}

function renderContent() {
  elements.contentList.replaceChildren();
  elements.contentCount.textContent = `${contentItems.length} ${contentItems.length === 1 ? "item" : "items"}`;
  const visibleGroups = elements.contentGroupFilter.value
    ? contentGroups.filter(({ id }) => String(id) === elements.contentGroupFilter.value)
    : contentGroups;
  if (visibleGroups.length === 0) {
    elements.contentList.append(node("p", "empty", "No content groups in this view."));
    return;
  }
  for (const [groupIndex, group] of visibleGroups.entries()) {
    const items = contentItems.filter(({ groupId }) => groupId === group.id);
    const section = node("section", "content-group-section");
    const heading = node("header", "content-group-heading");
    const title = node("div", "content-group-heading-title");
    title.append(node("h3", "", group.name));
    if (group.id !== 1) {
      const rename = node("button", "secondary compact", "Rename");
      const archive = node("button", "secondary compact", "Archive group");
      rename.type = archive.type = "button";
      rename.addEventListener("click", () => void renameContentGroup(group.id, group.name));
      archive.addEventListener("click", () => void archiveContentGroup(group.id, group.name));
      title.append(rename, archive);
    }
    const top = node("button", "secondary compact", "⇈");
    const up = node("button", "secondary compact", "↑");
    const down = node("button", "secondary compact", "↓");
    const bottom = node("button", "secondary compact", "⇊");
    top.type = up.type = down.type = bottom.type = "button";
    top.title = "Move group to top";
    up.title = "Move group up";
    down.title = "Move group down";
    bottom.title = "Move group to bottom";
    top.disabled = groupIndex === 0;
    up.disabled = groupIndex === 0;
    down.disabled = groupIndex === visibleGroups.length - 1;
    bottom.disabled = groupIndex === visibleGroups.length - 1;
    top.addEventListener("click", () => void moveContentGroup(group.id, "top"));
    up.addEventListener("click", () => void moveContentGroup(group.id, "up"));
    down.addEventListener("click", () => void moveContentGroup(group.id, "down"));
    bottom.addEventListener("click", () => void moveContentGroup(group.id, "bottom"));
    title.append(top, up, down, bottom);
    const actions = node("div", "content-group-heading-actions");
    actions.append(node("span", "", `${items.length} ${items.length === 1 ? "item" : "items"}`));
    const add = node("button", "secondary compact", "Add content");
    add.type = "button";
    add.addEventListener("click", () => openContentEditor(null, group.id));
    actions.append(add);
    heading.append(title, actions);
    const cards = node("div", "content-card-grid");
    for (const item of items) {
      const card = node("article", "content-card organizer-panel");
      const cardHeading = node("div", "content-card-heading");
      const identity = node("div", "content-card-identity");
      const contentUrl = safeContentUrl(item.contentUrl);
      if (contentUrl) {
        const link = node("a", "content-title-link", item.title);
        link.href = contentUrl;
        link.target = "_blank";
        link.rel = "noreferrer";
        identity.append(link);
      } else {
        identity.append(node("h4", "", item.title));
      }
      const metadata = node("div", "content-meta");
      if (item.sequence != null) metadata.append(node("span", "todo-pill", `#${item.sequence}`));
      metadata.append(
        node("span", "todo-pill", contentTypeLabel(item.contentType)),
        node("span", "todo-pill", item.contentStatus),
        node("span", "todo-pill", item.contentHost),
        node("span", "todo-pill", formatDisplayDate(item.publishedAtUtc)),
      );
      identity.append(metadata);
      const cardActions = node("div", "content-card-actions");
      const edit = node("button", "secondary compact", "Edit");
      const remove = node("button", "danger compact", "Delete");
      edit.type = remove.type = "button";
      edit.addEventListener("click", () => openContentEditor(item));
      remove.addEventListener("click", () => void deleteContent(item));
      cardActions.append(edit, remove);
      cardHeading.append(identity, cardActions);
      card.append(cardHeading);
      if (item.description) card.append(node("p", "content-description", item.description));
      if (item.transcript) {
        const details = node("details", "content-transcript");
        details.append(node("summary", "", "Transcript"), node("p", "", item.transcript));
        card.append(details);
      }
      cards.append(card);
    }
    if (items.length === 0) cards.append(node("p", "empty", "No content in this group for the current filters."));
    section.append(heading, cards);
    elements.contentList.append(section);
  }
}

async function moveContentGroup(groupId, movement) {
  const currentIndex = contentGroups.findIndex(({ id }) => id === groupId);
  const targetIndex = movement === "top"
    ? 0
    : movement === "bottom"
      ? contentGroups.length - 1
      : currentIndex + (movement === "up" ? -1 : 1);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= contentGroups.length || targetIndex === currentIndex) return;
  const orderedGroupIds = contentGroups.map(({ id }) => id);
  orderedGroupIds.splice(currentIndex, 1);
  orderedGroupIds.splice(targetIndex, 0, groupId);
  try {
    await api("/api/content-groups/reorder", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderedGroupIds }),
    });
    await refreshContent();
  } catch (error) {
    window.alert(error.message || "Could not reorder the content group.");
  }
}

function populateContentGroupEditor(selectedGroupId) {
  elements.contentGroup.replaceChildren();
  for (const group of contentGroups) {
    const option = node("option", "", group.name);
    option.value = String(group.id);
    elements.contentGroup.append(option);
  }
  elements.contentGroup.value = String(selectedGroupId ?? "");
}

function openContentEditor(item = null, groupId = null) {
  elements.contentForm.reset();
  elements.contentFormError.textContent = "";
  elements.contentDialogTitle.textContent = item ? "Edit content" : "New content";
  elements.contentId.value = item?.id ?? "";
  elements.contentVersion.value = item?.version ?? "";
  elements.contentTitle.value = item?.title ?? "";
  populateContentGroupEditor(
    item?.groupId ?? groupId ?? (elements.contentGroupFilter.value || contentGroups[0]?.id || ""),
  );
  elements.contentSequence.value = item?.sequence ?? "";
  elements.contentType.value = item?.contentType ?? "mobileUGC_tutorial";
  elements.contentStatus.value = item?.contentStatus ?? "active";
  elements.contentHost.value = item?.contentHost ?? "youtube";
  elements.contentPublished.value = localDateTimeInput(item?.publishedAtUtc ?? new Date().toISOString());
  elements.contentUrl.value = item?.contentUrl ?? "";
  elements.contentDescription.value = item?.description ?? "";
  elements.contentTranscript.value = item?.transcript ?? "";
  elements.contentDialog.showModal();
  elements.contentTitle.focus();
}

async function saveContent(event) {
  event.preventDefault();
  elements.contentFormError.textContent = "";
  const submit = elements.contentForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const payload = {
      groupId: Number(elements.contentGroup.value),
      sequence: elements.contentSequence.value ? Number(elements.contentSequence.value) : null,
      contentType: elements.contentType.value,
      title: elements.contentTitle.value,
      transcript: elements.contentTranscript.value || null,
      description: elements.contentDescription.value || null,
      publishedAtUtc: inputToIso(elements.contentPublished.value),
      contentHost: elements.contentHost.value,
      contentStatus: elements.contentStatus.value,
      contentUrl: elements.contentUrl.value || null,
    };
    const id = elements.contentId.value;
    if (id) payload.version = elements.contentVersion.value;
    await api(id ? `/api/content-items/${id}` : "/api/content-items", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    elements.contentDialog.close();
    await refreshContent();
  } catch (error) {
    elements.contentFormError.textContent = error.message || "Could not save the content.";
  } finally {
    submit.disabled = false;
  }
}

async function deleteContent(item) {
  if (!window.confirm(`Permanently delete “${item.title}”? This cannot be undone.`)) return;
  try {
    await api(`/api/content-items/${item.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: item.version }),
    });
    await refreshContent();
  } catch (error) {
    window.alert(error.message || "Could not delete the content.");
  }
}

async function createContentGroup({ selectFilter = true } = {}) {
  const name = window.prompt("Name the new content group:")?.trim();
  if (!name) return null;
  try {
    const body = await api("/api/content-groups", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    await refreshContent();
    if (selectFilter) {
      elements.contentGroupFilter.value = String(body.group.id);
      await refreshContent();
    }
    return body.group;
  } catch (error) {
    window.alert(error.message || "Could not create the content group.");
    return null;
  }
}

async function renameContentGroup(groupId, currentName) {
  const name = window.prompt("New name for this content group:", currentName)?.trim();
  if (!name || name === currentName) return;
  try {
    await api(`/api/content-groups/${groupId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    await refreshContent();
  } catch (error) {
    window.alert(error.message || "Could not rename the content group.");
  }
}

async function archiveContentGroup(groupId, groupName) {
  if (!window.confirm(`Archive the empty ${groupName} content group?`)) return;
  try {
    await api(`/api/content-groups/${groupId}/archive`, { method: "POST" });
    await refreshContent();
  } catch (error) {
    window.alert(error.message || "Could not archive the content group.");
  }
}

function queueContentSearch() {
  clearTimeout(contentSearchTimer);
  contentSearchTimer = setTimeout(() => void refreshContent(), 200);
}

function formatContactBirthday(value) {
  if (!value) return null;
  const partial = /^--(\d{2})-(\d{2})$/.exec(value);
  const date = new Date(`${partial ? `2000-${partial[1]}-${partial[2]}` : value}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", ...(partial ? {} : { year: "numeric" }),
  }).format(date);
}

function contactMethodName(kind) {
  return {
    email: "Email", phone: "Phone", postal_address: "Address",
    handle: "Handle", url: "URL", other: "Other",
  }[kind] || kind;
}

async function refreshContacts() {
  try {
    const [body, duplicateReview] = await Promise.all([
      api("/api/contacts?scope=all&limit=10000"),
      api("/api/contacts/duplicates?limit=200"),
    ]);
    contacts = body.contacts;
    const availableIds = new Set(contacts.map(({ id }) => id));
    for (const id of selectedContactIds) {
      if (!availableIds.has(id)) selectedContactIds.delete(id);
    }
    contactDuplicateReview = duplicateReview;
    populateContactTagFilter();
    renderContacts();
  } catch (error) {
    elements.contactList.replaceChildren(node("p", "empty", error.message || "Contacts unavailable."));
  }
}

function populateContactTagFilter() {
  const selected = elements.contactTagFilter.value;
  const tags = [...new Set(contacts.flatMap((contact) => contact.tags))]
    .sort((left, right) => left.localeCompare(right));
  elements.contactTagFilter.replaceChildren(node("option", "", "All tags"));
  elements.contactTagFilter.firstElementChild.value = "";
  for (const tag of tags) {
    const option = node("option", "", tag);
    option.value = tag;
    elements.contactTagFilter.append(option);
  }
  elements.contactTagFilter.value = tags.includes(selected) ? selected : "";
  elements.contactRenameTag.disabled = tags.length === 0;
}

function duplicateContactGroups() {
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  return (contactDuplicateReview.groups ?? []).map((group) => ({
    evidence: group.evidence,
    contacts: group.contactIds.map((id) => contactsById.get(id)).filter(Boolean),
  })).filter(({ contacts: candidates }) => candidates.length > 1);
}

function contactValueCell(contact, kinds, label) {
  const cell = node("div", "contact-cell contact-value-stack");
  cell.dataset.label = label;
  const methods = contact.methods.filter(({ kind }) => kinds.includes(kind));
  if (methods.length === 0) {
    cell.append(node("span", "contact-empty-value", "—"));
    return cell;
  }
  for (const method of methods) {
    const line = node("div", "contact-value-line");
    const value = node("button", "contact-method-value contact-method-copy", method.value);
    value.type = "button";
    value.title = `Copy ${contactMethodName(method.kind).toLowerCase()}`;
    value.setAttribute("aria-label", `Copy ${contactMethodName(method.kind)}: ${method.value}`);
    value.addEventListener("click", (event) => void copyText(method.value, event.currentTarget));
    line.append(value);
    if (method.label || method.isPrimary) {
      line.append(node(
        "small", "contact-value-label",
        [method.label, method.isPrimary ? "primary" : null].filter(Boolean).join(" · "),
      ));
    }
    cell.append(line);
  }
  return cell;
}

function selectedContactRecords() {
  return contacts.filter(({ id }) => selectedContactIds.has(id));
}

function updateContactBulkActions() {
  const count = selectedContactIds.size;
  elements.contactBulkActions.hidden = count === 0;
  elements.contactSelectedCount.textContent = `${count} selected`;
  elements.contactAddTag.disabled = count === 0;
  elements.contactDeleteSelected.disabled = count === 0;
}

function reviewedContactPayload() {
  return selectedContactRecords().map((contact) => ({
    id: contact.id,
    expectedVersion: contact.version,
  }));
}

async function addTagToSelectedContacts() {
  const tag = elements.contactBulkTag.value.trim();
  const reviewed = reviewedContactPayload();
  if (!tag || reviewed.length === 0) {
    if (!tag) elements.contactBulkTag.focus();
    return;
  }
  elements.contactAddTag.disabled = true;
  elements.contactDeleteSelected.disabled = true;
  try {
    const result = await api("/api/contacts/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add_tag", tag, contacts: reviewed }),
    });
    elements.contactBulkTag.value = "";
    elements.status.textContent = `Added ${result.tag} to ${result.affectedCount} ${result.affectedCount === 1 ? "contact" : "contacts"}.`;
    await refreshContacts();
  } catch (error) {
    window.alert(error.message || "Could not add the tag to the selected contacts.");
  } finally {
    updateContactBulkActions();
  }
}

async function deleteSelectedContacts() {
  const reviewed = reviewedContactPayload();
  if (reviewed.length === 0) return;
  const count = reviewed.length;
  if (!window.confirm(`Permanently delete ${count} selected ${count === 1 ? "contact" : "contacts"}? This cannot be undone.`)) return;
  elements.contactAddTag.disabled = true;
  elements.contactDeleteSelected.disabled = true;
  try {
    const result = await api("/api/contacts/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", contacts: reviewed }),
    });
    selectedContactIds.clear();
    elements.status.textContent = `Deleted ${result.affectedCount} ${result.affectedCount === 1 ? "contact" : "contacts"}.`;
    await refreshContacts();
  } catch (error) {
    window.alert(error.message || "Could not delete the selected contacts.");
  } finally {
    updateContactBulkActions();
  }
}

function contactTagKey(value) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

async function renameContactTag() {
  const tags = [...new Set(contacts.flatMap((contact) => contact.tags))]
    .sort((left, right) => left.localeCompare(right));
  if (tags.length === 0) return;
  const currentTag = window.prompt(
    "Tag to rename:",
    elements.contactTagFilter.value || tags[0],
  )?.trim();
  if (!currentTag) return;
  const newTag = window.prompt(`Rename ${currentTag} to:`, currentTag)?.trim();
  if (!newTag || newTag === currentTag) return;
  const existing = tags.find((tag) => (
    contactTagKey(tag) === contactTagKey(newTag)
    && contactTagKey(tag) !== contactTagKey(currentTag)
  ));
  if (existing && !window.confirm(`${existing} already exists. Combine ${currentTag} into it?`)) return;
  elements.contactRenameTag.disabled = true;
  try {
    const result = await api("/api/contacts/tags/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentTag, newTag }),
    });
    elements.status.textContent = `Renamed ${result.previousTag} to ${result.tag} on ${result.affectedContactCount} ${result.affectedContactCount === 1 ? "contact" : "contacts"}.`;
    await refreshContacts();
    if ([...elements.contactTagFilter.options].some(({ value }) => value === result.tag)) {
      elements.contactTagFilter.value = result.tag;
      renderContacts();
    }
  } catch (error) {
    window.alert(error.message || "Could not rename the contact tag.");
  } finally {
    elements.contactRenameTag.disabled = tags.length === 0;
  }
}

function renderContacts() {
  elements.contactList.replaceChildren();
  const query = elements.contactSearch.value.trim().toLocaleLowerCase();
  const selectedTag = elements.contactTagFilter.value;
  const visible = contacts.filter((contact) => {
    if (!elements.contactIncludeInactive.checked && contact.status !== "active") return false;
    if (selectedTag && !contact.tags.includes(selectedTag)) return false;
    if (!query) return true;
    return [
      contact.displayName, contact.givenName, contact.familyName,
      contact.organizationName, contact.notes, ...contact.tags,
      ...contact.methods.flatMap((method) => [method.label, method.value]),
    ].some((value) => value?.toLocaleLowerCase().includes(query));
  });
  elements.contactCount.textContent = `${visible.length} ${visible.length === 1 ? "contact" : "contacts"}`;
  const duplicateCount = duplicateContactGroups().length;
  elements.reviewContactDuplicates.textContent = duplicateCount
    ? `Review duplicates · ${duplicateCount}`
    : "No duplicates found";
  elements.reviewContactDuplicates.disabled = duplicateCount === 0;
  updateContactBulkActions();
  if (visible.length === 0) {
    elements.contactList.append(node(
      "p", "empty",
      query ? "No contacts match that search." : "No contacts in this view yet.",
    ));
    return;
  }
  const tableHeader = node("div", "contact-table-header");
  const selectAllLabel = node("label", "contact-select-all");
  const selectAll = node("input", "contact-select-checkbox");
  selectAll.type = "checkbox";
  selectAll.setAttribute("aria-label", "Select all visible contacts");
  const selectedVisibleCount = visible.filter(({ id }) => selectedContactIds.has(id)).length;
  selectAll.checked = selectedVisibleCount === visible.length;
  selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visible.length;
  selectAll.addEventListener("change", () => {
    for (const contact of visible) {
      if (selectAll.checked) selectedContactIds.add(contact.id);
      else selectedContactIds.delete(contact.id);
    }
    renderContacts();
  });
  selectAllLabel.append(selectAll, node("span", "", "Contact"));
  tableHeader.append(selectAllLabel);
  for (const label of ["Email", "Phone", "Birthday", "Tags", "Other", ""]) {
    tableHeader.append(node("span", "", label));
  }
  elements.contactList.append(tableHeader);
  for (const contact of visible) {
    const row = node("article", "contact-row");
    const identity = node("div", "contact-identity");
    identity.dataset.label = "Contact";
    const select = node("input", "contact-select-checkbox");
    select.type = "checkbox";
    select.checked = selectedContactIds.has(contact.id);
    select.setAttribute("aria-label", `Select ${contact.displayName}`);
    select.addEventListener("change", () => {
      if (select.checked) selectedContactIds.add(contact.id);
      else selectedContactIds.delete(contact.id);
      renderContacts();
    });
    const names = node("div");
    names.append(node("h3", "", contact.displayName));
    if (contact.organizationName && contact.organizationName !== contact.displayName) {
      names.append(node("span", "contact-organization", contact.organizationName));
    }
    const identityMeta = [contact.kind, contact.isSelf ? "you" : null, contact.status !== "active" ? contact.status : null]
      .filter(Boolean).join(" · ");
    names.append(node("span", "contact-identity-meta", identityMeta));
    if (contact.notes) {
      const notes = node("span", "contact-row-notes", contact.notes);
      notes.title = contact.notes;
      names.append(notes);
    }
    identity.append(select, names);
    const email = contactValueCell(contact, ["email"], "Email");
    const phone = contactValueCell(contact, ["phone"], "Phone");
    const birthday = node("div", "contact-cell contact-birthday-cell");
    birthday.dataset.label = "Birthday";
    birthday.append(node("span", contact.birthDate ? "" : "contact-empty-value", formatContactBirthday(contact.birthDate) || "—"));
    const tags = node("div", "contact-cell contact-tag-stack");
    tags.dataset.label = "Tags";
    if (contact.tags.length) {
      for (const tag of contact.tags) {
        const tagButton = node("button", "contact-tag", tag);
        tagButton.type = "button";
        tagButton.title = `Show contacts tagged ${tag}`;
        tagButton.addEventListener("click", () => {
          elements.contactTagFilter.value = tag;
          renderContacts();
        });
        tags.append(tagButton);
      }
    } else {
      tags.append(node("span", "contact-empty-value", "—"));
    }
    const other = contactValueCell(contact, ["postal_address", "handle", "url", "other"], "Other");
    const actions = node("div", "contact-row-actions");
    const edit = node("button", "secondary compact", "Edit");
    edit.type = "button";
    edit.setAttribute("aria-label", `Edit ${contact.displayName}`);
    edit.addEventListener("click", () => openContactEditor(contact));
    actions.append(edit);
    row.append(identity, email, phone, birthday, tags, other, actions);
    elements.contactList.append(row);
  }
}

function renderContactDuplicateReview() {
  elements.contactDuplicateList.replaceChildren();
  const groups = duplicateContactGroups();
  if (groups.length === 0) {
    elements.contactDuplicateList.append(node("p", "empty", "No possible duplicates remain."));
    return;
  }
  groups.forEach((group, groupIndex) => {
    const card = node("section", "duplicate-group");
    const heading = node("div", "duplicate-group-heading");
    heading.append(
      node("strong", "", `${group.contacts.length} possible matches`),
      node("span", "", group.evidence.join(" · ")),
    );
    card.append(heading);
    const choices = node("div", "duplicate-choices");
    const defaultContact = [...group.contacts].sort((left, right) => (
      right.methods.length + right.tags.length - left.methods.length - left.tags.length
    ))[0];
    for (const contact of group.contacts) {
      const choice = node("label", "duplicate-choice");
      const radio = node("input");
      radio.type = "radio";
      radio.name = `duplicate-group-${groupIndex}`;
      radio.value = String(contact.id);
      radio.checked = contact.id === defaultContact.id;
      const summary = node("span");
      summary.append(
        node("strong", "", contact.displayName),
        node("small", "", `${contact.methods.length} methods · ${contact.tags.length} tags${contact.birthDate ? " · birthday" : ""}`),
      );
      choice.append(radio, summary);
      choices.append(choice);
    }
    const merge = node("button", "compact", "Merge into selected contact");
    merge.type = "button";
    merge.addEventListener("click", async () => {
      const keepId = Number(choices.querySelector('input[type="radio"]:checked')?.value);
      const keep = group.contacts.find(({ id }) => id === keepId);
      const merged = group.contacts.filter(({ id }) => id !== keepId);
      if (!keep || merged.length === 0) return;
      if (!window.confirm(`Merge ${merged.map(({ displayName }) => displayName).join(", ")} into ${keep.displayName}? The source records will be retained as inactive history.`)) return;
      merge.disabled = true;
      try {
        await api("/api/contacts/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keepContactId: keep.id,
            mergeContactIds: merged.map(({ id }) => id),
            versions: Object.fromEntries(group.contacts.map((contact) => [contact.id, contact.version])),
          }),
        });
        elements.status.textContent = `Merged ${merged.length} ${merged.length === 1 ? "contact" : "contacts"} into ${keep.displayName}.`;
        await refreshContacts();
        renderContactDuplicateReview();
      } catch (error) {
        window.alert(error.message || "Could not merge these contacts.");
        merge.disabled = false;
      }
    });
    card.append(choices, merge);
    elements.contactDuplicateList.append(card);
  });
}

function updateContactMethodInput(row) {
  const kind = row.querySelector(".contact-method-kind").value;
  const value = row.querySelector(".contact-method-input");
  value.type = kind === "email" ? "email" : kind === "phone" ? "tel" : kind === "url" ? "url" : "text";
  value.autocomplete = kind === "email" ? "email" : kind === "phone" ? "tel" : kind === "postal_address" ? "street-address" : "off";
  value.placeholder = contactMethodName(kind);
}

function selectPrimaryContactMethod(row) {
  const primary = row.querySelector(".contact-method-primary");
  if (!primary.checked) return;
  const kind = row.querySelector(".contact-method-kind").value;
  for (const candidate of elements.contactMethodList.querySelectorAll(".contact-method-row")) {
    if (candidate === row || candidate.querySelector(".contact-method-kind").value !== kind) continue;
    candidate.querySelector(".contact-method-primary").checked = false;
  }
}

function addContactMethodRow(method = {}) {
  const row = node("div", "contact-method-row");
  if (method.id) row.dataset.methodId = String(method.id);
  const kind = node("select", "contact-method-kind");
  for (const [value, label] of [
    ["email", "Email"], ["phone", "Phone"], ["postal_address", "Address"],
    ["handle", "Handle"], ["url", "URL"], ["other", "Other"],
  ]) {
    const option = node("option", "", label);
    option.value = value;
    kind.append(option);
  }
  kind.value = method.kind || "email";
  kind.setAttribute("aria-label", "Method type");
  const label = node("input", "contact-method-label-input");
  label.value = method.label || "";
  label.placeholder = "Label";
  label.maxLength = 100;
  label.setAttribute("aria-label", "Method label");
  const value = node("input", "contact-method-input");
  value.value = method.value || "";
  value.required = true;
  value.maxLength = 2000;
  value.setAttribute("aria-label", "Contact method value");
  const primaryLabel = node("label", "contact-method-check");
  const primary = node("input", "contact-method-primary");
  primary.type = "checkbox";
  primary.checked = Boolean(method.isPrimary);
  primaryLabel.append(primary, node("span", "", "Primary"));
  const receiveLabel = node("label", "contact-method-check");
  const receive = node("input", "contact-method-receive");
  receive.type = "checkbox";
  receive.checked = method.canReceive !== false;
  receiveLabel.append(receive, node("span", "", "Can receive"));
  const remove = node("button", "secondary compact contact-method-remove", "Remove");
  remove.type = "button";
  remove.addEventListener("click", () => row.remove());
  primary.addEventListener("change", () => selectPrimaryContactMethod(row));
  kind.addEventListener("change", () => {
    updateContactMethodInput(row);
    selectPrimaryContactMethod(row);
  });
  row.append(kind, label, value, primaryLabel, receiveLabel, remove);
  elements.contactMethodList.append(row);
  updateContactMethodInput(row);
  selectPrimaryContactMethod(row);
  return row;
}

function openContactEditor(contact = null) {
  elements.contactForm.reset();
  elements.contactMethodList.replaceChildren();
  elements.contactFormError.textContent = "";
  elements.contactDialogTitle.textContent = contact ? "Edit contact" : "New contact";
  elements.contactId.value = contact?.id ?? "";
  elements.contactVersion.value = contact?.version ?? "";
  elements.contactDisplayName.value = contact?.displayName ?? "";
  elements.contactKind.value = contact?.kind ?? "person";
  elements.contactOrganizationName.value = contact?.organizationName ?? "";
  elements.contactBirthDate.value = contact?.birthDate ?? "";
  elements.contactTags.value = contact?.tags?.join(", ") ?? "";
  elements.contactStatus.value = contact?.status ?? "active";
  elements.contactNotes.value = contact?.notes ?? "";
  for (const method of contact?.methods ?? []) addContactMethodRow(method);
  elements.contactDialog.showModal();
  elements.contactDisplayName.focus();
}

async function saveContact(event) {
  event.preventDefault();
  elements.contactFormError.textContent = "";
  const submit = elements.contactForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const methods = [...elements.contactMethodList.querySelectorAll(".contact-method-row")].map((row) => ({
      id: row.dataset.methodId ? Number(row.dataset.methodId) : null,
      kind: row.querySelector(".contact-method-kind").value,
      label: row.querySelector(".contact-method-label-input").value,
      value: row.querySelector(".contact-method-input").value,
      isPrimary: row.querySelector(".contact-method-primary").checked,
      canReceive: row.querySelector(".contact-method-receive").checked,
    }));
    const payload = {
      kind: elements.contactKind.value,
      displayName: elements.contactDisplayName.value,
      organizationName: elements.contactOrganizationName.value,
      birthDate: elements.contactBirthDate.value,
      tags: elements.contactTags.value.split(",").map((tag) => tag.trim()).filter(Boolean),
      status: elements.contactStatus.value,
      notes: elements.contactNotes.value,
      methods,
    };
    const id = elements.contactId.value;
    if (id) payload.version = elements.contactVersion.value;
    await api(id ? `/api/contacts/${id}` : "/api/contacts", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    elements.contactDialog.close();
    await refreshContacts();
    if (activeView === "calendar") await refreshCalendar();
    if (activeView === "todos") await refreshTodos();
  } catch (error) {
    elements.contactFormError.textContent = error.message || "Could not save the contact.";
  } finally {
    submit.disabled = false;
  }
}

async function refreshLogs() {
  try {
    const [trackerBody, entryBody] = await Promise.all([
      api("/api/log-trackers?limit=500"),
      api("/api/log-entries?limit=500"),
    ]);
    logTrackers = trackerBody.trackers;
    logEntries = entryBody.entries;
    populateLogFilters();
    renderLogs();
  } catch (error) {
    elements.logList.replaceChildren(node("p", "empty", error.message || "Logs unavailable."));
  }
}

function logGroups() {
  const groups = new Map();
  for (const tracker of logTrackers) groups.set(tracker.groupId, tracker.groupName);
  return [...groups].sort((left, right) => left[1].localeCompare(right[1]));
}

function populateLogFilters() {
  const selectedGroup = elements.logGroupFilter.value;
  const selectedTracker = elements.logTrackerFilter.value;
  elements.logGroupFilter.replaceChildren(node("option", "", "All groups"));
  elements.logGroupFilter.firstElementChild.value = "";
  for (const [groupId, name] of logGroups()) {
    const option = node("option", "", name);
    option.value = String(groupId);
    elements.logGroupFilter.append(option);
  }
  elements.logGroupFilter.value = selectedGroup;
  if (!elements.logGroupFilter.value) elements.logGroupFilter.value = "";
  populateLogTrackerFilter(selectedTracker);
}

function populateLogTrackerFilter(selectedTracker = elements.logTrackerFilter.value) {
  const groupId = Number(elements.logGroupFilter.value) || null;
  const visibleTrackers = logTrackers.filter((tracker) => groupId === null || tracker.groupId === groupId);
  elements.logTrackerFilter.replaceChildren(node("option", "", "All trackers"));
  elements.logTrackerFilter.firstElementChild.value = "";
  for (const tracker of visibleTrackers) {
    const option = node("option", "", tracker.name);
    option.value = String(tracker.id);
    elements.logTrackerFilter.append(option);
  }
  elements.logTrackerFilter.value = selectedTracker;
  if (!elements.logTrackerFilter.value) elements.logTrackerFilter.value = "";
}

function renderLogs() {
  elements.logList.replaceChildren();
  const selectedGroupId = Number(elements.logGroupFilter.value) || null;
  const selectedTrackerId = Number(elements.logTrackerFilter.value) || null;
  const visibleTrackers = logTrackers.filter((tracker) => (
    (selectedGroupId === null || tracker.groupId === selectedGroupId)
    && (selectedTrackerId === null || tracker.id === selectedTrackerId)
  ));
  const visibleTrackerIds = new Set(visibleTrackers.map(({ id }) => id));
  const visibleEntries = logEntries.filter(({ trackerId }) => visibleTrackerIds.has(trackerId));
  const totalEntries = visibleTrackers.reduce((total, tracker) => total + tracker.entryCount, 0);
  elements.logCount.textContent = `${totalEntries} ${totalEntries === 1 ? "entry" : "entries"} · ${visibleTrackers.length} ${visibleTrackers.length === 1 ? "tracker" : "trackers"}`;
  if (visibleTrackers.length === 0) {
    elements.logList.append(node("p", "empty", "No trackers in this view. Add an entry to create one."));
    return;
  }

  const grouped = new Map();
  for (const tracker of visibleTrackers) {
    const group = grouped.get(tracker.groupId) ?? { name: tracker.groupName, trackers: [] };
    group.trackers.push(tracker);
    grouped.set(tracker.groupId, group);
  }
  for (const [, group] of grouped) {
    const section = node("section", "log-group-section");
    const heading = node("header", "log-group-heading");
    heading.append(
      node("h3", "", group.name),
      node("span", "", `${group.trackers.length} ${group.trackers.length === 1 ? "tracker" : "trackers"}`),
    );
    const cards = node("div", "log-tracker-grid");
    for (const tracker of group.trackers) {
      const card = node("article", "log-tracker-card");
      const cardHeading = node("header", "log-tracker-heading");
      const headingText = node("div");
      headingText.append(node("h4", "", tracker.name));
      const trackerMeta = node("p", "log-tracker-meta");
      trackerMeta.textContent = `${tracker.entryCount} ${tracker.entryCount === 1 ? "entry" : "entries"}`
        + (tracker.defaultUnit ? ` · default ${tracker.defaultUnit}` : "");
      headingText.append(trackerMeta);
      const add = node("button", "secondary compact", "Log entry");
      add.type = "button";
      add.addEventListener("click", () => openLogEditor(tracker.id));
      cardHeading.append(headingText, add);
      const entries = visibleEntries.filter(({ trackerId }) => trackerId === tracker.id);
      const entryList = node("div", "log-entry-list");
      if (entries.length === 0) {
        entryList.append(node("p", "empty", "No recent entries."));
      } else {
        for (const entry of entries) {
          const item = node("article", "log-entry");
          const metadata = node("div", "log-entry-meta");
          metadata.append(node("time", "", formatDisplayDate(entry.occurredAtUtc)));
          if (entry.numberValue !== null) {
            metadata.append(node("span", "log-value", `${entry.numberValue}${entry.unit ? ` ${entry.unit}` : ""}`));
          }
          item.append(metadata, node("p", "", entry.contentText));
          entryList.append(item);
        }
      }
      card.append(cardHeading, entryList);
      cards.append(card);
    }
    section.append(heading, cards);
    elements.logList.append(section);
  }
}

function populateLogTrackerEditor(selectedTrackerId = null) {
  elements.logTracker.replaceChildren();
  for (const [groupId, groupName] of logGroups()) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = groupName;
    for (const tracker of logTrackers.filter((item) => item.groupId === groupId)) {
      const option = node("option", "", tracker.name);
      option.value = String(tracker.id);
      optgroup.append(option);
    }
    elements.logTracker.append(optgroup);
  }
  const newOption = node("option", "", "Create a new tracker…");
  newOption.value = "new";
  elements.logTracker.append(newOption);
  elements.logTracker.value = selectedTrackerId == null ? "new" : String(selectedTrackerId);
  if (!elements.logTracker.value) elements.logTracker.value = "new";

  elements.logGroupOptions.replaceChildren();
  for (const [, name] of logGroups()) {
    const option = document.createElement("option");
    option.value = name;
    elements.logGroupOptions.append(option);
  }
  updateLogTrackerEditor();
}

function updateLogTrackerEditor() {
  const isNew = elements.logTracker.value === "new";
  elements.newLogTrackerFields.hidden = !isNew;
  elements.logTrackerName.required = isNew;
  elements.logGroupName.required = isNew;
  const tracker = logTrackers.find(({ id }) => id === Number(elements.logTracker.value));
  elements.logUnit.placeholder = tracker?.defaultUnit ? `Defaults to ${tracker.defaultUnit}` : "";
}

function openLogEditor(trackerId = null) {
  elements.logForm.reset();
  elements.logFormError.textContent = "";
  elements.logOccurred.value = localDateTimeInput(new Date());
  elements.logGroupName.value = "General";
  populateLogTrackerEditor(trackerId);
  elements.logDialog.showModal();
  (trackerId == null ? elements.logTrackerName : elements.logContent).focus();
}

async function saveLogEntry(event) {
  event.preventDefault();
  elements.logFormError.textContent = "";
  const submit = elements.logForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const creatingTracker = elements.logTracker.value === "new";
    const payload = {
      trackerId: creatingTracker ? null : Number(elements.logTracker.value),
      trackerName: creatingTracker ? elements.logTrackerName.value : null,
      groupName: creatingTracker ? elements.logGroupName.value : null,
      contentText: elements.logContent.value,
      numberValue: elements.logNumber.value === "" ? null : Number(elements.logNumber.value),
      unit: elements.logUnit.value || null,
      occurredAtUtc: inputToIso(elements.logOccurred.value),
    };
    await api("/api/log-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    elements.logDialog.close();
    await refreshLogs();
  } catch (error) {
    elements.logFormError.textContent = error.message || "Could not save the log entry.";
  } finally {
    submit.disabled = false;
  }
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = elements.text.value.trim();
  if (!text) return;
  elements.send.disabled = true;
  elements.status.textContent = "Submitting…";
  try {
    const file = elements.requestFile.files?.[0] ?? null;
    let primaryFileId = null;
    if (file) {
      elements.status.textContent = "Uploading attachment…";
      const lowerName = file.name.toLowerCase();
      const mimeType = file.type || (lowerName.endsWith(".csv")
        ? "text/csv"
        : (lowerName.endsWith(".vcf") ? "text/vcard" : "text/plain"));
      const uploaded = await api(`/api/request-files?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": mimeType },
        body: file,
      });
      primaryFileId = uploaded.fileId;
      elements.status.textContent = "Submitting request…";
    }
    await api("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, primaryFileId }),
    });
    elements.text.value = "";
    elements.requestFile.value = "";
    updateRequestFileSelection();
    elements.status.textContent = "Queued.";
    await loadRequests({ force: true });
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    elements.send.disabled = false;
  }
});

elements.text.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (!elements.send.disabled) elements.form.requestSubmit();
});
elements.requestFile.addEventListener("change", updateRequestFileSelection);
elements.removeRequestFile.addEventListener("click", () => {
  elements.requestFile.value = "";
  updateRequestFileSelection();
});

elements.record.addEventListener("click", async () => {
  if (recorder?.state === "recording") {
    clearInterval(recordingTimer);
    recorder.stop();
    elements.record.disabled = true;
    elements.record.classList.remove("recording");
    elements.record.setAttribute("aria-label", "Saving recording");
    elements.recordLabel.textContent = "Saving recording…";
    return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    recordingChunks = [];
    recorder = new MediaRecorder(recordingStream);
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size) recordingChunks.push(event.data); });
    recorder.addEventListener("stop", async () => {
      recordingStream?.getTracks().forEach((track) => track.stop());
      const blob = new Blob(recordingChunks, { type: recorder.mimeType || "audio/webm" });
      elements.status.textContent = "Uploading voice request…";
      try {
        await api("/api/voice", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
        elements.status.textContent = "Voice request queued.";
        await loadRequests({ force: true });
      } catch (error) {
        elements.status.textContent = error.message;
      } finally {
        recorder = null;
        recordingStream = null;
        recordingStartedAt = null;
        elements.record.disabled = false;
        elements.record.classList.remove("recording");
        elements.record.setAttribute("aria-label", "Start recording");
        elements.recordLabel.textContent = "Tap to record";
        elements.recordTimer.textContent = "00:00";
      }
    });
    recorder.start(1000);
    recordingStartedAt = Date.now();
    elements.record.classList.add("recording");
    elements.record.setAttribute("aria-label", "Stop and queue recording");
    elements.recordLabel.textContent = "Tap to queue";
    elements.recordTimer.textContent = "00:00";
    recordingTimer = setInterval(() => {
      elements.recordTimer.textContent = formatClock(Date.now() - recordingStartedAt);
    }, 250);
    elements.status.textContent = "Recording…";
  } catch (error) {
    recordingStream?.getTracks().forEach((track) => track.stop());
    recordingStream = null;
    recorder = null;
    elements.record.classList.remove("recording");
    elements.recordLabel.textContent = "Tap to record";
    elements.recordTimer.textContent = "00:00";
    elements.status.textContent = error.message;
  }
});

elements.refresh.addEventListener("click", () => loadRequests({ force: true }).catch((error) => { elements.status.textContent = error.message; }));
elements.newConversation.addEventListener("click", async () => {
  if (!window.confirm("Start a new conversation? Slayer will stop carrying the current conversation context into the next request.")) return;
  elements.newConversation.disabled = true;
  try {
    await api("/api/conversation/reset", { method: "POST" });
    elements.status.textContent = "New conversation ready.";
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    elements.newConversation.disabled = false;
  }
});
elements.integrationsButton.addEventListener("click", () => elements.integrationsDialog.showModal());
elements.integrationList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-name]");
  if (!button || !elements.integrationList.contains(button)) return;
  const name = button.dataset.name;
  button.disabled = true;
  try {
    if (button.classList.contains("disconnect-integration")) {
      if (!window.confirm(`Disconnect ${name}? Agent Slayer will delete its local OAuth credentials and remove the provider's tools.`)) return;
      await api(`/api/integrations/${encodeURIComponent(name)}/oauth/disconnect`, { method: "POST" });
      elements.status.textContent = `${name} disconnected locally.`;
      await loadHealth();
    } else {
      elements.status.textContent = `Starting ${name} authorization…`;
      const result = await api(`/api/integrations/${encodeURIComponent(name)}/oauth/start`, { method: "POST" });
      window.location.assign(result.authorizationUrl);
    }
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
elements.runtime.addEventListener("click", (event) => copyText(JSON.stringify(lastHealth, null, 2), event.currentTarget));
elements.usage.addEventListener("click", (event) => copyText(JSON.stringify(lastHealth?.body?.model?.usage ?? null, null, 2), event.currentTarget));
elements.closeTrace.addEventListener("click", () => { elements.tracePanel.hidden = true; });
elements.copyTrace.addEventListener("click", (event) => copyText(JSON.stringify(activeTrace, null, 2), event.currentTarget));
elements.tokenForm.addEventListener("submit", () => {
  accessToken = elements.token.value.trim();
  localStorage.setItem("agent-slayer-token", accessToken);
  setTimeout(() => Promise.allSettled([loadHealth(), loadRequests({ force: true })]), 0);
});
elements.agentViewButton.addEventListener("click", () => switchView("agent"));
elements.viewSelector.addEventListener("change", () => {
  if (elements.viewSelector.value) switchView(elements.viewSelector.value);
});
elements.previousMonth.addEventListener("click", () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
  selectedCalendarDate = new Date(calendarCursor);
  void refreshCalendar();
});
elements.nextMonth.addEventListener("click", () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
  selectedCalendarDate = new Date(calendarCursor);
  void refreshCalendar();
});
elements.today.addEventListener("click", () => {
  selectedCalendarDate = new Date();
  calendarCursor = new Date(selectedCalendarDate.getFullYear(), selectedCalendarDate.getMonth(), 1);
  void refreshCalendar();
});
elements.cancelCalendarSchedule.addEventListener("click", () => cancelCalendarScheduling());
elements.newEvent.addEventListener("click", () => openEventEditor());
elements.calendarSearch.addEventListener("input", queueCalendarSearch);
elements.calendarSearchIncludeArchived.addEventListener("change", () => {
  if (elements.calendarSearch.value.trim()) void searchCalendarEvents();
});
elements.eventAllDay.addEventListener("change", () => {
  setEventInputTypes(elements.eventAllDay.checked);
  updateEventRecurrenceEditor();
});
elements.eventForm.addEventListener("submit", saveEvent);
elements.eventInviteDraft.addEventListener("click", () => void openEventInviteDraft());
elements.eventInviteSearch.addEventListener("input", renderEventInviteContacts);
elements.eventInviteForm.addEventListener("submit", createEventInviteDraft);
for (const control of [
  elements.eventRepeatEnabled, elements.eventRepeatInterval, elements.eventRepeatFrequency,
  elements.eventRepeatEnd, elements.eventRepeatCount, elements.eventRepeatUntil,
  ...elements.eventRepeatWeekdays.querySelectorAll('input[type="checkbox"]'),
]) {
  control.addEventListener("change", updateEventRecurrenceEditor);
  if (control.matches('input[type="number"]')) control.addEventListener("input", updateEventRecurrenceEditor);
}
elements.eventStart.addEventListener("change", updateEventRecurrenceEditor);
elements.newTodo.addEventListener("click", async () => {
  if (todoGroups.length === 0) await refreshTodos();
  openTodoEditor();
});
elements.newTodoGroup.addEventListener("click", () => void createTodoGroup());
elements.todoNewGroup.addEventListener("click", async () => {
  const group = await createTodoGroup({ selectFilter: false });
  if (group) populateTodoGroupEditor(group.id);
});
elements.todoScope.addEventListener("change", () => void refreshTodos());
elements.todoGroupFilter.addEventListener("change", renderTodos);
elements.todoContactFilter.addEventListener("change", renderTodos);
elements.moveOverdueTodos.addEventListener("click", () => void moveOverdueTodosToToday());
elements.todoForm.addEventListener("submit", saveTodo);
elements.todoAllDay.addEventListener("change", () => {
  setTodoScheduledInputType(elements.todoAllDay.checked);
  updateTodoRecurrenceEditor();
});
for (const control of [
  elements.todoRepeatEnabled, elements.todoRepeatInterval, elements.todoRepeatFrequency,
  elements.todoRepeatEnd, elements.todoRepeatCount, elements.todoRepeatUntil,
  ...elements.todoRepeatWeekdays.querySelectorAll('input[type="checkbox"]'),
]) {
  const recurrenceChanged = () => {
    todoRecurrenceDirty = true;
    updateTodoRecurrenceEditor();
  };
  control.addEventListener("change", recurrenceChanged);
  if (control.matches('input[type="number"]')) control.addEventListener("input", recurrenceChanged);
}
elements.todoScheduled.addEventListener("change", updateTodoRecurrenceEditor);
elements.newContent.addEventListener("click", async () => {
  if (contentGroups.length === 0) await refreshContent();
  openContentEditor();
});
elements.newContentGroup.addEventListener("click", () => void createContentGroup());
elements.contentNewGroup.addEventListener("click", async () => {
  const group = await createContentGroup({ selectFilter: false });
  if (group) populateContentGroupEditor(group.id);
});
elements.contentSearch.addEventListener("input", queueContentSearch);
elements.contentStatusFilter.addEventListener("change", () => void refreshContent());
elements.contentGroupFilter.addEventListener("change", () => void refreshContent());
elements.contentForm.addEventListener("submit", saveContent);
elements.newContact.addEventListener("click", () => openContactEditor());
elements.contactSearch.addEventListener("input", renderContacts);
elements.contactTagFilter.addEventListener("change", renderContacts);
elements.contactRenameTag.addEventListener("click", () => void renameContactTag());
elements.contactIncludeInactive.addEventListener("change", renderContacts);
elements.contactAddTag.addEventListener("click", () => void addTagToSelectedContacts());
elements.contactBulkTag.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void addTagToSelectedContacts();
  }
});
elements.contactDeleteSelected.addEventListener("click", () => void deleteSelectedContacts());
elements.contactClearSelection.addEventListener("click", () => {
  selectedContactIds.clear();
  renderContacts();
});
elements.reviewContactDuplicates.addEventListener("click", () => {
  renderContactDuplicateReview();
  elements.contactDuplicatesDialog.showModal();
});
elements.addContactMethod.addEventListener("click", () => {
  addContactMethodRow().querySelector(".contact-method-input").focus();
});
elements.contactForm.addEventListener("submit", saveContact);
elements.newLogEntry.addEventListener("click", () => openLogEditor());
elements.logGroupFilter.addEventListener("change", () => {
  populateLogTrackerFilter("");
  renderLogs();
});
elements.logTrackerFilter.addEventListener("change", renderLogs);
elements.logTracker.addEventListener("change", updateLogTrackerEditor);
elements.logForm.addEventListener("submit", saveLogEntry);
for (const button of document.querySelectorAll(".dialog-close")) {
  button.addEventListener("click", () => button.closest("dialog")?.close());
}

if (!accessToken) elements.tokenDialog.showModal();
if (new URLSearchParams(window.location.search).get("oauth") === "connected") {
  elements.status.textContent = "MCP OAuth connected.";
  history.replaceState(null, "", window.location.pathname);
}
loadHealth().catch(() => {});
loadRequests({ force: true }).catch(() => {});
switchView("agent");
setInterval(() => loadHealth().catch(() => {}), 5000);
setInterval(() => loadRequests().catch(() => {}), 1500);
setInterval(updateProgressClocks, 250);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});
