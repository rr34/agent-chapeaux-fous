const elements = {
  form: document.querySelector("#request-form"),
  text: document.querySelector("#request-text"),
  send: document.querySelector("#send"),
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
  navButtons: [...document.querySelectorAll(".nav-button")],
  agentView: document.querySelector("#agent-view"),
  calendarView: document.querySelector("#calendar-view"),
  todosView: document.querySelector("#todos-view"),
  calendarMonthLabel: document.querySelector("#calendar-month-label"),
  calendarTimeZone: document.querySelector("#calendar-time-zone"),
  calendarGrid: document.querySelector("#calendar-grid"),
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
  eventFormError: document.querySelector("#event-form-error"),
  todoScope: document.querySelector("#todo-scope"),
  todoGroupFilter: document.querySelector("#todo-group-filter"),
  todoCount: document.querySelector("#todo-count"),
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
  todoSequence: document.querySelector("#todo-sequence"),
  todoScheduled: document.querySelector("#todo-scheduled"),
  todoDue: document.querySelector("#todo-due"),
  todoStatus: document.querySelector("#todo-status"),
  todoRecurrenceRule: document.querySelector("#todo-recurrence-rule"),
  todoFormError: document.querySelector("#todo-form-error"),
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
let activeTodos = [];
let displayedTodos = [];
let todoGroups = [];
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

function formatTime(milliseconds) {
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(milliseconds));
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
    node.querySelector(".copy-response").addEventListener("click", (event) => {
      copyText(node.querySelector(".agent-response p").textContent, event.currentTarget);
    });
    node.querySelector(".show-trace").addEventListener("click", () => showTrace(request.requestId));
    requestNodes.set(request.requestId, node);
  }
  node.dataset.status = request.status;
  node.querySelector(".request-number").textContent = `Request ${request.requestId.slice(0, 8)}`;
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
  const gridStart = addDays(first, -first.getDay());
  const gridEnd = addDays(last, 7 - last.getDay());
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
  if (calendarEvent.isAllDay) return "All day";
  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hour12: false, hourCycle: "h23",
  });
  const start = formatter.format(new Date(calendarEvent.startsAtUtc));
  return calendarEvent.endsAtUtc
    ? `${start}–${formatter.format(new Date(calendarEvent.endsAtUtc))}`
    : start;
}

function switchView(view) {
  activeView = view;
  elements.agentView.hidden = view !== "agent";
  elements.calendarView.hidden = view !== "calendar";
  elements.todosView.hidden = view !== "todos";
  for (const button of elements.navButtons) button.classList.toggle("active", button.dataset.view === view);
  if (view === "calendar") void refreshCalendar();
  if (view === "todos") void refreshTodos();
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
    renderCalendar();
  } catch (error) {
    elements.calendarGrid.replaceChildren(node("p", "empty", error.message || "Calendar unavailable."));
  }
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
    button.setAttribute("aria-label", new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(date));
    button.append(node("span", "day-number", String(date.getDate())));
    const items = node("span", "day-items");
    const visible = [
      ...events.map((value) => ({ type: "event", value })),
      ...scheduled.map((value) => ({ type: "todo", value, marker: "◷" })),
      ...due.map((value) => ({ type: "todo", value, marker: "Due" })),
    ];
    for (const item of visible.slice(0, 3)) {
      items.append(item.type === "event"
        ? node("span", `day-event ${item.value.status}`, `${item.value.isAllDay ? "" : `${formatEventTime(item.value)} `}${item.value.title}`)
        : node("span", "day-todo", `${item.marker} ${item.value.text}`));
    }
    if (visible.length > 3) items.append(node("span", "day-more", `+${visible.length - 3} more`));
    button.append(items);
    button.addEventListener("click", () => { selectedCalendarDate = date; renderCalendar(); });
    elements.calendarGrid.append(button);
  }
  renderAgenda();
}

function renderAgenda() {
  const events = calendarEvents.filter((calendarEvent) => occursOnDay(calendarEvent, selectedCalendarDate));
  const todoEntries = [
    ...todosScheduledOnDay(selectedCalendarDate).map((todo) => ({ todo, timing: "Scheduled task" })),
    ...todosDueOnDay(selectedCalendarDate).map((todo) => ({ todo, timing: "Task due" })),
  ];
  elements.agendaDate.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long", month: "long", day: "numeric",
  }).format(selectedCalendarDate);
  elements.agendaList.replaceChildren();
  if (events.length === 0 && todoEntries.length === 0) {
    elements.agendaList.append(node("p", "agenda-empty", "Nothing scheduled. Add an event here or tell Slayer what to put on the calendar."));
    return;
  }
  for (const calendarEvent of events) {
    const button = node("button", "agenda-item");
    button.type = "button";
    button.append(
      node("strong", "", calendarEvent.title),
      node("span", "", [formatEventTime(calendarEvent), calendarEvent.location].filter(Boolean).join(" · ")),
    );
    if (calendarEvent.readOnly) {
      button.disabled = true;
      button.title = "This item is generated from a recurring event or contact record.";
    } else {
      button.addEventListener("click", () => openEventEditor(calendarEvent));
    }
    elements.agendaList.append(button);
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
    elements.eventStatus.value = "confirmed";
  }
  elements.eventDialog.showModal();
  elements.eventTitle.focus();
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
    const [body, groupBody] = await Promise.all([
      api(`/api/todos?scope=${encodeURIComponent(elements.todoScope.value)}&limit=1000`),
      api("/api/todo-groups"),
    ]);
    displayedTodos = body.todos;
    todoGroups = groupBody.groups;
    const selectedGroup = elements.todoGroupFilter.value;
    elements.todoGroupFilter.replaceChildren(node("option", "", "All groups"));
    elements.todoGroupFilter.firstElementChild.value = "";
    for (const group of todoGroups) {
      const option = node("option", "", group.name);
      option.value = String(group.id);
      elements.todoGroupFilter.append(option);
    }
    elements.todoGroupFilter.value = todoGroups.some(({ id }) => String(id) === selectedGroup) ? selectedGroup : "";
    renderTodos();
  } catch (error) {
    elements.todoList.replaceChildren(node("p", "empty", error.message || "To-Do List unavailable."));
  }
}

function formatTodoDateTime(value) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium", timeStyle: "short", hour12: false, hourCycle: "h23",
  }).format(new Date(value));
}

function renderTodos() {
  elements.todoList.replaceChildren();
  const visibleTodos = elements.todoGroupFilter.value
    ? displayedTodos.filter(({ groupId }) => String(groupId) === elements.todoGroupFilter.value)
    : displayedTodos;
  elements.todoCount.textContent = `${visibleTodos.length} ${visibleTodos.length === 1 ? "task" : "tasks"}`;
  if (visibleTodos.length === 0) {
    elements.todoList.append(node("p", "empty", "No tasks in this view."));
    return;
  }
  for (const todo of visibleTodos) {
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
    body.append(node("h3", "", todo.text));
    const metadata = node("div", "todo-meta");
    metadata.append(node("span", "todo-pill", todo.groupName));
    if (todo.sequence != null) metadata.append(node("span", "todo-pill", `#${todo.sequence}`));
    metadata.append(node("span", "todo-pill", todo.status.replaceAll("_", " ")));
    if (todo.scheduledAtUtc) metadata.append(node("span", "todo-pill", `scheduled ${formatTodoDateTime(todo.scheduledAtUtc)}`));
    if (todo.dueAtUtc) {
      const due = new Date(todo.dueAtUtc);
      metadata.append(node("span", `todo-pill ${todo.status !== "complete" && due < new Date() ? "overdue" : ""}`, `due ${formatTodoDateTime(due)}`));
    }
    if (todo.recurrenceRule) metadata.append(node("span", "todo-pill", todo.recurrenceRule));
    body.append(metadata);
    const actions = node("div", "todo-actions");
    const up = node("button", "secondary compact", "↑");
    const down = node("button", "secondary compact", "↓");
    const edit = node("button", "secondary compact", "Edit");
    up.type = down.type = edit.type = "button";
    up.title = "Move task up";
    down.title = "Move task down";
    up.addEventListener("click", () => void moveTodo(todo, -1, visibleTodos));
    down.addEventListener("click", () => void moveTodo(todo, 1, visibleTodos));
    edit.addEventListener("click", () => openTodoEditor(todo));
    actions.append(up, down, edit);
    card.append(check, body, actions);
    elements.todoList.append(card);
  }
}

async function moveTodo(todo, offset, visibleTodos) {
  const groupTodos = visibleTodos.filter(({ groupId }) => groupId === todo.groupId);
  const other = groupTodos[groupTodos.findIndex(({ id }) => id === todo.id) + offset];
  if (!other) return;
  try {
    if (todo.sortPosition === other.sortPosition) {
      await api(`/api/todos/${todo.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: todo.version, sortPosition: todo.sortPosition + offset }),
      });
    } else {
      await api(`/api/todos/${other.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: other.version, sortPosition: todo.sortPosition }),
      });
      await api(`/api/todos/${todo.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: todo.version, sortPosition: other.sortPosition }),
      });
    }
    await refreshTodos();
  } catch (error) {
    window.alert(error.message || "Could not reorder the task.");
  }
}

function openTodoEditor(todo = null) {
  elements.todoForm.reset();
  elements.todoFormError.textContent = "";
  elements.todoDialogTitle.textContent = todo ? "Edit todo" : "New todo";
  elements.todoId.value = todo?.id ?? "";
  elements.todoVersion.value = todo?.version ?? "";
  elements.todoGroup.replaceChildren();
  for (const group of todoGroups) {
    const option = node("option", "", group.name);
    option.value = String(group.id);
    elements.todoGroup.append(option);
  }
  elements.todoText.value = todo?.text ?? "";
  elements.todoGroup.value = String(todo?.groupId ?? (elements.todoGroupFilter.value || todoGroups[0]?.id || ""));
  elements.todoSequence.value = todo?.sequence ?? "";
  elements.todoScheduled.value = localDateTimeInput(todo?.scheduledAtUtc);
  elements.todoDue.value = localDateTimeInput(todo?.dueAtUtc);
  elements.todoStatus.value = todo?.status ?? "todo";
  elements.todoRecurrenceRule.value = todo?.recurrenceRule ?? "";
  elements.todoRecurrenceRule.disabled = Boolean(todo?.routineId);
  elements.todoRecurrenceRule.title = todo?.routineId ? "Edit the routine definition through the agent." : "";
  elements.todoDialog.showModal();
  elements.todoText.focus();
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
      scheduledAtUtc: inputToIso(elements.todoScheduled.value),
      dueAtUtc: inputToIso(elements.todoDue.value),
      status: elements.todoStatus.value,
    };
    if (!elements.todoRecurrenceRule.disabled) {
      payload.recurrenceRule = elements.todoRecurrenceRule.value;
      payload.recurrenceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
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

async function createTodoGroup() {
  const name = window.prompt("Name the new to-do group:")?.trim();
  if (!name) return;
  try {
    const body = await api("/api/todo-groups", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    await refreshTodos();
    elements.todoGroupFilter.value = String(body.group.id);
    renderTodos();
  } catch (error) {
    window.alert(error.message || "Could not create the group.");
  }
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = elements.text.value.trim();
  if (!text) return;
  elements.send.disabled = true;
  elements.status.textContent = "Submitting…";
  try {
    await api("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    elements.text.value = "";
    elements.status.textContent = "Queued.";
    await loadRequests({ force: true });
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    elements.send.disabled = false;
  }
});

elements.text.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.ctrlKey || event.isComposing) return;
  event.preventDefault();
  if (!elements.send.disabled) elements.form.requestSubmit();
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
for (const button of elements.navButtons) button.addEventListener("click", () => switchView(button.dataset.view));
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
elements.newEvent.addEventListener("click", () => openEventEditor());
elements.eventAllDay.addEventListener("change", () => setEventInputTypes(elements.eventAllDay.checked));
elements.eventForm.addEventListener("submit", saveEvent);
elements.newTodo.addEventListener("click", async () => {
  if (todoGroups.length === 0) await refreshTodos();
  openTodoEditor();
});
elements.newTodoGroup.addEventListener("click", () => void createTodoGroup());
elements.todoScope.addEventListener("change", () => void refreshTodos());
elements.todoGroupFilter.addEventListener("change", renderTodos);
elements.todoForm.addEventListener("submit", saveTodo);
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
