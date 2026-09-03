import {
  combineLocalDateTime,
  splitLocalDateTime,
} from "./event-date-time.js";
import { formatDisplayDate, formatDisplayTime, formatLocalDate } from "./presentation-format.js";
import { markdownToSpeech, renderMarkdown } from "./markdown.js";
import {
  calendarEventCellItem,
  calendarDayTimeRangeLabel,
  dateSequence,
  occursDuringCalendarDay,
  renderCalendarGrid,
  scheduledTodoCellItem,
  sixWeekMonthDates,
} from "./calendar-grid.js";
import { createTimingEditor } from "./timing-editor.js";

const elements = {
  composer: document.querySelector("#chat-composer"),
  form: document.querySelector("#request-form"),
  text: document.querySelector("#request-text"),
  send: document.querySelector("#send"),
  respondSilently: document.querySelector("#respond-silently"),
  composerAttachFile: document.querySelector("#composer-attach-file"),
  composerFileSelection: document.querySelector("#composer-file-selection"),
  composerFileLabel: document.querySelector("#composer-file-label"),
  composerRemoveRequestFile: document.querySelector("#composer-remove-request-file"),
  requestFile: document.querySelector("#request-file"),
  requestFileLabel: document.querySelector("#request-file-label"),
  requestImagePreview: document.querySelector("#request-image-preview"),
  requestExistingFile: document.querySelector("#request-existing-file"),
  editSelectedFile: document.querySelector("#edit-selected-file"),
  removeRequestFile: document.querySelector("#remove-request-file"),
  fileDialog: document.querySelector("#file-dialog"),
  fileForm: document.querySelector("#file-form"),
  fileDialogHeading: document.querySelector("#file-dialog-heading"),
  fileOriginalFilename: document.querySelector("#file-original-filename"),
  fileTitle: document.querySelector("#file-title"),
  fileDescription: document.querySelector("#file-description"),
  fileFormError: document.querySelector("#file-form-error"),
  runLimitsButton: document.querySelector("#run-limits-button"),
  runLimitsSummary: document.querySelector("#run-limits-summary"),
  runLimitsDialog: document.querySelector("#run-limits-dialog"),
  runLimitsForm: document.querySelector("#run-limits-form"),
  runToolCallLimit: document.querySelector("#run-tool-call-limit"),
  runToolCallsUnlimited: document.querySelector("#run-tool-calls-unlimited"),
  runTimeLimitMinutes: document.querySelector("#run-time-limit-minutes"),
  runTimeUnlimited: document.querySelector("#run-time-unlimited"),
  runLimitsDefaults: document.querySelector("#run-limits-defaults"),
  record: document.querySelector("#record"),
  recordMeter: document.querySelector("#record-meter"),
  cancelRecording: document.querySelector("#cancel-recording"),
  recordLabel: document.querySelector("#record-label"),
  recordTimer: document.querySelector("#record-timer"),
  status: document.querySelector("#composer-status"),
  runtime: document.querySelector("#runtime"),
  integrationsButton: document.querySelector("#integrations-button"),
  integrationsDialog: document.querySelector("#integrations-dialog"),
  integrationList: document.querySelector("#integration-list"),
  mcpIntegrationForm: document.querySelector("#mcp-integration-form"),
  mcpIntegrationName: document.querySelector("#mcp-integration-name"),
  mcpIntegrationUrl: document.querySelector("#mcp-integration-url"),
  mcpIntegrationToken: document.querySelector("#mcp-integration-token"),
  mcpIntegrationConnect: document.querySelector("#mcp-integration-connect"),
  mcpIntegrationError: document.querySelector("#mcp-integration-error"),
  usage: document.querySelector("#usage"),
  refresh: document.querySelector("#refresh"),
  newConversation: document.querySelector("#new-conversation"),
  requestLimit: document.querySelector("#request-limit"),
  selectVideoScriptSources: document.querySelector("#select-video-script-sources"),
  videoScriptSelection: document.querySelector("#video-script-selection"),
  videoScriptSelectionCount: document.querySelector("#video-script-selection-count"),
  cancelVideoScriptSelection: document.querySelector("#cancel-video-script-selection"),
  generateVideoScript: document.querySelector("#generate-video-script"),
  list: document.querySelector("#request-list"),
  scrollLatest: document.querySelector("#scroll-latest"),
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
  agentMascot: document.querySelector("#agent-mascot"),
  navButtons: document.querySelectorAll(".top-nav-button[data-view]"),
  settingsMenu: document.querySelector("#settings-menu"),
  composerHatsLink: document.querySelector("#composer-hats-link"),
  agentView: document.querySelector("#agent-view"),
  hatsView: document.querySelector("#hats-view"),
  hatsTitle: document.querySelector("#hats-title"),
  hatInvocationTemplate: document.querySelector("#hat-invocation-template"),
  hatIntroduction: document.querySelector("#hat-introduction"),
  hatDestinationRule: document.querySelector("#hat-destination-rule"),
  hatMultipleRule: document.querySelector("#hat-multiple-rule"),
  hatList: document.querySelector("#hat-list"),
  hatStatus: document.querySelector("#hat-status"),
  calendarView: document.querySelector("#calendar-view"),
  routineView: document.querySelector("#routine-view"),
  routineGrid: document.querySelector("#routine-grid"),
  routineAgendaDate: document.querySelector("#routine-agenda-date"),
  routineAgendaCount: document.querySelector("#routine-agenda-count"),
  routineAgendaList: document.querySelector("#routine-agenda-list"),
  routinePublishStatus: document.querySelector("#routine-publish-status"),
  newRoutine: document.querySelector("#new-routine"),
  publishRoutineThisWeek: document.querySelector("#publish-routine-this-week"),
  publishRoutineNextWeek: document.querySelector("#publish-routine-next-week"),
  todosView: document.querySelector("#todos-view"),
  contentView: document.querySelector("#content-view"),
  videoScriptsView: document.querySelector("#video-scripts-view"),
  filesView: document.querySelector("#files-view"),
  refreshFiles: document.querySelector("#refresh-files"),
  fileList: document.querySelector("#file-list"),
  fileEmpty: document.querySelector("#file-empty"),
  fileSelectionStatus: document.querySelector("#file-selection-status"),
  contactsView: document.querySelector("#contacts-view"),
  logsView: document.querySelector("#logs-view"),
  interactionsView: document.querySelector("#interactions-view"),
  aiUsageView: document.querySelector("#ai-usage-view"),
  refreshAiUsage: document.querySelector("#refresh-ai-usage"),
  aiUsageMonthCost: document.querySelector("#ai-usage-month-cost"),
  aiUsageMonthTokens: document.querySelector("#ai-usage-month-tokens"),
  aiUsageTotalCost: document.querySelector("#ai-usage-total-cost"),
  aiUsageTotalTokens: document.querySelector("#ai-usage-total-tokens"),
  aiUsageCurrentModel: document.querySelector("#ai-usage-current-model"),
  aiUsageEntryCount: document.querySelector("#ai-usage-entry-count"),
  aiPricingForm: document.querySelector("#ai-pricing-form"),
  aiInputPrice: document.querySelector("#ai-input-price"),
  aiCachedInputPrice: document.querySelector("#ai-cached-input-price"),
  aiCacheWritePrice: document.querySelector("#ai-cache-write-price"),
  aiOutputPrice: document.querySelector("#ai-output-price"),
  resetAiPricing: document.querySelector("#reset-ai-pricing"),
  aiUsageRows: document.querySelector("#ai-usage-rows"),
  aiUsageEmpty: document.querySelector("#ai-usage-empty"),
  aiUsageStatus: document.querySelector("#ai-usage-status"),
  calendarDateControl: document.querySelector("#calendar-date-control"),
  calendarWeekday: document.querySelector("#calendar-weekday"),
  calendarMonth: document.querySelector("#calendar-month"),
  calendarDay: document.querySelector("#calendar-day"),
  calendarYear: document.querySelector("#calendar-year"),
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
  agendaAllDayCount: document.querySelector("#agenda-all-day-count"),
  agendaAllDayList: document.querySelector("#agenda-all-day-list"),
  agendaTimelineCount: document.querySelector("#agenda-timeline-count"),
  agendaTimeline: document.querySelector("#agenda-timeline"),
  previousWeeks: document.querySelector("#previous-weeks"),
  today: document.querySelector("#today"),
  nextWeeks: document.querySelector("#next-weeks"),
  previousCalendarMonth: document.querySelector("#previous-calendar-month"),
  nextCalendarMonth: document.querySelector("#next-calendar-month"),
  previousCalendarYear: document.querySelector("#previous-calendar-year"),
  nextCalendarYear: document.querySelector("#next-calendar-year"),
  newEvent: document.querySelector("#new-event"),
  eventDialog: document.querySelector("#event-dialog"),
  eventForm: document.querySelector("#event-form"),
  eventDialogTitle: document.querySelector("#event-dialog-title"),
  eventId: document.querySelector("#event-id"),
  eventVersion: document.querySelector("#event-version"),
  eventTitle: document.querySelector("#event-title"),
  eventAllDay: document.querySelector("#event-all-day"),
  eventStart: document.querySelector("#event-start"),
  eventStartTime: document.querySelector("#event-start-time"),
  eventEnd: document.querySelector("#event-end"),
  eventEndTime: document.querySelector("#event-end-time"),
  eventDurationInput: document.querySelector("#event-duration-input"),
  eventDurationField: document.querySelector("#event-duration-field"),
  eventDuration: document.querySelector("#event-duration"),
  eventLocation: document.querySelector("#event-location"),
  eventDescription: document.querySelector("#event-description"),
  eventPlanningPrompt: document.querySelector("#event-planning-prompt"),
  eventStatus: document.querySelector("#event-status"),
  eventRepeatEnabled: document.querySelector("#event-repeat-enabled"),
  eventRepeatFields: document.querySelector("#event-repeat-fields"),
  eventRepeatInterval: document.querySelector("#event-repeat-interval"),
  eventRepeatFrequency: document.querySelector("#event-repeat-frequency"),
  eventRepeatWeekdays: document.querySelector("#event-repeat-weekdays"),
  eventRepeatMonthPattern: document.querySelector("#event-repeat-month-pattern"),
  eventRepeatPattern: document.querySelector("#event-repeat-pattern"),
  eventRepeatMonthDayLabel: document.querySelector("#event-repeat-month-day-label"),
  eventRepeatMonthDay: document.querySelector("#event-repeat-month-day"),
  eventRepeatOrdinalFields: document.querySelector("#event-repeat-ordinal-fields"),
  eventRepeatOrdinal: document.querySelector("#event-repeat-ordinal"),
  eventRepeatOrdinalWeekday: document.querySelector("#event-repeat-ordinal-weekday"),
  eventRepeatEnd: document.querySelector("#event-repeat-end"),
  eventRepeatCountLabel: document.querySelector("#event-repeat-count-label"),
  eventRepeatCount: document.querySelector("#event-repeat-count"),
  eventRepeatUntilLabel: document.querySelector("#event-repeat-until-label"),
  eventRepeatUntil: document.querySelector("#event-repeat-until"),
  eventRepeatSummary: document.querySelector("#event-repeat-summary"),
  eventFormError: document.querySelector("#event-form-error"),
  eventDelete: document.querySelector("#event-delete"),
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
  todoPlanningPrompt: document.querySelector("#todo-planning-prompt"),
  todoGroup: document.querySelector("#todo-group"),
  todoNewGroup: document.querySelector("#todo-new-group"),
  todoSequence: document.querySelector("#todo-sequence"),
  todoSequenceHint: document.querySelector("#todo-sequence-hint"),
  todoContact: document.querySelector("#todo-contact"),
  todoStart: document.querySelector("#todo-start"),
  todoStartTime: document.querySelector("#todo-start-time"),
  todoEnd: document.querySelector("#todo-end"),
  todoEndTime: document.querySelector("#todo-end-time"),
  todoDurationInput: document.querySelector("#todo-duration-input"),
  todoDurationField: document.querySelector("#todo-duration-field"),
  todoDuration: document.querySelector("#todo-duration"),
  todoClearScheduled: document.querySelector("#todo-clear-scheduled"),
  todoAllDay: document.querySelector("#todo-all-day"),
  todoDue: document.querySelector("#todo-due"),
  todoDueTime: document.querySelector("#todo-due-time"),
  todoStatus: document.querySelector("#todo-status"),
  todoRepeatEnabled: document.querySelector("#todo-repeat-enabled"),
  todoRepeatFields: document.querySelector("#todo-repeat-fields"),
  todoRepeatInterval: document.querySelector("#todo-repeat-interval"),
  todoRepeatFrequency: document.querySelector("#todo-repeat-frequency"),
  todoRepeatWeekdays: document.querySelector("#todo-repeat-weekdays"),
  todoRepeatMonthPattern: document.querySelector("#todo-repeat-month-pattern"),
  todoRepeatPattern: document.querySelector("#todo-repeat-pattern"),
  todoRepeatMonthDayLabel: document.querySelector("#todo-repeat-month-day-label"),
  todoRepeatMonthDay: document.querySelector("#todo-repeat-month-day"),
  todoRepeatOrdinalFields: document.querySelector("#todo-repeat-ordinal-fields"),
  todoRepeatOrdinal: document.querySelector("#todo-repeat-ordinal"),
  todoRepeatOrdinalWeekday: document.querySelector("#todo-repeat-ordinal-weekday"),
  todoRepeatEnd: document.querySelector("#todo-repeat-end"),
  todoRepeatCountLabel: document.querySelector("#todo-repeat-count-label"),
  todoRepeatCount: document.querySelector("#todo-repeat-count"),
  todoRepeatUntilLabel: document.querySelector("#todo-repeat-until-label"),
  todoRepeatUntil: document.querySelector("#todo-repeat-until"),
  todoInteractionGuide: document.querySelector("#todo-interaction-guide"),
  todoRepeatSummary: document.querySelector("#todo-repeat-summary"),
  todoFormError: document.querySelector("#todo-form-error"),
  contentSearch: document.querySelector("#content-search"),
  contentStatusFilter: document.querySelector("#content-status-filter"),
  contentGroupFilter: document.querySelector("#content-group-filter"),
  contentCount: document.querySelector("#content-count"),
  contentList: document.querySelector("#content-list"),
  newContentGroup: document.querySelector("#new-content-group"),
  contentGroupDialog: document.querySelector("#content-group-dialog"),
  contentGroupForm: document.querySelector("#content-group-form"),
  contentGroupDialogTitle: document.querySelector("#content-group-dialog-title"),
  contentGroupId: document.querySelector("#content-group-id"),
  contentGroupName: document.querySelector("#content-group-name"),
  contentGroupFormError: document.querySelector("#content-group-form-error"),
  contentGroupArchive: document.querySelector("#content-group-archive"),
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
  contentDelete: document.querySelector("#content-delete"),
  contentFormError: document.querySelector("#content-form-error"),
  refreshVideoScripts: document.querySelector("#refresh-video-scripts"),
  videoScriptStatusFilter: document.querySelector("#video-script-status-filter"),
  videoScriptCount: document.querySelector("#video-script-count"),
  videoScriptList: document.querySelector("#video-script-list"),
  videoScriptEmpty: document.querySelector("#video-script-empty"),
  videoContentDialog: document.querySelector("#video-content-dialog"),
  videoContentForm: document.querySelector("#video-content-form"),
  videoContentTitle: document.querySelector("#video-content-title"),
  videoContentGroup: document.querySelector("#video-content-group"),
  videoContentError: document.querySelector("#video-content-error"),
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
  logTrackerUnit: document.querySelector("#log-tracker-unit"),
  logOccurred: document.querySelector("#log-occurred"),
  logFormError: document.querySelector("#log-form-error"),
  interactionGuideStatus: document.querySelector("#interaction-guide-status"),
  interactionGuideCount: document.querySelector("#interaction-guide-count"),
  interactionGuideList: document.querySelector("#interaction-guide-list"),
  interactionGuideDetail: document.querySelector("#interaction-guide-detail"),
  interactionGuideStatusMessage: document.querySelector("#interaction-guide-status-message"),
  refreshInteractionGuides: document.querySelector("#refresh-interaction-guides"),
  newInteractionGuide: document.querySelector("#new-interaction-guide"),
  interactionGuideDialog: document.querySelector("#interaction-guide-dialog"),
  interactionGuideForm: document.querySelector("#interaction-guide-form"),
  interactionGuideDialogTitle: document.querySelector("#interaction-guide-dialog-title"),
  interactionGuideId: document.querySelector("#interaction-guide-id"),
  interactionGuideVersion: document.querySelector("#interaction-guide-version"),
  interactionGuideName: document.querySelector("#interaction-guide-name"),
  interactionGuideFormError: document.querySelector("#interaction-guide-form-error"),
  archiveInteractionGuide: document.querySelector("#archive-interaction-guide"),
  interactionStepDialog: document.querySelector("#interaction-step-dialog"),
  interactionStepForm: document.querySelector("#interaction-step-form"),
  interactionStepDialogTitle: document.querySelector("#interaction-step-dialog-title"),
  interactionStepId: document.querySelector("#interaction-step-id"),
  interactionStepGuide: document.querySelector("#interaction-step-guide"),
  interactionStepGuideHint: document.querySelector("#interaction-step-guide-hint"),
  interactionStepNumber: document.querySelector("#interaction-step-number"),
  interactionStepOpening: document.querySelector("#interaction-step-opening"),
  interactionStepInstructions: document.querySelector("#interaction-step-instructions"),
  interactionStepCompletionMode: document.querySelector("#interaction-step-completion-mode"),
  interactionStepEnabled: document.querySelector("#interaction-step-enabled"),
  interactionStepFormError: document.querySelector("#interaction-step-form-error"),
  deleteInteractionStep: document.querySelector("#delete-interaction-step"),
};

let accessToken = localStorage.getItem("agent-slayer-token") || "";
let lastHealth = null;
let activeTrace = null;
let recorder = null;
let recordingStream = null;
let recordingChunks = [];
let recordingStartedAt = null;
let recordingTimer = null;
let recordingRespondSilently = false;
let recordingCancelled = false;
let recordingAudioContext = null;
let recordingAudioSource = null;
let recordingAnalyser = null;
let recordingLevelData = null;
let recordingMeterFrame = null;
let recordingLevel = 0;
let pendingRunLimits = null;
let activeView = "agent";
let calendarRangeStart = startOfWeek(new Date());
let selectedCalendarDate = new Date();
let calendarEvents = [];
let calendarSearchTimer = null;
let calendarSearchSequence = 0;
let activeTodos = [];
let selectedRoutineDate = new Date();
let routineOccurrences = [];
let routineTemplates = [];
let calendarSchedulingTodo = null;
let calendarSchedulingBusy = false;
let eventInviteEventId = null;
let eventInviteContacts = [];
let eventInviteSelectedContactIds = new Set();
let eventInviteCreated = false;
let displayedTodos = [];
let todoGroups = [];
let todoContacts = [];
let todoGuides = [];
let contentItems = [];
let contentGroups = [];
let contentSearchTimer = null;
let videoScripts = [];
let videoAddingToContent = null;
let selectingVideoScriptSources = false;
const selectedVideoScriptRequestIds = new Set();
let loadedTodoRecurrenceTimeZone = null;
let todoRecurrenceDirty = false;
let movingOverdueTodos = false;
let moveOverdueFeedbackTimer = null;
let contacts = [];
let contactDuplicateReview = { groups: [], hasMore: false };
const selectedContactIds = new Set();
let logTrackers = [];
let logEntries = [];
let interactionGuideSummaries = [];
let selectedInteractionGuide = null;
let interactionGuideLoadSequence = 0;
let interactionGuideReorderInProgress = false;
let aiUsageData = null;
let requestImagePreviewUrl = null;
let storedFiles = [];
let editingFileId = null;
const requestNodes = new Map();
const speechQueueStorageKey = "agent-slayer-pending-spoken-responses";
const responseSilenceStorageKey = "agent-slayer-respond-silently";
const aiPricingStorageKey = "agent-slayer-ai-pricing";
const activeUtterances = new Set();
const pendingSpokenRequestIds = loadPendingSpokenRequestIds();
let scrollLatestUpdateFrame = null;
let scrollLatestAnimationFrame = null;
elements.respondSilently.checked = loadResponseSilencePreference();

const eventTimingEditor = createTimingEditor({
  startDate: elements.eventStart,
  startTime: elements.eventStartTime,
  endDate: elements.eventEnd,
  endTime: elements.eventEndTime,
  durationInput: elements.eventDurationInput,
  durationField: elements.eventDurationField,
  summary: elements.eventDuration,
  allDayInput: elements.eventAllDay,
  onChange: updateEventRecurrenceEditor,
});

const todoTimingEditor = createTimingEditor({
  startDate: elements.todoStart,
  startTime: elements.todoStartTime,
  endDate: elements.todoEnd,
  endTime: elements.todoEndTime,
  durationInput: elements.todoDurationInput,
  durationField: elements.todoDurationField,
  summary: elements.todoDuration,
  allDayInput: elements.todoAllDay,
  onChange: () => {
    updateTodoRecurrenceEditor();
    updateTodoClearScheduledVisibility();
  },
});

function updateComposerHeight() {
  document.documentElement.style.setProperty("--composer-height", `${elements.composer.offsetHeight}px`);
  scheduleScrollLatestButtonUpdate();
}

function resizeRequestText() {
  elements.text.style.height = "0";
  const minimum = Number.parseFloat(getComputedStyle(elements.text).minHeight) || 46;
  elements.text.style.height = `${Math.min(128, Math.max(minimum, elements.text.scrollHeight))}px`;
}

if ("ResizeObserver" in window) {
  new ResizeObserver(updateComposerHeight).observe(elements.composer);
} else {
  window.addEventListener("resize", updateComposerHeight);
}

function loadResponseSilencePreference() {
  try { return localStorage.getItem(responseSilenceStorageKey) === "true"; } catch { return false; }
}

function saveResponseSilencePreference() {
  try { localStorage.setItem(responseSilenceStorageKey, String(elements.respondSilently.checked)); } catch { /* Keep the in-page setting. */ }
}

function loadPendingSpokenRequestIds() {
  try {
    const stored = JSON.parse(localStorage.getItem(speechQueueStorageKey) || "[]");
    if (!Array.isArray(stored)) return new Set();
    return new Set(stored.filter((requestId) => typeof requestId === "string").slice(-100));
  } catch {
    return new Set();
  }
}

function savePendingSpokenRequestIds() {
  try {
    localStorage.setItem(speechQueueStorageKey, JSON.stringify([...pendingSpokenRequestIds]));
  } catch {
    // Speech still works for the current page when storage is unavailable.
  }
}

function prepareSpeechOutput(respondSilently) {
  if (respondSilently || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
  // Access speech synthesis during the submit/tap gesture so mobile browsers
  // allow the completed response to speak after the asynchronous model run.
  try { window.speechSynthesis.getVoices(); } catch { /* Request submission must still work. */ }
}

function expectSpokenResponse(requestId, respondSilently) {
  if (respondSilently || typeof requestId !== "string") return;
  pendingSpokenRequestIds.add(requestId);
  savePendingSpokenRequestIds();
}

function speakResponse(text) {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return;
  try {
    const spokenText = markdownToSpeech(text);
    if (!spokenText) return;
    const utterance = new SpeechSynthesisUtterance(spokenText);
    utterance.lang = document.documentElement.lang || "en";
    activeUtterances.add(utterance);
    const release = () => activeUtterances.delete(utterance);
    utterance.addEventListener("end", release, { once: true });
    utterance.addEventListener("error", release, { once: true });
    window.speechSynthesis.speak(utterance);
  } catch {
    // The written response remains visible if this browser cannot speak it.
  }
}

function speakCompletedResponses(requests) {
  if (recorder?.state === "recording") return;
  for (const request of requests) {
    if (!pendingSpokenRequestIds.has(request.requestId)) continue;
    if (request.response) {
      pendingSpokenRequestIds.delete(request.requestId);
      savePendingSpokenRequestIds();
      speakResponse(request.response);
    } else if (request.error) {
      pendingSpokenRequestIds.delete(request.requestId);
      savePendingSpokenRequestIds();
    }
  }
}

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

const svgNamespace = "http://www.w3.org/2000/svg";

function hatSvg(hat) {
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("class", "agent-hat-svg");
  svg.setAttribute("viewBox", "0 0 128 72");
  svg.setAttribute("aria-hidden", "true");
  const crown = document.createElementNS(svgNamespace, "path");
  crown.setAttribute("class", "agent-hat-shape");
  crown.setAttribute("d", "M30 46 38 17Q64 5 90 17L98 46Z");
  const brim = document.createElementNS(svgNamespace, "path");
  brim.setAttribute("class", "agent-hat-shape");
  brim.setAttribute("d", "M16 48Q64 39 112 48 103 62 64 62 25 62 16 48Z");
  const label = String(hat.label || hat.id).trim();
  const text = document.createElementNS(svgNamespace, "text");
  text.setAttribute("class", "agent-hat-label");
  text.setAttribute("x", "64");
  text.setAttribute("y", "37");
  text.setAttribute("font-size", label.length > 9 ? "12" : label.length > 7 ? "13" : label.length > 5 ? "15" : "17");
  if (label.length > 7) {
    text.setAttribute("textLength", "54");
    text.setAttribute("lengthAdjust", "spacingAndGlyphs");
  }
  text.textContent = label;
  svg.append(crown, brim, text);
  return svg;
}

function renderAgentMascot(target, hats = []) {
  const explicitHats = Array.isArray(hats) ? hats.filter((hat) => hat?.id) : [];
  target.replaceChildren();
  target.hidden = explicitHats.length === 0;
  if (explicitHats.length === 0) {
    target.removeAttribute("title");
    if (target.getAttribute("aria-hidden") !== "true") target.removeAttribute("aria-label");
    return;
  }
  target.append(hatSvg(explicitHats[0]));
  if (explicitHats.length > 1) {
    const badges = node("span", "agent-hat-badges");
    for (const hat of explicitHats.slice(1)) {
      const badge = node("span", "agent-hat-badge");
      badge.append(hatSvg(hat));
      badges.append(badge);
    }
    target.append(badges);
  }
  const description = `${explicitHats.map(({ label, id }) => label || id).join(" and ")} hat${explicitHats.length === 1 ? "" : "s"}`;
  target.title = description;
  if (target.getAttribute("aria-hidden") !== "true") target.setAttribute("aria-label", description);
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}

function conciseReferenceText(value, maximum = 200) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1).trimEnd()}…`;
}

function referenceCode(fields) {
  return `Reference code: ${Object.entries(fields)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join("; ")}`;
}

function fileIdentity(file) {
  return [
    `File: ${conciseReferenceText(file.title)}`,
    file.originalFilename && file.originalFilename !== file.title
      ? `Original filename: ${conciseReferenceText(file.originalFilename)}`
      : null,
    file.mediaKind ? `Type: ${file.mediaKind}` : null,
    referenceCode({ file_id: file.fileId }),
  ].filter(Boolean).join("\n");
}

function videoIdentity(script) {
  return [
    `Generated video: ${conciseReferenceText(script.title)}`,
    referenceCode({
      video_script_id: script.id,
      video_job_id: script.render?.id ?? null,
      output_file_id: script.render?.outputFileId ?? null,
      content_id: script.render?.contentId ?? null,
    }),
  ].join("\n");
}

function todoIdentity(todo) {
  return [
    `Task: ${conciseReferenceText(todo.text)}`,
    todo.groupName ? `Group: ${conciseReferenceText(todo.groupName, 80)}` : null,
    referenceCode({ personal_task_id: todo.id }),
  ].filter(Boolean).join("\n");
}

function exchangeIdentity(requestId, requestText = "") {
  return [
    `Exchange: ${conciseReferenceText(requestText || "Agent conversation")}`,
    referenceCode({ request_id: requestId }),
  ].join("\n");
}

function referencedRequestIdsFromComposer(value) {
  const requestIds = [];
  const patterns = [
    /^Reference code:\s*request_id=([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\s*$/gimu,
    /^Exchange request_id ([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.$/gimu,
  ];
  for (const pattern of patterns) {
    for (const match of String(value || "").matchAll(pattern)) requestIds.push(match[1].toLowerCase());
  }
  return [...new Set(requestIds)].slice(0, 8);
}

function placeIdentityInComposer(identity) {
  const reference = `In reference to:\n${identity}`;
  const existingText = elements.text.value;
  elements.text.value = existingText ? `${reference}\n\n${existingText}` : `${reference}\n\n`;
  resizeRequestText();
  switchView("agent");
  elements.text.focus();
  elements.text.setSelectionRange(elements.text.value.length, elements.text.value.length);
}

function replyArrowIcon() {
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("class", "reply-reference-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const curve = document.createElementNS(svgNamespace, "path");
  curve.setAttribute("d", "M20 19c0-4.4-3.6-8-8-8H4");
  const arrowhead = document.createElementNS(svgNamespace, "path");
  arrowhead.setAttribute("d", "m9 6-5 5 5 5");
  svg.append(curve, arrowhead);
  return svg;
}

function agentReferenceButton(identity, subject) {
  const button = node("button", "reference-in-agent secondary compact");
  button.type = "button";
  button.title = `Reference ${subject} in Agent`;
  button.setAttribute("aria-label", button.title);
  button.append(replyArrowIcon());
  button.addEventListener("click", () => {
    placeIdentityInComposer(identity);
    elements.status.textContent = "Added to Agent composer.";
  });
  return button;
}

function replyToExchange(requestId, requestText) {
  const identity = exchangeIdentity(requestId, requestText);
  if (!elements.text.value.includes(identity)) placeIdentityInComposer(identity);
  else {
    switchView("agent");
    elements.text.focus();
  }
  elements.status.textContent = `Added exchange ${requestId.slice(0, 8)} to Agent composer.`;
}

function updateRequestFileSelection() {
  const file = elements.requestFile.files?.[0] ?? null;
  const existingFileId = Number(elements.requestExistingFile.value) || null;
  if (requestImagePreviewUrl) URL.revokeObjectURL(requestImagePreviewUrl);
  requestImagePreviewUrl = null;
  elements.requestFileLabel.hidden = !file;
  elements.removeRequestFile.hidden = !file && existingFileId === null;
  elements.editSelectedFile.hidden = existingFileId === null;
  elements.requestFileLabel.textContent = file ? `${file.name} · ${formatFileSize(file.size)}` : "";
  const image = Boolean(file && (file.type.startsWith("image/") || /\.(?:jpe?g|png|webp|gif)$/iu.test(file.name)));
  elements.requestImagePreview.hidden = !image;
  elements.requestImagePreview.removeAttribute("src");
  if (image) {
    requestImagePreviewUrl = URL.createObjectURL(file);
    elements.requestImagePreview.src = requestImagePreviewUrl;
  }
  const stored = storedFiles.find(({ fileId }) => fileId === existingFileId);
  const composerFileLabel = file
    ? file.name
    : stored
      ? `#${stored.fileId} ${stored.title}`
      : "";
  elements.composerFileSelection.hidden = !composerFileLabel;
  elements.composerFileLabel.textContent = composerFileLabel;
  elements.composerAttachFile.classList.toggle("selected", Boolean(composerFileLabel));
  elements.composerAttachFile.setAttribute(
    "aria-label",
    composerFileLabel ? `Replace attached file: ${composerFileLabel}` : "Attach a file",
  );
  elements.composerAttachFile.title = elements.composerAttachFile.getAttribute("aria-label");
  elements.fileSelectionStatus.textContent = file
    ? `${file.name} will be uploaded and attached to the next request.`
    : stored
      ? `File #${stored.fileId} — ${stored.title} will be attached to the next request.`
      : "No file selected for the next request.";
  renderFileLibrary();
}

function renderFileLibrary() {
  elements.fileList.replaceChildren();
  const selectedFileId = Number(elements.requestExistingFile.value) || null;
  for (const file of storedFiles) {
    const card = node("article", "file-card organizer-panel");
    card.classList.toggle("selected", file.fileId === selectedFileId);
    const heading = node("div", "file-card-heading");
    heading.append(
      node("strong", "", file.title),
      node("span", "file-card-id", `File #${file.fileId}`),
    );
    const metadata = [
      file.originalFilename && file.originalFilename !== file.title ? file.originalFilename : null,
      file.mediaKind || null,
      Number.isFinite(file.byteSize) ? formatFileSize(file.byteSize) : null,
    ].filter(Boolean).join(" · ");
    const actions = node("div", "file-card-actions");
    const reply = agentReferenceButton(fileIdentity(file), `file ${file.fileId}`);
    const edit = node("button", "secondary compact", "Edit details");
    edit.type = "button";
    edit.addEventListener("click", () => void openFileEditor(file.fileId));
    actions.append(reply, edit);
    card.append(heading);
    if (metadata) card.append(node("p", "file-card-meta", metadata));
    if (file.description) card.append(node("p", "file-card-description", file.description));
    card.append(actions);
    elements.fileList.append(card);
  }
  elements.fileEmpty.hidden = storedFiles.length > 0;
}

function renderStoredFileOptions() {
  const selected = elements.requestExistingFile.value;
  elements.requestExistingFile.replaceChildren(new Option("Previously uploaded file…", ""));
  for (const file of storedFiles) {
    const original = file.originalFilename && file.originalFilename !== file.title
      ? ` — ${file.originalFilename}`
      : "";
    elements.requestExistingFile.append(new Option(`#${file.fileId} ${file.title}${original}`, String(file.fileId)));
  }
  if ([...elements.requestExistingFile.options].some((option) => option.value === selected)) {
    elements.requestExistingFile.value = selected;
  }
  updateRequestFileSelection();
}

async function loadFiles() {
  const body = await api("/api/files?limit=200");
  storedFiles = body.files ?? [];
  renderStoredFileOptions();
}

async function openFileEditor(fileId) {
  const body = await api(`/api/files/${fileId}`);
  const file = body.file;
  editingFileId = file.fileId;
  elements.fileDialogHeading.textContent = `File #${file.fileId}`;
  elements.fileOriginalFilename.textContent = `Original filename: ${file.originalFilename || "Unavailable"}`;
  elements.fileTitle.value = file.title || "";
  elements.fileDescription.value = file.description || "";
  elements.fileFormError.textContent = "";
  elements.fileDialog.showModal();
  elements.fileTitle.focus();
}

async function saveFileDetails(event) {
  event.preventDefault();
  if (!editingFileId) return;
  elements.fileFormError.textContent = "";
  const submit = elements.fileForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await api(`/api/files/${editingFileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: elements.fileTitle.value,
        description: elements.fileDescription.value.trim() || null,
      }),
    });
    elements.fileDialog.close();
    await Promise.all([loadFiles(), loadRequests({ force: true })]);
  } catch (error) {
    elements.fileFormError.textContent = error.message || "Could not save file details.";
  } finally {
    submit.disabled = false;
  }
}

function requestFileMimeType(file) {
  if (file.type) return file.type;
  const extension = file.name.toLowerCase().split(".").pop();
  return ({
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
    csv: "text/csv", tsv: "text/tab-separated-values", json: "application/json",
    jsonl: "application/x-ndjson", vcf: "text/vcard", txt: "text/plain",
  })[extension] || "application/octet-stream";
}

function runLimitsText(runLimits) {
  if (runLimits === null) return "";
  const calls = runLimits.maxToolCalls === null ? "unlimited calls" : `${runLimits.maxToolCalls} calls`;
  const time = runLimits.timeoutMs === null ? "no deadline" : `${Math.round(runLimits.timeoutMs / 60_000)} min`;
  return `${calls} · ${time}`;
}

function updateRunLimitsSummary() {
  elements.runLimitsSummary.hidden = pendingRunLimits === null;
  elements.runLimitsSummary.textContent = runLimitsText(pendingRunLimits);
  elements.runLimitsButton.classList.toggle("ready", pendingRunLimits !== null);
}

function updateRunLimitFields() {
  elements.runToolCallLimit.disabled = elements.runToolCallsUnlimited.checked;
  elements.runTimeLimitMinutes.disabled = elements.runTimeUnlimited.checked;
}

function openRunLimitsDialog() {
  elements.runToolCallsUnlimited.checked = pendingRunLimits?.maxToolCalls === null && pendingRunLimits !== null;
  elements.runTimeUnlimited.checked = pendingRunLimits?.timeoutMs === null && pendingRunLimits !== null;
  elements.runToolCallLimit.value = pendingRunLimits?.maxToolCalls ?? 256;
  elements.runTimeLimitMinutes.value = pendingRunLimits?.timeoutMs == null
    ? 60
    : Math.max(1, Math.round(pendingRunLimits.timeoutMs / 60_000));
  updateRunLimitFields();
  elements.runLimitsDialog.showModal();
}

function applyRunLimits(event) {
  event.preventDefault();
  if (!elements.runLimitsForm.reportValidity()) return;
  pendingRunLimits = {
    maxToolCalls: elements.runToolCallsUnlimited.checked ? null : Number(elements.runToolCallLimit.value),
    timeoutMs: elements.runTimeUnlimited.checked ? null : Number(elements.runTimeLimitMinutes.value) * 60_000,
  };
  updateRunLimitsSummary();
  elements.runLimitsDialog.close();
}

function clearRunLimits() {
  pendingRunLimits = null;
  updateRunLimitsSummary();
  elements.runLimitsDialog.close();
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

const recurrenceWeekdays = [
  ["MO", "Mon"], ["TU", "Tue"], ["WE", "Wed"], ["TH", "Thu"],
  ["FR", "Fri"], ["SA", "Sat"], ["SU", "Sun"],
];
const recurrenceFrequencyLabels = {
  DAILY: ["day", "days"], WEEKLY: ["week", "weeks"],
  MONTHLY: ["month", "months"], YEARLY: ["year", "years"],
};
const todoRecurrenceControls = {
  enabled: elements.todoRepeatEnabled, fields: elements.todoRepeatFields,
  interval: elements.todoRepeatInterval, frequency: elements.todoRepeatFrequency,
  weekdays: elements.todoRepeatWeekdays, monthPattern: elements.todoRepeatMonthPattern,
  pattern: elements.todoRepeatPattern, monthDayLabel: elements.todoRepeatMonthDayLabel,
  monthDay: elements.todoRepeatMonthDay, ordinalFields: elements.todoRepeatOrdinalFields,
  ordinal: elements.todoRepeatOrdinal, ordinalWeekday: elements.todoRepeatOrdinalWeekday,
  end: elements.todoRepeatEnd, countLabel: elements.todoRepeatCountLabel,
  count: elements.todoRepeatCount, untilLabel: elements.todoRepeatUntilLabel,
  until: elements.todoRepeatUntil, summary: elements.todoRepeatSummary,
};
const eventRecurrenceControls = {
  enabled: elements.eventRepeatEnabled, fields: elements.eventRepeatFields,
  interval: elements.eventRepeatInterval, frequency: elements.eventRepeatFrequency,
  weekdays: elements.eventRepeatWeekdays, monthPattern: elements.eventRepeatMonthPattern,
  pattern: elements.eventRepeatPattern, monthDayLabel: elements.eventRepeatMonthDayLabel,
  monthDay: elements.eventRepeatMonthDay, ordinalFields: elements.eventRepeatOrdinalFields,
  ordinal: elements.eventRepeatOrdinal, ordinalWeekday: elements.eventRepeatOrdinalWeekday,
  end: elements.eventRepeatEnd, countLabel: elements.eventRepeatCountLabel,
  count: elements.eventRepeatCount, untilLabel: elements.eventRepeatUntilLabel,
  until: elements.eventRepeatUntil, summary: elements.eventRepeatSummary,
};

function recurrenceParts(rule) {
  const values = {};
  for (const segment of String(rule || "").replace(/^RRULE:/i, "").split(";")) {
    const separator = segment.indexOf("=");
    if (separator > 0) values[segment.slice(0, separator).toUpperCase()] = segment.slice(separator + 1);
  }
  return values;
}

function selectedRepeatWeekdays(controls) {
  return [...controls.weekdays.querySelectorAll('input[type="checkbox"]:checked')]
    .map(({ value }) => value);
}

function repeatAnchorWeekday(value) {
  const date = value
    ? new Date(value.includes("T") ? value : `${value}T12:00:00`)
    : new Date();
  return ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][date.getDay()];
}

function ensureRepeatWeekday(controls, anchorValue) {
  if (controls.frequency.value !== "WEEKLY" || selectedRepeatWeekdays(controls).length) return;
  const fallback = repeatAnchorWeekday(anchorValue);
  const checkbox = controls.weekdays.querySelector(`input[value="${fallback}"]`);
  if (checkbox) checkbox.checked = true;
}

function buildRecurrenceRule(controls, anchorValue) {
  if (!controls.enabled.checked) return null;
  const interval = Number(controls.interval.value);
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) {
    throw new Error("Repeat interval must be a whole number from 1 to 999.");
  }
  const frequency = controls.frequency.value;
  const parts = [`FREQ=${frequency}`, `INTERVAL=${interval}`];
  if (frequency === "WEEKLY") {
    ensureRepeatWeekday(controls, anchorValue);
    const weekdays = selectedRepeatWeekdays(controls);
    if (!weekdays.length) throw new Error("Choose at least one weekday.");
    parts.push(`BYDAY=${weekdays.join(",")}`);
  }
  if (["MONTHLY", "YEARLY"].includes(frequency)) {
    if (frequency === "YEARLY" && controls.pattern.value !== "anchor") {
      const anchor = anchorValue
        ? new Date(anchorValue.includes("T") ? anchorValue : `${anchorValue}T12:00:00`)
        : null;
      if (!anchor || !Number.isFinite(anchor.getTime())) {
        throw new Error("Choose the first scheduled date for this yearly pattern.");
      }
      parts.push(`BYMONTH=${anchor.getMonth() + 1}`);
    }
    if (controls.pattern.value === "month-day") {
      const monthDay = Number(controls.monthDay.value);
      if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) {
        throw new Error("Day of month must be a whole number from 1 to 31.");
      }
      parts.push(`BYMONTHDAY=${monthDay}`);
    } else if (controls.pattern.value === "ordinal-weekday") {
      parts.push(
        `BYDAY=${controls.ordinalWeekday.value}`,
        `BYSETPOS=${controls.ordinal.value}`,
      );
    }
  }
  if (controls.end.value === "count") {
    const count = Number(controls.count.value);
    if (!Number.isInteger(count) || count < 1 || count > 9999) {
      throw new Error("Occurrences must be a whole number from 1 to 9999.");
    }
    parts.push(`COUNT=${count}`);
  } else if (controls.end.value === "until") {
    const until = controls.until.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("Choose the last recurrence date.");
    parts.push(`UNTIL=${until.replaceAll("-", "")}T235959`);
  }
  return parts.join(";");
}

function buildTodoRecurrenceRule() {
  return buildRecurrenceRule(todoRecurrenceControls, todoTimingEditor.values().start);
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
  if (["MONTHLY", "YEARLY"].includes(parts.FREQ) && parts.BYMONTHDAY) {
    description += ` on day ${parts.BYMONTHDAY}`;
  }
  if (["MONTHLY", "YEARLY"].includes(parts.FREQ) && parts.BYDAY && parts.BYSETPOS) {
    const labelsByValue = Object.fromEntries(recurrenceWeekdays);
    const ordinalLabels = { "1": "first", "2": "second", "3": "third", "4": "fourth", "5": "fifth", "-1": "last" };
    description += ` on the ${ordinalLabels[parts.BYSETPOS] || parts.BYSETPOS} ${labelsByValue[parts.BYDAY] || parts.BYDAY}`;
  }
  if (parts.FREQ === "YEARLY" && parts.BYMONTH) {
    const month = new Intl.DateTimeFormat(undefined, { month: "long", timeZone: "UTC" })
      .format(new Date(Date.UTC(2026, Number(parts.BYMONTH) - 1, 1)));
    description += ` in ${month}`;
  }
  if (parts.COUNT) description += `, ${parts.COUNT} occurrences`;
  if (parts.UNTIL) {
    const match = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL);
    if (match) description += `, through ${formatDisplayDate(new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00`), { includeTime: false })}`;
  }
  return description;
}

function updateRecurrenceEditor(controls, anchorValue) {
  const enabled = controls.enabled.checked;
  controls.fields.hidden = !enabled;
  if (!enabled) return;
  const weekly = controls.frequency.value === "WEEKLY";
  const monthlyPattern = ["MONTHLY", "YEARLY"].includes(controls.frequency.value);
  controls.weekdays.hidden = !weekly;
  controls.monthPattern.hidden = !monthlyPattern;
  controls.monthDayLabel.hidden = !monthlyPattern || controls.pattern.value !== "month-day";
  controls.ordinalFields.hidden = !monthlyPattern || controls.pattern.value !== "ordinal-weekday";
  if (weekly) ensureRepeatWeekday(controls, anchorValue);
  const ending = controls.end.value;
  controls.countLabel.hidden = ending !== "count";
  controls.untilLabel.hidden = ending !== "until";
  try {
    controls.summary.textContent = describeTodoRecurrence(buildRecurrenceRule(controls, anchorValue));
  } catch (error) {
    controls.summary.textContent = error.message;
  }
}

function loadRecurrenceEditor(controls, rule, anchorValue) {
  const parts = recurrenceParts(rule);
  controls.enabled.checked = Boolean(rule);
  controls.frequency.value = recurrenceFrequencyLabels[parts.FREQ] ? parts.FREQ : "WEEKLY";
  controls.interval.value = String(Math.max(1, Number(parts.INTERVAL) || 1));
  controls.pattern.value = parts.BYSETPOS && parts.BYDAY
    ? "ordinal-weekday"
    : parts.BYMONTHDAY ? "month-day" : "anchor";
  controls.monthDay.value = parts.BYMONTHDAY || "1";
  controls.ordinal.value = parts.BYSETPOS || "1";
  controls.ordinalWeekday.value = (parts.BYDAY || "MO").split(",")[0];
  for (const checkbox of controls.weekdays.querySelectorAll('input[type="checkbox"]')) {
    checkbox.checked = (parts.BYDAY || "").split(",").includes(checkbox.value);
  }
  controls.end.value = parts.COUNT ? "count" : parts.UNTIL ? "until" : "never";
  controls.count.value = parts.COUNT || "10";
  const untilMatch = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL || "");
  controls.until.value = untilMatch ? `${untilMatch[1]}-${untilMatch[2]}-${untilMatch[3]}` : "";
  updateRecurrenceEditor(controls, anchorValue);
}

function updateTodoRecurrenceEditor() {
  elements.todoInteractionGuide.disabled = !elements.todoRepeatEnabled.checked;
  updateRecurrenceEditor(todoRecurrenceControls, todoTimingEditor.values().start);
}

function loadTodoRecurrenceEditor(rule, recurrenceTimeZone = null) {
  loadedTodoRecurrenceTimeZone = recurrenceTimeZone || null;
  todoRecurrenceDirty = false;
  loadRecurrenceEditor(todoRecurrenceControls, rule, todoTimingEditor.values().start);
}

function buildEventRecurrenceRule() {
  return buildRecurrenceRule(eventRecurrenceControls, eventTimingEditor.values().start);
}

function updateEventRecurrenceEditor() {
  updateRecurrenceEditor(eventRecurrenceControls, eventTimingEditor.values().start);
}

function loadEventRecurrenceEditor(rule) {
  loadRecurrenceEditor(eventRecurrenceControls, rule, eventTimingEditor.values().start);
}

function formatTime(milliseconds) {
  return formatDisplayDate(milliseconds);
}

function formatClock(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, Number(milliseconds) || 0) / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function stopRecordingMeter() {
  if (recordingMeterFrame !== null) cancelAnimationFrame(recordingMeterFrame);
  recordingMeterFrame = null;
  recordingAudioSource?.disconnect();
  recordingAudioSource = null;
  recordingAnalyser = null;
  recordingLevelData = null;
  recordingLevel = 0;
  for (const bar of elements.recordMeter.children) bar.style.removeProperty("transform");
  const audioContext = recordingAudioContext;
  recordingAudioContext = null;
  if (audioContext && audioContext.state !== "closed") void audioContext.close().catch(() => {});
}

function updateRecordingMeter() {
  if (!recordingAnalyser || !recordingLevelData || recorder?.state !== "recording") return;
  recordingAnalyser.getByteTimeDomainData(recordingLevelData);
  let sumOfSquares = 0;
  for (const sample of recordingLevelData) {
    const centered = (sample - 128) / 128;
    sumOfSquares += centered * centered;
  }
  const rms = Math.sqrt(sumOfSquares / recordingLevelData.length);
  const measuredLevel = Math.min(1, Math.max(0, (rms - .01) * 9));
  recordingLevel = Math.max(measuredLevel, recordingLevel * .78);
  const barWeights = [.58, .82, 1, .76, .52];
  Array.from(elements.recordMeter.children).forEach((bar, index) => {
    const height = Math.max(.14, Math.min(1, recordingLevel * barWeights[index]));
    bar.style.transform = `scaleY(${height.toFixed(2)})`;
  });
  recordingMeterFrame = requestAnimationFrame(updateRecordingMeter);
}

function startRecordingMeter(stream) {
  stopRecordingMeter();
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  try {
    recordingAudioContext = new AudioContext();
    recordingAnalyser = recordingAudioContext.createAnalyser();
    recordingAnalyser.fftSize = 256;
    recordingAnalyser.smoothingTimeConstant = .65;
    recordingLevelData = new Uint8Array(recordingAnalyser.fftSize);
    recordingAudioSource = recordingAudioContext.createMediaStreamSource(stream);
    recordingAudioSource.connect(recordingAnalyser);
    if (recordingAudioContext.state === "suspended") void recordingAudioContext.resume().catch(() => {});
    updateRecordingMeter();
  } catch {
    stopRecordingMeter();
  }
}

function sendRecording() {
  if (recorder?.state !== "recording") return false;
  recordingRespondSilently = elements.respondSilently.checked;
  prepareSpeechOutput(recordingRespondSilently);
  clearInterval(recordingTimer);
  stopRecordingMeter();
  recorder.stop();
  elements.composer.classList.remove("recording");
  elements.record.disabled = true;
  elements.send.disabled = true;
  elements.cancelRecording.hidden = true;
  elements.respondSilently.disabled = true;
  elements.record.classList.remove("recording");
  elements.record.setAttribute("aria-label", "Saving recording");
  elements.record.title = "Saving recording";
  elements.status.textContent = "Saving recording…";
  return true;
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
  if (model?.usageMode === "metered") return model.ready
    ? `${name} · metered API`
    : `${name} · key required`;
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
  if (Number.isFinite(usage.estimatedCostUsd)) parts.push(`${formatUsd(usage.estimatedCostUsd)} estimated`);
  else if (usage.provider === "openai") parts.push("cost estimate unavailable");
  else if (largestDelta == null) parts.push("quota update pending");
  else if (largestDelta === 0) parts.push("quota change <1%");
  else parts.push(`+${largestDelta}% quota`);
  if (Number.isFinite(tokens)) parts.push(`${tokens.toLocaleString()} tokens`);
  const remaining = (usage.windows ?? []).map((window) => window.remainingPercent).filter(Number.isFinite);
  if (remaining.length) parts.push(`${Math.min(...remaining)}% left`);
  return parts.join(" · ");
}

function renderRequestSteps(container, steps = []) {
  container.replaceChildren();
  for (const step of steps) {
    const item = document.createElement("li");
    item.className = "request-step";
    item.dataset.status = step.status;
    item.append(node("strong", "", step.label));
    const tokens = Number(step.tokenUsage?.totalTokens);
    if (Number.isFinite(tokens) && (tokens > 0 || step.status !== "processing")) {
      item.append(node("span", "request-step-token", `${tokens.toLocaleString()} tokens`));
    }
    if (Number.isFinite(step.elapsedMs)) item.append(node("span", "", formatDuration(step.elapsedMs)));
    if (step.effort) item.append(node("span", "", `${step.effort} reasoning`));
    container.append(item);
  }
  container.hidden = steps.length === 0;
}

function formatUsd(value) {
  const amount = Number(value) || 0;
  const digits = amount > 0 && amount < 0.01 ? 4 : 2;
  return new Intl.NumberFormat(undefined, {
    style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(amount);
}

function validPricing(value) {
  return value && ["inputPerMillion", "cachedInputPerMillion", "cacheWritePerMillion", "outputPerMillion"]
    .every((key) => Number.isFinite(Number(value[key])) && Number(value[key]) >= 0);
}

function storedAiPricing(defaultPricing) {
  try {
    const stored = JSON.parse(localStorage.getItem(aiPricingStorageKey) || "null");
    if (validPricing(stored)) return stored;
  } catch { /* Use server defaults. */ }
  return defaultPricing;
}

function aiEntryCost(entry, pricing) {
  const uncached = Math.max(
    0,
    Number(entry.inputTokens) - Number(entry.cachedInputTokens) - Number(entry.cacheWriteTokens),
  );
  return (
    uncached * pricing.inputPerMillion
    + Number(entry.cachedInputTokens) * pricing.cachedInputPerMillion
    + Number(entry.cacheWriteTokens) * pricing.cacheWritePerMillion
    + Number(entry.outputTokens) * pricing.outputPerMillion
  ) / 1_000_000;
}

function meteredAiEntry(entry) {
  return entry.transport === "openai-responses"
    || entry.transport === "openai"
    || Number.isFinite(entry.recordedEstimatedCostUsd);
}

function renderAiUsage() {
  if (!aiUsageData) return;
  const pricing = storedAiPricing(aiUsageData.defaultPricing);
  elements.aiInputPrice.value = String(pricing.inputPerMillion);
  elements.aiCachedInputPrice.value = String(pricing.cachedInputPerMillion);
  elements.aiCacheWritePrice.value = String(pricing.cacheWritePerMillion);
  elements.aiOutputPrice.value = String(pricing.outputPerMillion);
  const entries = aiUsageData.entries.filter(meteredAiEntry);
  const now = new Date();
  const monthEntries = entries.filter((entry) => {
    const date = new Date(entry.occurredAtUtc);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  });
  const summarize = (selected) => ({
    tokens: selected.reduce((total, entry) => total + Number(entry.totalTokens || 0), 0),
    cost: selected.reduce((total, entry) => total + aiEntryCost(entry, pricing), 0),
  });
  const month = summarize(monthEntries);
  const total = summarize(entries);
  elements.aiUsageMonthCost.textContent = formatUsd(month.cost);
  elements.aiUsageMonthTokens.textContent = `${month.tokens.toLocaleString()} tokens`;
  elements.aiUsageTotalCost.textContent = formatUsd(total.cost);
  elements.aiUsageTotalTokens.textContent = `${total.tokens.toLocaleString()} tokens`;
  elements.aiUsageCurrentModel.textContent = `${aiUsageData.current.model} via ${aiUsageData.current.transport}`;
  elements.aiUsageEntryCount.textContent = `${entries.length.toLocaleString()} recorded model ${entries.length === 1 ? "call" : "calls"}`;
  elements.aiUsageRows.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement("tr");
    const values = [
      formatDisplayDate(entry.occurredAtUtc),
      entry.model || entry.transport || "Unknown",
      Number(entry.inputTokens).toLocaleString(),
      Number(entry.cachedInputTokens).toLocaleString(),
      Number(entry.cacheWriteTokens).toLocaleString(),
      Number(entry.outputTokens).toLocaleString(),
      formatUsd(aiEntryCost(entry, pricing)),
    ];
    for (const value of values) row.append(node("td", "", value));
    elements.aiUsageRows.append(row);
  }
  elements.aiUsageEmpty.hidden = entries.length > 0;
}

async function loadAiUsage() {
  elements.aiUsageStatus.textContent = "Loading usage…";
  try {
    aiUsageData = await api("/api/ai-usage?limit=10000");
    renderAiUsage();
    elements.aiUsageStatus.textContent = "";
  } catch (error) {
    elements.aiUsageStatus.textContent = error.message;
  }
}

function selectionTouchesRequests() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  return elements.list.contains(range.commonAncestorContainer) || range.intersectsNode(elements.list);
}

function updateVideoScriptSelection() {
  const count = selectedVideoScriptRequestIds.size;
  elements.videoScriptSelection.hidden = !selectingVideoScriptSources;
  elements.selectVideoScriptSources.textContent = selectingVideoScriptSources
    ? count
      ? `Review ${count} selected`
      : "Choose video interactions"
    : "Create video";
  elements.videoScriptSelectionCount.textContent = count
    ? `${count} ${count === 1 ? "interaction" : "interactions"} selected`
    : "Choose interactions for video";
  elements.generateVideoScript.textContent = count
    ? `Create video from ${count} ${count === 1 ? "interaction" : "interactions"}`
    : "Create video from selected";
  elements.generateVideoScript.disabled = count === 0;
  for (const [id, entry] of requestNodes) {
    const choice = entry.querySelector(".video-script-source-choice");
    const checkbox = entry.querySelector(".video-script-source-checkbox");
    const eligible = entry.dataset.scriptSelectable === "true";
    choice.hidden = !selectingVideoScriptSources || !eligible;
    checkbox.checked = selectedVideoScriptRequestIds.has(id);
    entry.querySelector(".request-card").classList.toggle(
      "video-script-selected",
      selectedVideoScriptRequestIds.has(id),
    );
  }
}

function showVideoScriptSelection() {
  if (activeView !== "agent") switchView("agent");
  updateVideoScriptSelection();
  window.requestAnimationFrame(() => {
    updateComposerHeight();
    scrollChatToLatest();
  });
}

function beginVideoScriptSelection() {
  selectingVideoScriptSources = true;
  selectedVideoScriptRequestIds.clear();
  showVideoScriptSelection();
}

function cancelVideoScriptSelection() {
  selectingVideoScriptSources = false;
  selectedVideoScriptRequestIds.clear();
  updateVideoScriptSelection();
}

function toggleVideoScriptSource(requestId, checked, checkbox) {
  if (checked && selectedVideoScriptRequestIds.size >= 8) {
    checkbox.checked = false;
    window.alert("Choose no more than 8 interactions for one video.");
    return;
  }
  if (checked) selectedVideoScriptRequestIds.add(requestId);
  else selectedVideoScriptRequestIds.delete(requestId);
  updateVideoScriptSelection();
}

async function generateSelectedVideoScript() {
  if (selectedVideoScriptRequestIds.size === 0) return;
  elements.generateVideoScript.disabled = true;
  elements.generateVideoScript.textContent = "Creating video…";
  try {
    await api("/api/video-productions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceRequestIds: [...selectedVideoScriptRequestIds],
        runLimits: pendingRunLimits,
      }),
    });
    pendingRunLimits = null;
    updateRunLimitsSummary();
    cancelVideoScriptSelection();
    await loadRequests({ force: true });
  } catch (error) {
    elements.status.textContent = error.message || "Could not queue the video production.";
  } finally {
    updateVideoScriptSelection();
  }
}

async function downloadInteractionVideo(fileId, button, preferredFilename = null) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Downloading…";
  try {
    const response = await fetch(`/api/videos/${fileId}/download`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (response.status === 401) {
      elements.tokenDialog.showModal();
      throw new Error("Access token required");
    }
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try { message = (await response.json()).error || message; } catch { /* The status is enough. */ }
      throw new Error(message);
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const matched = /filename="([^"]+)"/i.exec(disposition);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = preferredFilename || matched?.[1] || `slayer-video-${fileId}.mp4`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
  } catch (error) {
    button.textContent = error.message || "Download failed";
    await new Promise((resolve) => setTimeout(resolve, 2200));
  } finally {
    button.textContent = original;
    button.disabled = false;
  }
}

async function saveAsStructuredInteraction(requestId, button) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Creating exchange…";
  try {
    const created = await api(`/api/requests/${encodeURIComponent(requestId)}/structured-interaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runLimits: pendingRunLimits }),
    });
    pendingRunLimits = null;
    updateRunLimitsSummary();
    elements.status.textContent = `Exchange creation request ${created.requestId.slice(0, 8)} queued from exchange ${requestId.slice(0, 8)}.`;
    await loadRequests({ force: true, followLatest: true });
  } catch (error) {
    elements.status.textContent = error.message || "Could not create the exchange.";
    button.textContent = original;
    button.disabled = false;
  }
}

function requestNode(request, index, structuredGenerationStatus = null) {
  let node = requestNodes.get(request.requestId);
  if (!node) {
    node = elements.template.content.firstElementChild.cloneNode(true);
    node.dataset.requestId = request.requestId;
    node.querySelector(".request-number").addEventListener("click", (event) => {
      copyText(request.requestId, event.currentTarget);
    });
    node.querySelector(".copy-response").addEventListener("click", (event) => {
      copyText(node.querySelector(".agent-response-markdown").dataset.markdown || "", event.currentTarget);
    });
    node.querySelector(".show-trace").addEventListener("click", () => showTrace(request.requestId));
    node.querySelector(".reply-to-exchange").addEventListener("click", () => replyToExchange(request.requestId, request.request));
    node.querySelector(".save-structured-interaction").addEventListener("click", (event) => {
      const guideId = Number(event.currentTarget.dataset.guideId);
      if (Number.isSafeInteger(guideId) && guideId > 0) {
        switchView("interactions");
        void refreshInteractionGuides({ selectId: guideId });
        return;
      }
      void saveAsStructuredInteraction(request.requestId, event.currentTarget);
    });
    node.querySelector(".video-script-source-checkbox").addEventListener("change", (event) => {
      toggleVideoScriptSource(request.requestId, event.currentTarget.checked, event.currentTarget);
    });
    node.querySelector(".download-video").addEventListener("click", (event) => {
      const fileId = Number(event.currentTarget.dataset.fileId);
      if (Number.isSafeInteger(fileId) && fileId > 0) void downloadInteractionVideo(fileId, event.currentTarget);
    });
    node.querySelector(".request-file-reference").addEventListener("click", (event) => {
      const fileId = Number(event.currentTarget.dataset.fileId);
      if (fileId) copyText(`file ${fileId}`, event.currentTarget);
    });
    node.querySelector(".edit-request-file").addEventListener("click", (event) => {
      const fileId = Number(event.currentTarget.dataset.fileId);
      if (fileId) void openFileEditor(fileId);
    });
    requestNodes.set(request.requestId, node);
  }
  node.dataset.status = request.status;
  node.dataset.scriptSelectable = String(Boolean(request.scriptSelectable));
  node.querySelector(".conversation-separator").hidden = !request.conversationStarted;
  const requestNumber = node.querySelector(".request-number");
  requestNumber.textContent = `Request ${request.requestId.slice(0, 8)}`;
  requestNumber.title = `Copy request ID ${request.requestId}`;
  requestNumber.setAttribute("aria-label", `Copy request ID ${request.requestId}`);
  node.querySelector(".request-channel").textContent = request.channel === "voice" ? "Voice" : "Typed";
  node.querySelector(".request-status").textContent = request.status;
  const replyButton = node.querySelector(".reply-to-exchange");
  replyButton.hidden = !["complete", "error"].includes(request.status);
  replyButton.title = `Reference exchange ${request.requestId} in Agent`;
  replyButton.setAttribute("aria-label", replyButton.title);
  const time = node.querySelector("time");
  time.dateTime = new Date(request.submittedAtMs).toISOString();
  time.textContent = formatTime(request.submittedAtMs);
  const elapsed = node.querySelector(".request-elapsed");
  elapsed.textContent = Number.isFinite(request.elapsedMs) ? `${formatDuration(request.elapsedMs)} elapsed` : "";
  elapsed.hidden = !elapsed.textContent;
  node.querySelector(".user-request").textContent = request.request;
  const attachment = node.querySelector(".request-attachment");
  const file = request.attachment;
  attachment.hidden = !file;
  if (file) {
    const reference = attachment.querySelector(".request-file-reference");
    reference.dataset.fileId = String(file.fileId);
    reference.textContent = `File #${file.fileId} · ${file.title}`;
    reference.title = `Copy reference: file ${file.fileId}`;
    const original = attachment.querySelector(".request-file-original");
    original.textContent = file.originalFilename ? `Original filename: ${file.originalFilename}` : "";
    original.hidden = !original.textContent;
    const description = attachment.querySelector(".request-file-description");
    description.textContent = file.description || "";
    description.hidden = !description.textContent;
    attachment.querySelector(".edit-request-file").dataset.fileId = String(file.fileId);
  }
  const response = node.querySelector(".agent-response");
  renderAgentMascot(node.querySelector(".agent-response-avatar"), request.explicitHats);
  response.hidden = !request.response;
  const responseMarkdown = response.querySelector(".agent-response-markdown");
  if (request.response && responseMarkdown.dataset.markdown !== request.response) {
    responseMarkdown.dataset.markdown = request.response;
    renderMarkdown(responseMarkdown, request.response);
  }
  const error = node.querySelector(".request-error");
  error.hidden = !request.error;
  error.textContent = request.error || "";
  renderRequestSteps(node.querySelector(".request-steps"), request.steps);
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
  const downloadVideo = node.querySelector(".download-video");
  const video = request.video;
  downloadVideo.hidden = video?.status !== "complete" || !video.fileId;
  if (video?.fileId) downloadVideo.dataset.fileId = String(video.fileId);
  else delete downloadVideo.dataset.fileId;
  const choice = node.querySelector(".video-script-source-choice");
  choice.hidden = !selectingVideoScriptSources || !request.scriptSelectable;
  const sourceCheckbox = node.querySelector(".video-script-source-checkbox");
  sourceCheckbox.checked = selectedVideoScriptRequestIds.has(request.requestId);
  node.querySelector(".request-card").classList.toggle(
    "video-script-selected",
    selectedVideoScriptRequestIds.has(request.requestId),
  );
  const structuredButton = node.querySelector(".save-structured-interaction");
  structuredButton.hidden = !request.structuredInteractionSelectable;
  const generationStatus = structuredGenerationStatus?.status ?? null;
  structuredButton.disabled = generationStatus === "queued" || generationStatus === "processing";
  structuredButton.textContent = generationStatus === "complete"
    ? "Open exchange"
    : generationStatus === "queued" || generationStatus === "processing"
      ? "Creating exchange…"
      : generationStatus === "error"
        ? "Retry exchange creation"
        : "Make this exchange repeatable";
  if (structuredGenerationStatus?.guideId) {
    structuredButton.dataset.guideId = String(structuredGenerationStatus.guideId);
  } else {
    delete structuredButton.dataset.guideId;
  }
  node.style.order = index;
  return node;
}

function updateScrollLatestButton() {
  const distanceFromBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
  elements.scrollLatest.hidden = activeView !== "agent"
    || !elements.list.lastElementChild
    || distanceFromBottom <= 4;
}

function scheduleScrollLatestButtonUpdate() {
  if (scrollLatestUpdateFrame !== null) return;
  scrollLatestUpdateFrame = requestAnimationFrame(() => {
    scrollLatestUpdateFrame = null;
    updateScrollLatestButton();
  });
}

function finishScrollChatToBottom() {
  window.scrollTo(0, document.documentElement.scrollHeight);
  requestAnimationFrame(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    updateScrollLatestButton();
  });
}

function scrollChatToLatestQuickly() {
  if (scrollLatestAnimationFrame !== null) cancelAnimationFrame(scrollLatestAnimationFrame);
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    finishScrollChatToBottom();
    return;
  }
  const startY = window.scrollY;
  const durationMs = 360;
  let startTime = null;
  const animate = (timestamp) => {
    if (activeView !== "agent") {
      scrollLatestAnimationFrame = null;
      return;
    }
    if (startTime === null) startTime = timestamp;
    const progress = Math.min(1, (timestamp - startTime) / durationMs);
    const easedProgress = 1 - ((1 - progress) ** 3);
    const bottomY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    window.scrollTo(0, startY + ((bottomY - startY) * easedProgress));
    if (progress < 1) {
      scrollLatestAnimationFrame = requestAnimationFrame(animate);
      return;
    }
    scrollLatestAnimationFrame = null;
    finishScrollChatToBottom();
  };
  scrollLatestAnimationFrame = requestAnimationFrame(animate);
}

function scrollChatToLatest({ behavior = "auto" } = {}) {
  if (behavior === "smooth") {
    scrollChatToLatestQuickly();
    return;
  }
  requestAnimationFrame(() => {
    if (activeView !== "agent") return;
    const latestRequest = elements.list.lastElementChild;
    if (!latestRequest) return;
    latestRequest.scrollIntoView({ block: "end", behavior });
    requestAnimationFrame(() => {
      if (activeView === "agent" && latestRequest.isConnected) {
        latestRequest.scrollIntoView({ block: "end", behavior: "auto" });
        finishScrollChatToBottom();
      }
    });
  });
}

async function loadRequests({ force = false, followLatest = false } = {}) {
  if (!force && selectionTouchesRequests()) return;
  const initialLoad = requestNodes.size === 0;
  const previousListHeight = elements.list.offsetHeight;
  const previousPageHeight = document.documentElement.scrollHeight;
  const wasFollowingLatest = followLatest
    || initialLoad
    || window.scrollY + window.innerHeight >= previousPageHeight - 160;
  const limit = Number(elements.requestLimit.value) || 25;
  const body = await api(`/api/requests?limit=${limit}`);
  const seen = new Set();
  const chronologicalRequests = [...body.requests].reverse();
  const structuredGenerationStatuses = new Map(
    [...body.requests].reverse()
      .filter(({ requestKind, sourceRequestId }) => (
        requestKind === "structured_interaction_generation" && sourceRequestId
      ))
      .map(({
        sourceRequestId, structuredInteractionGenerationStatus, structuredInteractionGuideId,
      }) => (
        [sourceRequestId, {
          status: structuredInteractionGenerationStatus,
          guideId: structuredInteractionGuideId ?? null,
        }]
      )),
  );
  chronologicalRequests.forEach((request, index) => {
    seen.add(request.requestId);
    const node = requestNode(request, index, structuredGenerationStatuses.get(request.requestId) ?? null);
    if (!node.isConnected) elements.list.append(node);
  });
  for (const [id, node] of requestNodes) {
    if (!seen.has(id)) {
      node.remove();
      requestNodes.delete(id);
      selectedVideoScriptRequestIds.delete(id);
    }
  }
  updateVideoScriptSelection();
  elements.empty.hidden = body.requests.length > 0;
  renderAgentMascot(elements.agentMascot, body.requests[0]?.explicitHats);
  speakCompletedResponses(body.requests);
  const transcriptChangedHeight = elements.list.offsetHeight !== previousListHeight;
  if (activeView === "agent" && chronologicalRequests.length > 0
      && wasFollowingLatest && (followLatest || initialLoad || transcriptChangedHeight)) {
    scrollChatToLatest();
  }
  scheduleScrollLatestButtonUpdate();
}

function traceLabel(event, index) {
  const labels = {
    "request.received": "USER REQUEST",
    "agent.step": "AGENT STEP",
    "turn.brief": "ACCEPTED TURNBRIEF",
    "conversation.state": "ROLLING CONVERSATION STATE",
    "context.sent": "CONTEXT SENT",
    "tools.sent": "TOOLS AVAILABLE",
    "model.request": "MODEL REQUEST",
    "model.response": "MODEL RESPONSE",
    "model.usage": "MODEL USAGE",
    "tool.call": "TOOL CALL",
    "tool.result": "TOOL RESULT",
    "assistant.response": "FINAL RESPONSE",
  };
  const workflowStep = event.payload?.workflowStepLabel || event.payload?.workflowStep;
  const tokens = Number(event.payload?.tokenUsage?.totalTokens);
  const details = [event.status || event.phase];
  if (workflowStep) details.push(workflowStep);
  if (Number.isFinite(tokens)) details.push(`${tokens.toLocaleString()} tokens`);
  return `${index + 1}. ${labels[event.type] || event.type.toUpperCase()} · ${details.join(" · ")}`;
}

async function showTrace(requestId) {
  const body = await api(`/api/requests/${requestId}/trace`);
  activeTrace = body;
  elements.traceHeading.textContent = `Trace ${requestId.slice(0, 8)}`;
  elements.traceEvents.replaceChildren();
  body.events.forEach((event, index) => {
    const details = document.createElement("details");
    details.className = "trace-event";
    if (["request.received", "agent.step", "turn.brief", "conversation.state", "context.sent", "tools.sent", "model.request", "tool.call", "tool.result", "assistant.response", "request.error"].includes(event.type)) details.open = true;
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
  elements.runtime.textContent = `Git commit: ${commit}${body.runtime?.dirty ? "-dirty" : ""}`;
  elements.runtime.classList.toggle("ready", Boolean(body.ready));
  elements.runtime.classList.toggle("not-ready", !body.ready);
  elements.runtime.title = `${body.ready ? "Ready" : "Not ready"}. Click to copy full health diagnostics.`;
  elements.usage.textContent = healthUsageLabel(body.model);
  const usageAvailable = Boolean(body.model?.usage || (body.model?.ready && body.model?.usageMode === "metered"));
  elements.usage.classList.toggle("ready", usageAvailable);
  elements.usage.classList.toggle("not-ready", !usageAvailable);
  renderIntegrations(body.integrations ?? {});
  updateEventInviteDraftAvailability();
}

function renderIntegrations(integrations) {
  const entries = Object.entries(integrations)
    .filter(([name]) => !name.endsWith("configuration"));
  const connected = entries.filter(([, integration]) => integration.ready).length;
  elements.integrationsButton.textContent = connected ? `Integrations · ${connected}` : "Integrations";
  elements.integrationsButton.classList.toggle("ready", connected > 0);
  elements.integrationList.replaceChildren();
  if (entries.length === 0) {
    elements.integrationList.append(node("p", "empty", "No integrations are connected yet."));
    return;
  }
  for (const [name, integration] of entries) {
    const card = node("article", "integration-card");
    const identity = node("div", "integration-identity");
    const status = integration.disabled
      ? "Disabled"
      : integration.ready
        ? `Connected${integration.toolCount == null ? "" : ` · ${integration.toolCount} tools`}`
        : integration.error
          ? "Connection failed"
          : "Disconnected";
    identity.append(
      node("strong", "", name),
      node("span", "", status),
    );
    if (integration.error || integration.refreshError) identity.title = integration.refreshError || integration.error;
    card.classList.toggle("ready", Boolean(integration.ready));
    card.append(identity);
    if (integration.userManaged) {
      const action = node("button", "secondary compact remove-integration", "Remove");
      action.type = "button";
      action.dataset.name = name;
      card.append(action);
    } else if (integration.oauth && !integration.disabled) {
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

function addCalendarMonths(value, months) {
  const date = new Date(value);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return date;
}

function startOfDay(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(value) {
  const date = startOfDay(value);
  return addDays(date, -((date.getDay() + 6) % 7));
}

function twoWeekCalendarRange(value) {
  const gridStart = startOfWeek(value);
  const gridEnd = addDays(gridStart, 14);
  return { gridStart, gridEnd };
}

function occursOnDay(calendarEvent, day) {
  return occursDuringCalendarDay(calendarEvent.startsAtUtc, calendarEvent.endsAtUtc, day);
}

function isRoutineTemplate(todo) {
  return todo?.groupName?.toLowerCase() === "routine";
}

function todosDueOnDay(day) {
  const key = localDateKey(day);
  return activeTodos.filter((todo) => !isRoutineTemplate(todo)
    && todo.dueAtUtc && localDateKey(todo.dueAtUtc) === key);
}

function todosScheduledOnDay(day) {
  const key = localDateKey(day);
  return activeTodos.filter((todo) => !isRoutineTemplate(todo)
    && todo.scheduledAtUtc && localDateKey(todo.scheduledAtUtc) === key);
}

function formatEventTime(calendarEvent) {
  if (calendarEvent.isAllDay) return "";
  const timeZone = calendarEvent.timeZone || null;
  const start = formatDisplayTime(calendarEvent.startsAtUtc, { timeZone });
  return calendarEvent.endsAtUtc
    ? `${start}–${formatDisplayTime(calendarEvent.endsAtUtc, { timeZone })}`
    : start;
}

function calendarEventWhen(calendarEvent) {
  const timeZone = calendarEvent.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const start = new Date(calendarEvent.startsAtUtc);
  const end = calendarEvent.endsAtUtc ? new Date(calendarEvent.endsAtUtc) : null;
  const date = (value) => formatDisplayDate(value, { includeTime: false, timeZone });
  const dateTime = (value) => formatDisplayDate(value, { timeZone });
  const time = (value) => formatDisplayTime(value, { timeZone });
  if (calendarEvent.isAllDay) {
    const startDate = date(start);
    const inclusiveEnd = end && end > start ? new Date(end.getTime() - 1) : null;
    const endDate = inclusiveEnd ? date(inclusiveEnd) : null;
    return endDate && endDate !== startDate ? `${startDate}–${endDate} · All day` : `${startDate} · All day`;
  }
  if (!end) return dateTime(start);
  return date(start) === date(end)
    ? `${dateTime(start)}–${time(end)}`
    : `${dateTime(start)}–${dateTime(end)}`;
}

function calendarEventCopyText(calendarEvent) {
  const when = calendarEventWhen(calendarEvent);
  const lines = [calendarEvent.title, `When: ${when}`];
  if (calendarEvent.recurrenceRule) lines.push(`Repeats: ${describeTodoRecurrence(calendarEvent.recurrenceRule)}`);
  if (calendarEvent.location) lines.push(`Where: ${calendarEvent.location}`);
  if (calendarEvent.description) lines.push("", calendarEvent.description);
  if (calendarEvent.planningPromptText) lines.push("", `Planning prompt: ${calendarEvent.planningPromptText}`);
  return lines.join("\n");
}

function calendarEventIdentity(calendarEvent) {
  const eventId = calendarEvent.seriesId ?? calendarEvent.id;
  const numericEventId = Number(eventId);
  const codes = Number.isSafeInteger(numericEventId) && numericEventId > 0
    ? { calendar_event_id: numericEventId }
    : { calendar_occurrence_id: eventId };
  if (calendarEvent.isGeneratedOccurrence) codes.occurrence_starts_at_utc = calendarEvent.startsAtUtc;
  if (calendarEvent.contactId != null) codes.contact_id = calendarEvent.contactId;
  return [
    `Calendar event: ${conciseReferenceText(calendarEvent.title)}`,
    `When: ${calendarEventWhen(calendarEvent)}`,
    calendarEvent.location ? `Where: ${conciseReferenceText(calendarEvent.location, 120)}` : null,
    referenceCode(codes),
  ].filter(Boolean).join("\n");
}

function switchView(view) {
  const previousView = activeView;
  if (view !== "calendar" && calendarSchedulingTodo) cancelCalendarScheduling({ render: false });
  activeView = view;
  elements.agentView.hidden = view !== "agent";
  elements.hatsView.hidden = view !== "hats";
  elements.calendarView.hidden = view !== "calendar";
  elements.routineView.hidden = view !== "routine";
  elements.todosView.hidden = view !== "todos";
  elements.contentView.hidden = view !== "content";
  elements.videoScriptsView.hidden = view !== "video-scripts";
  elements.filesView.hidden = view !== "files";
  elements.contactsView.hidden = view !== "contacts";
  elements.logsView.hidden = view !== "logs";
  elements.interactionsView.hidden = view !== "interactions";
  elements.aiUsageView.hidden = view !== "ai-usage";
  for (const button of elements.navButtons) {
    const selected = button.dataset.view === view;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  if (view === "hats") {
    void refreshHats();
  }
  if (view === "calendar") void refreshCalendar();
  if (view === "routine") void refreshRoutine();
  if (view === "todos") void refreshTodos();
  if (view === "content") void refreshContent();
  if (view === "video-scripts") void refreshVideoScripts();
  if (view === "files") void loadFiles();
  if (view === "contacts") void refreshContacts();
  if (view === "logs") void refreshLogs();
  if (view === "interactions") void refreshInteractionGuides();
  if (view === "ai-usage") void loadAiUsage();
  if (view === "agent" && previousView !== "agent") scrollChatToLatest();
  scheduleScrollLatestButtonUpdate();
}

function renderHats(body) {
  elements.hatsTitle.textContent = body.manual.title;
  elements.hatInvocationTemplate.textContent = body.invocationTemplate;
  elements.hatIntroduction.textContent = body.manual.introduction;
  elements.hatDestinationRule.textContent = body.manual.destinationRule;
  elements.hatMultipleRule.textContent = body.manual.multipleRule;
  elements.hatList.replaceChildren();
  for (const hat of body.hats) {
    const card = node("article", "hat-card");
    card.classList.toggle("available", hat.available);
    const heading = node("div", "hat-card-heading");
    const title = node("div", "hat-card-title");
    const mascot = node("span", "agent-mascot hat-card-mascot");
    renderAgentMascot(mascot, [hat]);
    const identity = node("div", "hat-identity");
    identity.append(
      node("p", "eyebrow", "As my"),
      node("h2", "", hat.label),
    );
    title.append(mascot, identity);
    heading.append(title, node("span", `hat-availability ${hat.available ? "available" : "unavailable"}`, hat.available ? "Available" : "Not connected"));
    card.append(heading, node("p", "hat-description", hat.description));
    const example = node("blockquote", "hat-example", hat.example);
    card.append(example);
    const actions = node("div", "hat-actions");
    const tryExample = node("button", "secondary compact", "Use this example");
    tryExample.type = "button";
    tryExample.addEventListener("click", () => {
      elements.text.value = hat.example;
      switchView("agent");
      elements.text.focus();
    });
    actions.append(tryExample);
    const details = node("details", "hat-tools");
    const summary = node("summary", "", hat.toolCount === 1 ? "1 backing tool" : `${hat.toolCount} backing tools`);
    details.append(summary);
    if (hat.tools.length === 0) {
      details.append(node("p", "muted", "No callable tools currently back this hat."));
    } else {
      const list = node("ul", "hat-tool-list");
      for (const tool of hat.tools) {
        const item = node("li");
        item.append(node("code", "", tool.name));
        if (tool.description) item.append(node("span", "", tool.description));
        list.append(item);
      }
      details.append(list);
    }
    card.append(actions, details);
    elements.hatList.append(card);
  }
}

async function refreshHats() {
  elements.hatStatus.textContent = "Loading hats…";
  try {
    renderHats(await api("/api/hats"));
    elements.hatStatus.textContent = "";
  } catch (error) {
    elements.hatList.replaceChildren();
    elements.hatStatus.textContent = error.message || "Hats are unavailable.";
  }
}

async function refreshCalendar() {
  const { gridStart, gridEnd } = twoWeekCalendarRange(calendarRangeStart);
  try {
    const [calendarBody, todoBody, groupBody, guideBody] = await Promise.all([
      api(`/api/calendar-events?from=${encodeURIComponent(gridStart.toISOString())}&to=${encodeURIComponent(gridEnd.toISOString())}`),
      api("/api/todos?scope=active&limit=1000"),
      api("/api/todo-groups"),
      api("/api/interaction-guides?status=active&limit=500"),
    ]);
    calendarEvents = calendarBody.events;
    activeTodos = todoBody.todos;
    todoGroups = groupBody.groups;
    todoGuides = guideBody.guides;
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

function routineCalendarDates() {
  return sixWeekMonthDates(new Date());
}

async function refreshRoutine() {
  const dates = routineCalendarDates();
  const from = startOfDay(dates[0]);
  const to = addDays(startOfDay(dates.at(-1)), 1);
  try {
    const [previewBody, todoBody, groupBody, contactBody, guideBody] = await Promise.all([
      api(`/api/routines/preview?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
      api("/api/todos?scope=active&limit=1000"),
      api("/api/todo-groups"),
      api("/api/contacts?scope=all&limit=10000"),
      api("/api/interaction-guides?status=active&limit=500"),
    ]);
    routineOccurrences = previewBody.occurrences;
    routineTemplates = todoBody.todos.filter(isRoutineTemplate);
    todoGroups = groupBody.groups;
    todoContacts = contactBody.contacts;
    todoGuides = guideBody.guides;
    renderRoutine();
  } catch (error) {
    elements.routineGrid.replaceChildren(node("p", "empty", error.message || "Routine unavailable."));
  }
}

function routineOccurrencesOnDay(date) {
  return routineOccurrences.filter((occurrence) => occursDuringCalendarDay(
    occurrence.scheduledAtUtc,
    plannedEnd(occurrence.scheduledAtUtc, occurrence.durationMinutes),
    date,
  ));
}

function plannedEnd(startsAtUtc, duration) {
  if (!startsAtUtc || !Number.isSafeInteger(duration) || duration <= 0) return null;
  return new Date(new Date(startsAtUtc).getTime() + duration * 60_000).toISOString();
}

function plannedTimeLabel(item, date) {
  if (item.isAllDay) return "All day";
  const end = plannedEnd(item.scheduledAtUtc, item.durationMinutes);
  return calendarDayTimeRangeLabel(
    item.scheduledAtUtc,
    end,
    date,
    (value) => formatDisplayTime(value),
  );
}

function renderRoutineAgenda() {
  const occurrences = routineOccurrencesOnDay(selectedRoutineDate);
  elements.routineAgendaDate.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long", day: "numeric",
  }).format(selectedRoutineDate);
  elements.routineAgendaCount.textContent = `${occurrences.length} ${occurrences.length === 1 ? "item" : "items"}`;
  elements.routineAgendaList.replaceChildren();
  if (occurrences.length === 0) {
    elements.routineAgendaList.append(node("p", "agenda-empty", "No routine items on this representative day."));
    return;
  }
  for (const occurrence of occurrences) {
    const template = routineTemplates.find(({ id }) => id === occurrence.templateTodoId);
    const item = node("div", "agenda-event");
    const button = node("button", "agenda-item todo");
    button.type = "button";
    button.append(
      node("strong", "", occurrence.text),
      node("span", "", `${plannedTimeLabel(occurrence, selectedRoutineDate)} · ${describeTodoRecurrence(occurrence.recurrenceRule)}`),
    );
    button.disabled = !template;
    if (template) button.addEventListener("click", () => openTodoEditor(template));
    item.append(button);
    if (template) {
      const actions = node("div", "agenda-event-actions");
      actions.append(agentReferenceButton(todoIdentity(template), `task ${template.text}`));
      item.append(actions);
    }
    elements.routineAgendaList.append(item);
  }
}

function renderRoutine() {
  const dates = routineCalendarDates();
  const currentMonth = new Date().getMonth();
  renderCalendarGrid({
    container: elements.routineGrid,
    dates,
    selectedKey: localDateKey(selectedRoutineDate),
    todayKey: localDateKey(new Date()),
    keyForDate: localDateKey,
    labelForDate: (date) => formatDisplayDate(date, { includeTime: false }),
    representativeMonth: currentMonth,
    itemsForDate: (date) => routineOccurrencesOnDay(date).map((occurrence) => ({
      className: "day-todo",
      text: `${plannedTimeLabel(occurrence, date)} ${occurrence.text}`,
    })),
    onSelect: (date) => {
      selectedRoutineDate = date;
      renderRoutine();
    },
  });
  renderRoutineAgenda();
}

async function openNewRoutine() {
  try {
    const { group } = await api("/api/routines/ensure-group", { method: "POST" });
    if (!todoGroups.some(({ id }) => id === group.id)) todoGroups.push(group);
    openTodoEditor(null, group.id);
    elements.todoDialogTitle.textContent = "New routine";
    todoTimingEditor.load({
      start: new Date(
        selectedRoutineDate.getFullYear(),
        selectedRoutineDate.getMonth(),
        selectedRoutineDate.getDate(),
      ),
      isAllDay: true,
    });
    elements.todoRepeatEnabled.checked = true;
    elements.todoRepeatFrequency.value = "WEEKLY";
    const weekday = repeatAnchorWeekday(todoTimingEditor.values().start);
    for (const checkbox of elements.todoRepeatWeekdays.querySelectorAll('input[type="checkbox"]')) {
      checkbox.checked = checkbox.value === weekday;
    }
    todoRecurrenceDirty = true;
    updateTodoRecurrenceEditor();
    updateTodoClearScheduledVisibility();
  } catch (error) {
    elements.routinePublishStatus.textContent = error.message || "Could not create a routine.";
  }
}

async function publishRoutineRange(from, to) {
  elements.routinePublishStatus.textContent = "Publishing…";
  elements.publishRoutineThisWeek.disabled = true;
  elements.publishRoutineNextWeek.disabled = true;
  try {
    const result = await api("/api/routines/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: from.toISOString(), to: to.toISOString() }),
    });
    const existing = result.existingCount
      ? ` ${result.existingCount} ${result.existingCount === 1 ? "item was" : "items were"} already published.`
      : "";
    elements.routinePublishStatus.textContent = `Created ${result.createdCount} scheduled ${result.createdCount === 1 ? "to-do" : "to-dos"}.${existing}`;
  } catch (error) {
    elements.routinePublishStatus.textContent = error.message || "Could not publish the routine.";
  } finally {
    elements.publishRoutineThisWeek.disabled = false;
    elements.publishRoutineNextWeek.disabled = false;
  }
}

function setCalendarSearchMode(enabled) {
  elements.calendarSearchResults.hidden = !enabled;
  elements.calendarLayout.hidden = enabled;
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
    const actions = node("div", "calendar-search-result-actions");
    actions.append(
      agentReferenceButton(calendarEventIdentity(calendarEvent), `calendar event ${calendarEvent.title}`),
      copy,
    );
    item.append(open, actions);
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
  const { gridStart, gridEnd } = twoWeekCalendarRange(calendarRangeStart);
  const displayedDate = new Date(selectedCalendarDate);
  elements.calendarWeekday.textContent = `${new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(displayedDate)},`;
  elements.calendarMonth.textContent = new Intl.DateTimeFormat(undefined, { month: "long" }).format(displayedDate);
  elements.calendarDay.textContent = String(displayedDate.getDate());
  elements.calendarYear.textContent = String(displayedDate.getFullYear());
  elements.calendarDateControl.setAttribute("aria-label", formatDisplayDate(displayedDate, { includeTime: false }));
  elements.calendarGrid.setAttribute("aria-label", `Calendar from ${formatDisplayDate(gridStart, { includeTime: false })} through ${formatDisplayDate(addDays(gridEnd, -1), { includeTime: false })}`);
  elements.calendarTimeZone.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const todayKey = localDateKey(new Date());
  const selectedKey = localDateKey(selectedCalendarDate);
  renderCalendarGrid({
    container: elements.calendarGrid,
    dates: dateSequence(gridStart, gridEnd),
    selectedKey,
    todayKey,
    keyForDate: localDateKey,
    labelForDate: (date) => formatDisplayDate(date, { includeTime: false }),
    showMonthMarkers: true,
    disabled: calendarSchedulingBusy,
    itemsForDate: (date) => {
      const events = calendarEvents.filter((calendarEvent) => occursOnDay(calendarEvent, date));
      const scheduled = todosScheduledOnDay(date);
      const due = todosDueOnDay(date);
      return [
        ...events.map(calendarEventCellItem),
        ...scheduled.map(scheduledTodoCellItem),
        ...due.map((value) => ({ className: "day-todo", text: `Due ${value.text}` })),
      ];
    },
    onSelect: (date) => {
      if (calendarSchedulingTodo) void scheduleTodoOnDate(date);
      else {
        selectedCalendarDate = date;
        renderCalendar();
      }
    },
  });
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
    calendarRangeStart = startOfWeek(selectedCalendarDate);
  } else {
    selectedCalendarDate = new Date();
    calendarRangeStart = startOfWeek(selectedCalendarDate);
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
  const payload = {
    version: todo.version,
    scheduledAtUtc: scheduled.toISOString(),
    isAllDay: true,
    durationMinutes: null,
  };
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
    switchView("todos");
  } catch (error) {
    calendarSchedulingBusy = false;
    updateCalendarSchedulingMode();
    renderCalendar();
    window.alert(error.message || "Could not schedule the task.");
  }
}

function agendaEventItem(calendarEvent, { allDay = false } = {}) {
    const item = node("div", "agenda-event");
    const button = node("button", "agenda-item");
    button.type = "button";
    const description = String(calendarEvent.description ?? "").trim();
    const details = [allDay ? "All-day event" : null, calendarEvent.location].filter(Boolean).join(" · ");
    button.append(node("strong", "", calendarEvent.title));
    if (description) button.append(node("span", "agenda-item-description", description));
    if (details) button.append(node("span", "agenda-item-details", details));
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
    const actions = node("div", "agenda-event-actions");
    actions.append(
      agentReferenceButton(calendarEventIdentity(calendarEvent), `calendar event ${calendarEvent.title}`),
      copy,
    );
    item.append(button, actions);
    return item;
}

function agendaTodoItem(todo, timing) {
    const item = node("div", "agenda-event");
    const button = node("button", "agenda-item todo");
    button.type = "button";
    button.append(node("strong", "", todo.text), node("span", "", `${timing} · ${todo.status.replaceAll("_", " ")}`));
    button.addEventListener("click", () => openTodoEditor(todo));
    const actions = node("div", "agenda-event-actions");
    actions.append(agentReferenceButton(todoIdentity(todo), `task ${todo.text}`));
    if (todo.interactionGuideId != null && todo.interactionGuideStatus === "active"
        && ["unplanned", "todo", "ai_suggested"].includes(todo.status)) {
      const startGuide = node("button", "secondary compact agenda-event-copy", "Start briefing");
      startGuide.type = "button";
      startGuide.addEventListener("click", () => void startTodoInteractionGuide(todo, startGuide));
      actions.append(startGuide);
    }
    item.append(button, actions);
    return item;
}

function agendaTimelineTime(startsAtUtc, endsAtUtc = null, { timeZone = null, label = null } = {}) {
  const time = node("time", "agenda-timeline-time");
  time.dateTime = startsAtUtc;
  time.append(node("span", "agenda-timeline-start", formatDisplayTime(startsAtUtc, { timeZone })));
  if (endsAtUtc) time.append(node("span", "agenda-timeline-end", `to ${formatDisplayTime(endsAtUtc, { timeZone })}`));
  if (label) time.append(node("span", "agenda-timeline-kind", label));
  return time;
}

function renderAgenda() {
  const events = calendarEvents.filter((calendarEvent) => occursOnDay(calendarEvent, selectedCalendarDate));
  const todoEntries = [
    ...todosScheduledOnDay(selectedCalendarDate).map((todo) => ({
      todo,
      timing: todo.isAllDay ? "All-day task" : "Scheduled task",
      startsAtUtc: todo.scheduledAtUtc,
      endsAtUtc: plannedEnd(todo.scheduledAtUtc, todo.durationMinutes),
      isAllDay: todo.isAllDay,
    })),
    ...todosDueOnDay(selectedCalendarDate).map((todo) => ({
      todo,
      timing: "Task due",
      startsAtUtc: todo.dueAtUtc,
      isAllDay: false,
    })),
  ];
  const allDayEntries = [
    ...events.filter(({ isAllDay }) => isAllDay).map((calendarEvent) => ({ type: "event", calendarEvent })),
    ...todoEntries.filter(({ isAllDay }) => isAllDay).map((entry) => ({ type: "todo", ...entry })),
  ];
  const timedEntries = [
    ...events.filter(({ isAllDay }) => !isAllDay).map((calendarEvent) => ({
      type: "event",
      calendarEvent,
      startsAtUtc: calendarEvent.startsAtUtc,
    })),
    ...todoEntries.filter(({ isAllDay }) => !isAllDay).map((entry) => ({ type: "todo", ...entry })),
  ].sort((left, right) => new Date(left.startsAtUtc).getTime() - new Date(right.startsAtUtc).getTime());

  elements.agendaDate.textContent = formatDisplayDate(selectedCalendarDate, { includeTime: false });
  elements.agendaAllDayCount.textContent = `${allDayEntries.length} ${allDayEntries.length === 1 ? "item" : "items"}`;
  elements.agendaTimelineCount.textContent = `${timedEntries.length} ${timedEntries.length === 1 ? "item" : "items"}`;
  elements.agendaAllDayList.replaceChildren();
  elements.agendaTimeline.replaceChildren();
  elements.agendaTimeline.classList.toggle("empty", timedEntries.length === 0);

  if (allDayEntries.length === 0) {
    elements.agendaAllDayList.append(node("p", "agenda-empty", "No all-day items."));
  } else {
    for (const entry of allDayEntries) {
      elements.agendaAllDayList.append(entry.type === "event"
        ? agendaEventItem(entry.calendarEvent, { allDay: true })
        : agendaTodoItem(entry.todo, entry.timing));
    }
  }

  if (timedEntries.length === 0) {
    elements.agendaTimeline.append(node("p", "agenda-empty agenda-timeline-empty", "No timed items."));
  } else {
    for (const entry of timedEntries) {
      const row = node("div", "agenda-timeline-row");
      if (entry.type === "event") {
        row.append(
          agendaTimelineTime(entry.calendarEvent.startsAtUtc, entry.calendarEvent.endsAtUtc, {
            timeZone: entry.calendarEvent.timeZone || null,
          }),
          node("span", "agenda-timeline-marker"),
          agendaEventItem(entry.calendarEvent),
        );
      } else {
        row.append(
          agendaTimelineTime(entry.startsAtUtc, entry.endsAtUtc, { label: entry.timing }),
          node("span", "agenda-timeline-marker todo"),
          agendaTodoItem(entry.todo, entry.timing),
        );
      }
      elements.agendaTimeline.append(row);
    }
  }
}

function openEventEditor(calendarEvent = null) {
  elements.eventForm.reset();
  elements.eventFormError.textContent = "";
  elements.eventDialogTitle.textContent = calendarEvent ? "Edit event" : "New event";
  elements.eventId.value = calendarEvent?.id ?? "";
  elements.eventVersion.value = calendarEvent?.version ?? "";
  elements.eventTitle.value = calendarEvent?.title ?? "";
  if (calendarEvent) {
    eventTimingEditor.load({
      start: calendarEvent.startsAtUtc,
      end: calendarEvent.endsAtUtc,
      isAllDay: calendarEvent.isAllDay,
    });
    elements.eventLocation.value = calendarEvent.location ?? "";
    elements.eventDescription.value = calendarEvent.description ?? "";
    elements.eventPlanningPrompt.value = calendarEvent.planningPromptText ?? "";
    elements.eventStatus.value = calendarEvent.status;
  } else {
    const start = new Date(selectedCalendarDate.getFullYear(), selectedCalendarDate.getMonth(), selectedCalendarDate.getDate(), 9);
    eventTimingEditor.load({ start, duration: 60, isAllDay: false });
    elements.eventStatus.value = "active";
    elements.eventPlanningPrompt.value = "";
  }
  loadEventRecurrenceEditor(calendarEvent?.recurrenceRule ?? null);
  elements.eventDelete.hidden = !calendarEvent;
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
    const timing = eventTimingEditor.values();
    const payload = {
      title: elements.eventTitle.value,
      description: elements.eventDescription.value,
      planningPromptText: elements.eventPlanningPrompt.value,
      location: elements.eventLocation.value,
      startsAtUtc: inputToIso(timing.start, timing.isAllDay),
      endsAtUtc: inputToIso(timing.end, timing.isAllDay),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      isAllDay: timing.isAllDay,
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

async function deleteEditedEvent() {
  const id = Number(elements.eventId.value);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  const title = elements.eventTitle.value.trim() || "this event";
  const recurrenceNotice = elements.eventRepeatEnabled.checked ? " and all its occurrences" : "";
  if (!window.confirm(`Permanently delete “${title}”${recurrenceNotice}? This cannot be undone.`)) return;
  elements.eventFormError.textContent = "";
  elements.eventDelete.disabled = true;
  try {
    await api(`/api/calendar-events/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: elements.eventVersion.value }),
    });
    elements.eventDialog.close();
    await refreshCalendar();
  } catch (error) {
    elements.eventFormError.textContent = error.message || "Could not delete the event.";
  } finally {
    elements.eventDelete.disabled = false;
  }
}

async function refreshTodos() {
  try {
    const [body, groupBody, contactBody, guideBody] = await Promise.all([
      api(`/api/todos?scope=${encodeURIComponent(elements.todoScope.value)}&limit=1000`),
      api("/api/todo-groups"),
      api("/api/contacts?scope=all&limit=10000"),
      api("/api/interaction-guides?status=active&limit=500"),
    ]);
    displayedTodos = body.todos.filter((todo) => !isRoutineTemplate(todo));
    todoGroups = groupBody.groups;
    todoContacts = contactBody.contacts;
    todoGuides = guideBody.guides;
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
    elements.todoList.replaceChildren(node("p", "empty", error.message || "To do unavailable."));
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
    ["unplanned", "todo", "ai_suggested"].includes(todo.status)
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
    : todoGroups.filter((group) => group.name.toLowerCase() !== "routine"
      || displayedTodos.some(({ groupId }) => groupId === group.id));
  for (const group of visibleGroups) {
    groupedTodos.set(group.id, {
      name: group.name,
      archivedAtUtc: group.archivedAtUtc,
      usesSequence: group.usesSequence,
      todos: [],
    });
  }
  for (const todo of visibleTodos) {
    const group = groupedTodos.get(todo.groupId) ?? {
      name: todo.groupName, archivedAtUtc: todo.groupArchivedAtUtc,
      usesSequence: false, todos: [],
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
    if (group.usesSequence) {
      headingTitle.append(node("span", "todo-group-sequence-marker", "Auto sequence"));
    }
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
    if (!group.archivedAtUtc && !["inbox", "routine"].includes(group.name.toLowerCase())) {
      const rename = node("button", "secondary compact", "Rename");
      const archive = node("button", "secondary compact", "Archive group");
      rename.type = "button";
      archive.type = "button";
      rename.addEventListener("click", () => void renameTodoGroup(groupId, group.name));
      archive.addEventListener("click", () => void archiveTodoGroup(groupId, group.name));
      headingTitle.append(rename, archive);
    }
    if (!group.archivedAtUtc) {
      const sequenceMode = node(
        "button",
        "secondary compact",
        group.usesSequence ? "Stop auto sequence" : "Enable sequence",
      );
      sequenceMode.type = "button";
      sequenceMode.addEventListener("click", () => void changeTodoGroupSequenceMode(
        groupId, group.name, !group.usesSequence,
      ));
      headingTitle.append(sequenceMode);
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
      const controls = node("div", "todo-leading-controls");
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
      controls.append(check);
      if (todo.sequence != null) {
        const sequence = node("span", "todo-sequence-display", `#${todo.sequence}`);
        sequence.title = "Sequence";
        controls.append(sequence);
      }
      const body = node("div", "todo-body");
      const title = node("h3");
      const text = node("button", "todo-text", todo.text);
      text.type = "button";
      text.title = "Copy task text";
      text.setAttribute("aria-label", `Copy task text: ${todo.text}`);
      text.addEventListener("click", (event) => void copyText(todo.text, event.currentTarget));
      title.append(text);
      body.append(title);
      if (todo.planningPromptText) {
        body.append(node("p", "todo-planning-prompt", todo.planningPromptText));
      }
      const metadata = node("div", "todo-meta");
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
      if (todo.durationMinutes) {
        metadata.append(node("span", "todo-pill", `planned ${todo.durationMinutes} min`));
      }
      if (todo.dueAtUtc) {
        const due = new Date(todo.dueAtUtc);
        metadata.append(node("span", `todo-pill ${todo.status !== "complete" && due < new Date() ? "overdue" : ""}`, `due ${formatTodoDateTime(due)}`));
      }
      if (todo.recurrenceRule) metadata.append(node("span", "todo-pill", describeTodoRecurrence(todo.recurrenceRule)));
      if (todo.interactionGuideId != null) {
        metadata.append(node(
          "span",
          "todo-pill",
          `briefing: ${todo.interactionGuideName ?? `#${todo.interactionGuideId}`}`,
        ));
      }
      body.append(metadata);
      const actions = node("div", "todo-actions");
      actions.append(agentReferenceButton(todoIdentity(todo), `task ${todo.text}`));
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
      if (todo.interactionGuideId != null && todo.interactionGuideStatus === "active"
          && ["unplanned", "todo", "ai_suggested"].includes(todo.status)) {
        const startGuide = node("button", "secondary compact", "Start briefing");
        startGuide.type = "button";
        startGuide.addEventListener("click", () => void startTodoInteractionGuide(todo, startGuide));
        actions.append(startGuide);
      }
      if (["unplanned", "todo", "ai_suggested"].includes(todo.status)) actions.append(schedule);
      if (group.usesSequence) {
        const assignSequence = node("button", "secondary compact", "Assign next #");
        assignSequence.type = "button";
        assignSequence.title = "Assign the next available sequence number in this group";
        assignSequence.addEventListener("click", () => void assignNextTodoSequence(todo, assignSequence));
        actions.append(assignSequence);
      }
      actions.append(top, up, down, bottom, edit);
      card.append(controls, body, actions);
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

async function assignNextTodoSequence(todo, button) {
  button.disabled = true;
  try {
    await api(`/api/todos/${todo.id}/assign-next-sequence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: todo.version }),
    });
    await refreshTodos();
  } catch (error) {
    window.alert(error.message || "Could not assign the next sequence number.");
    button.disabled = false;
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
  populateTodoGuideEditor(todo);
  elements.todoText.value = todo?.text ?? "";
  elements.todoPlanningPrompt.value = todo?.planningPromptText ?? "";
  elements.todoSequence.value = todo?.sequence ?? "";
  todoTimingEditor.load({
    start: todo?.scheduledAtUtc ?? null,
    duration: todo?.durationMinutes ?? null,
    isAllDay: Boolean(todo?.isAllDay),
  });
  const due = splitLocalDateTime(todo?.dueAtUtc);
  elements.todoDue.value = due.date;
  elements.todoDueTime.value = due.time;
  elements.todoStatus.value = todo?.status ?? "todo";
  loadTodoRecurrenceEditor(todo?.recurrenceRule ?? null, todo?.recurrenceTimeZone ?? null);
  updateTodoClearScheduledVisibility();
  elements.todoDialog.showModal();
  elements.todoText.focus();
}

function updateTodoClearScheduledVisibility() {
  elements.todoClearScheduled.hidden = !elements.todoId.value
    || !todoTimingEditor.values().start
    || elements.todoRepeatEnabled.checked;
}

function clearTodoScheduledInEditor() {
  todoTimingEditor.clear();
  updateTodoRecurrenceEditor();
  updateTodoClearScheduledVisibility();
  elements.todoStart.focus();
}

function todoDueValue() {
  elements.todoDue.setCustomValidity("");
  elements.todoDueTime.setCustomValidity("");
  if (!elements.todoDue.value && !elements.todoDueTime.value) return null;
  const value = combineLocalDateTime(elements.todoDue.value, elements.todoDueTime.value);
  if (value) return value;
  const message = "Enter both a due date and a 24-hour time (HH:MM).";
  (elements.todoDue.value ? elements.todoDueTime : elements.todoDue).setCustomValidity(message);
  throw new Error(message);
}

function populateTodoGroupEditor(selectedGroupId) {
  elements.todoGroup.replaceChildren();
  for (const group of todoGroups) {
    const option = node("option", "", group.name);
    option.value = String(group.id);
    elements.todoGroup.append(option);
  }
  elements.todoGroup.value = String(selectedGroupId ?? "");
  updateTodoSequenceHint();
}

function updateTodoSequenceHint() {
  const selected = todoGroups.find(({ id }) => String(id) === elements.todoGroup.value);
  elements.todoSequenceHint.textContent = selected?.usesSequence
    ? "Assigned the next unique number when left blank."
    : "Optional for this group.";
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

function populateTodoGuideEditor(todo = null) {
  elements.todoInteractionGuide.replaceChildren(node("option", "", "No briefing"));
  elements.todoInteractionGuide.firstElementChild.value = "";
  for (const guide of todoGuides) {
    const option = node("option", "", guide.name);
    option.value = String(guide.id);
    elements.todoInteractionGuide.append(option);
  }
  if (todo?.interactionGuideId != null
      && !todoGuides.some(({ id }) => id === todo.interactionGuideId)) {
    const option = node(
      "option", "",
      `${todo.interactionGuideName ?? `Briefing #${todo.interactionGuideId}`} (${todo.interactionGuideStatus ?? "unavailable"})`,
    );
    option.value = String(todo.interactionGuideId);
    elements.todoInteractionGuide.append(option);
  }
  elements.todoInteractionGuide.value = todo?.interactionGuideId == null
    ? ""
    : String(todo.interactionGuideId);
}

async function startTodoInteractionGuide(todo, button) {
  button.disabled = true;
  const respondSilently = elements.respondSilently.checked;
  prepareSpeechOutput(respondSilently);
  try {
    const created = await api("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `Start briefing ${todo.interactionGuideId} ("${todo.interactionGuideName}") associated with to-do ${todo.id}. Follow its ordered exchanges and use each opening exactly.`,
      }),
    });
    expectSpokenResponse(created.requestId, respondSilently);
    elements.status.textContent = `${todo.interactionGuideName} queued.`;
    switchView("agent");
    await loadRequests({ force: true, followLatest: true });
  } catch (error) {
    window.alert(error.message || "Could not start the briefing.");
    button.disabled = false;
  }
}

async function saveTodo(event) {
  event.preventDefault();
  elements.todoFormError.textContent = "";
  const submit = elements.todoForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const timing = todoTimingEditor.values();
    const payload = {
      text: elements.todoText.value,
      planningPromptText: elements.todoPlanningPrompt.value,
      groupId: Number(elements.todoGroup.value),
      sequence: elements.todoSequence.value ? Number(elements.todoSequence.value) : null,
      relatedContactId: elements.todoContact.value ? Number(elements.todoContact.value) : null,
      scheduledAtUtc: inputToIso(timing.start, timing.isAllDay),
      isAllDay: timing.isAllDay && Boolean(timing.start),
      durationMinutes: timing.duration,
      dueAtUtc: inputToIso(todoDueValue()),
      status: elements.todoStatus.value,
      interactionGuideId: elements.todoRepeatEnabled.checked && elements.todoInteractionGuide.value
        ? Number(elements.todoInteractionGuide.value)
        : null,
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
    else if (activeView === "routine") await refreshRoutine();
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

async function changeTodoGroupSequenceMode(groupId, groupName, usesSequence) {
  const message = usesSequence
    ? `Enable automatic sequence numbers for ${groupName}? Existing unnumbered tasks will be numbered in their current order.`
    : `Stop assigning automatic sequence numbers in ${groupName}? Existing numbers will be preserved.`;
  if (!window.confirm(message)) return;
  try {
    const result = await api(`/api/todo-groups/${groupId}/sequence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usesSequence }),
    });
    const assigned = result.assignedTaskCount
      ? ` Numbered ${result.assignedTaskCount} existing ${result.assignedTaskCount === 1 ? "task" : "tasks"}.`
      : "";
    elements.status.textContent = usesSequence
      ? `${groupName} now assigns sequence numbers automatically.${assigned}`
      : `${groupName} no longer assigns sequence numbers automatically. Existing numbers were preserved.`;
    await refreshTodos();
  } catch (error) {
    window.alert(error.message || "Could not change the group's sequence setting.");
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
    const editGroup = node("button", "secondary compact", "Edit group");
    editGroup.type = "button";
    editGroup.addEventListener("click", () => openContentGroupEditor(group.id));
    title.append(editGroup);
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
      const card = node(
        "article",
        `content-card organizer-panel${item.sequence == null ? "" : " has-sequence"}`,
      );
      const cardBody = node("div", "content-card-body");
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
      metadata.append(
        node("span", "todo-pill", contentTypeLabel(item.contentType)),
        node("span", "todo-pill", item.contentStatus),
        node("span", "todo-pill", item.contentHost),
        node("span", "todo-pill", formatDisplayDate(item.publishedAtUtc)),
      );
      identity.append(metadata);
      const cardActions = node("div", "content-card-actions");
      const edit = node("button", "secondary compact", "Edit");
      edit.type = "button";
      edit.addEventListener("click", () => openContentEditor(item));
      cardActions.append(edit);
      cardHeading.append(identity, cardActions);
      cardBody.append(cardHeading);
      if (item.description) cardBody.append(node("p", "content-description", item.description));
      if (item.transcript) {
        const details = node("details", "content-transcript");
        details.append(node("summary", "", "Transcript"), node("p", "", item.transcript));
        cardBody.append(details);
      }
      if (item.sequence != null) {
        const sequence = node("span", "content-sequence-display", `#${item.sequence}`);
        sequence.title = "Sequence";
        card.append(sequence);
      }
      card.append(cardBody);
      cards.append(card);
    }
    if (items.length === 0) cards.append(node("p", "empty", "No content in this group for the current filters."));
    section.append(heading, cards);
    elements.contentList.append(section);
  }
}

async function refreshVideoScripts() {
  elements.videoScriptList.replaceChildren(node("p", "empty", "Loading video scripts…"));
  elements.videoScriptEmpty.hidden = true;
  try {
    const body = await api(`/api/video-scripts?status=${encodeURIComponent(elements.videoScriptStatusFilter.value)}&limit=500`);
    videoScripts = body.scripts;
    renderVideoScripts();
  } catch (error) {
    elements.videoScriptList.replaceChildren(node("p", "empty", error.message || "Video scripts unavailable."));
    elements.videoScriptCount.textContent = "";
  }
}

function renderVideoScripts() {
  elements.videoScriptList.replaceChildren();
  elements.videoScriptCount.textContent = `${videoScripts.length} ${videoScripts.length === 1 ? "script" : "scripts"}`;
  elements.videoScriptEmpty.hidden = videoScripts.length > 0;
  for (const script of videoScripts) {
    const card = node("article", "video-script-card organizer-panel");
    const heading = node("div", "video-script-card-heading");
    const identity = node("div", "video-script-card-identity");
    const title = node("h3");
    const titleCopy = node("button", "copy-text-button video-script-title-copy", script.title);
    titleCopy.type = "button";
    titleCopy.title = "Copy video title";
    titleCopy.setAttribute("aria-label", `Copy video title: ${script.title}`);
    titleCopy.addEventListener("click", (event) => void copyText(script.title, event.currentTarget));
    title.append(titleCopy);
    identity.append(title);
    const meta = node("div", "video-script-meta");
    meta.append(
      node("span", "todo-pill", script.status),
      node("span", "todo-pill", `${script.plan.durationSeconds} seconds`),
      node("span", "todo-pill", script.plan.aspectRatio),
      node("span", "todo-pill", formatDisplayDate(script.updatedAtUtc || script.createdAtUtc)),
    );
    if (script.render?.outputFileId) {
      meta.prepend(node("span", "todo-pill", `File #${script.render.outputFileId}`));
    }
    identity.append(meta);
    const sources = node("div", "video-script-sources");
    sources.append(node("span", "", "Sources:"));
    for (const source of script.sources) {
      const sourceButton = node("button", "secondary compact", `Request ${source.requestId.slice(0, 8)}`);
      sourceButton.type = "button";
      sourceButton.title = source.request;
      sourceButton.addEventListener("click", () => {
        if (/^[0-9a-f][0-9a-f-]{7,35}$/i.test(source.requestId)) void showTrace(source.requestId);
        else copyText(source.requestId, sourceButton);
      });
      sources.append(sourceButton);
    }
    identity.append(sources);
    const actions = node("div", "video-script-actions");
    const copy = node("button", "compact", "Copy complete script");
    copy.type = "button";
    copy.addEventListener("click", () => copyText(script.scriptText, copy));
    const copyPrompt = node("button", "secondary compact", "Copy generator prompt");
    copyPrompt.type = "button";
    copyPrompt.addEventListener("click", () => copyText(script.plan.generatorPrompt, copyPrompt));
    actions.append(copy, copyPrompt);
    if (script.render?.status === "complete" && script.render.outputFileId) {
      actions.prepend(agentReferenceButton(videoIdentity(script), `generated video ${script.title}`));
      const download = node("button", "compact", "Download MP4");
      download.type = "button";
      download.addEventListener("click", () => void downloadInteractionVideo(
        script.render.outputFileId,
        download,
        `agent-story-${script.render.outputFileId}.mp4`,
      ));
      actions.prepend(download);
      const addToContent = node(
        "button",
        "secondary compact",
        script.render.contentId ? "Added to content sequence" : "Add this video to content sequence",
      );
      addToContent.type = "button";
      addToContent.disabled = Boolean(script.render.contentId);
      if (!script.render.contentId) {
        addToContent.addEventListener("click", () => void openVideoContentDialog(script));
      }
      actions.append(addToContent);
    } else if (script.render?.status === "error") {
      const retry = node("button", "compact", "Retry MP4");
      retry.type = "button";
      retry.addEventListener("click", () => void retryVideoRender(script, retry));
      actions.prepend(retry);
    }
    if (script.status === "draft") {
      const archive = node("button", "secondary compact", "Archive");
      archive.type = "button";
      archive.addEventListener("click", () => void archiveVideoScript(script, archive));
      actions.append(archive);
    }
    heading.append(identity, actions);
    const document = node("details", "video-script-document");
    const documentBody = node("div", "agent-response-markdown video-script-markdown");
    renderMarkdown(documentBody, script.scriptText);
    document.append(node("summary", "", "Open complete script"), documentBody);
    if (script.render) {
      const production = node("div", `video-production-status video-production-${script.render.status}`);
      const label = {
        queued: "MP4 queued", preparing: "Preparing narration", rendering: "Rendering MP4",
        complete: "MP4 ready", error: "MP4 failed",
      }[script.render.status] || `MP4 ${script.render.status}`;
      production.append(node("strong", "", label));
      if (["queued", "preparing", "rendering"].includes(script.render.status)) {
        production.append(node("span", "", "This production continues in the background. Any AI-generated narration is disclosed."));
      } else if (script.render.status === "complete") {
        production.append(node("span", "", "Any AI-generated narration is disclosed in the MP4. Original saved request audio is used where available."));
      } else if (script.render.error) {
        production.append(node("span", "", script.render.error));
      }
      card.append(heading, production, document);
    } else {
      card.append(heading, document);
    }
    elements.videoScriptList.append(card);
  }
}

async function openVideoContentDialog(script) {
  videoAddingToContent = script;
  elements.videoContentError.textContent = "";
  elements.videoContentTitle.textContent = script.title;
  elements.videoContentGroup.replaceChildren(new Option("Loading groups…", ""));
  elements.videoContentDialog.showModal();
  try {
    const body = await api("/api/content-groups");
    const groups = body.groups ?? [];
    elements.videoContentGroup.replaceChildren();
    for (const group of groups) {
      elements.videoContentGroup.append(new Option(group.name, String(group.id)));
    }
    if (groups.length === 0) throw new Error("Create a content group before adding this video.");
    elements.videoContentGroup.value = String(
      groups.some(({ id }) => String(id) === elements.contentGroupFilter.value)
        ? elements.contentGroupFilter.value
        : groups[0].id,
    );
    elements.videoContentGroup.focus();
  } catch (error) {
    elements.videoContentError.textContent = error.message || "Could not load content groups.";
  }
}

async function addVideoToContentSequence(event) {
  event.preventDefault();
  if (!videoAddingToContent) return;
  const submit = elements.videoContentForm.querySelector('[type="submit"]');
  submit.disabled = true;
  elements.videoContentError.textContent = "";
  try {
    await api(`/api/video-scripts/${videoAddingToContent.id}/content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: Number(elements.videoContentGroup.value) }),
    });
    elements.videoContentDialog.close();
    videoAddingToContent = null;
    await refreshVideoScripts();
  } catch (error) {
    elements.videoContentError.textContent = error.message || "Could not add this video to content.";
  } finally {
    submit.disabled = false;
  }
}

async function retryVideoRender(script, button) {
  button.disabled = true;
  button.textContent = "Queueing…";
  try {
    await api(`/api/video-scripts/${script.id}/render`, { method: "POST" });
    await refreshVideoScripts();
  } catch (error) {
    window.alert(error.message || "Could not retry the MP4 render.");
    button.disabled = false;
    button.textContent = "Retry MP4";
  }
}

async function archiveVideoScript(script, button) {
  if (!window.confirm(`Archive “${script.title}”?`)) return;
  button.disabled = true;
  try {
    await api(`/api/video-scripts/${script.id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: script.version }),
    });
    await refreshVideoScripts();
  } catch (error) {
    window.alert(error.message || "Could not archive the video script.");
    button.disabled = false;
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
  elements.contentDelete.hidden = !item;
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

async function deleteEditedContent() {
  const id = Number(elements.contentId.value);
  if (!Number.isSafeInteger(id) || id <= 0) return;
  const title = elements.contentTitle.value.trim() || "this content";
  if (!window.confirm(`Permanently delete “${title}”? This cannot be undone.`)) return;
  elements.contentFormError.textContent = "";
  elements.contentDelete.disabled = true;
  try {
    await api(`/api/content-items/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: elements.contentVersion.value }),
    });
    elements.contentDialog.close();
    await refreshContent();
  } catch (error) {
    elements.contentFormError.textContent = error.message || "Could not delete the content.";
  } finally {
    elements.contentDelete.disabled = false;
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

function openContentGroupEditor(groupId) {
  const group = contentGroups.find(({ id }) => id === groupId);
  if (!group || group.archivedAtUtc) return;
  const isGeneral = group.id === 1;
  elements.contentGroupForm.reset();
  elements.contentGroupFormError.textContent = "";
  elements.contentGroupDialogTitle.textContent = `Edit ${group.name}`;
  elements.contentGroupId.value = String(group.id);
  elements.contentGroupName.value = group.name;
  elements.contentGroupName.readOnly = isGeneral;
  elements.contentGroupArchive.hidden = isGeneral;
  elements.contentGroupDialog.showModal();
  (isGeneral ? elements.contentGroupDialog.querySelector(".dialog-close") : elements.contentGroupName).focus();
}

async function saveContentGroup(event) {
  event.preventDefault();
  elements.contentGroupFormError.textContent = "";
  const groupId = Number(elements.contentGroupId.value);
  const group = contentGroups.find(({ id }) => id === groupId);
  if (!group) {
    elements.contentGroupFormError.textContent = "This content group is no longer available.";
    return;
  }
  const name = elements.contentGroupName.value.trim();
  if (!name) {
    elements.contentGroupFormError.textContent = "A group name is required.";
    elements.contentGroupName.focus();
    return;
  }
  if (name === group.name) {
    elements.contentGroupDialog.close();
    return;
  }
  const submit = elements.contentGroupForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await api(`/api/content-groups/${groupId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    elements.status.textContent = `${group.name} was renamed to ${name}.`;
    elements.contentGroupDialog.close();
    await refreshContent();
  } catch (error) {
    elements.contentGroupFormError.textContent = error.message || "Could not rename the content group.";
  } finally {
    submit.disabled = false;
  }
}

async function archiveEditedContentGroup() {
  const groupId = Number(elements.contentGroupId.value);
  const group = contentGroups.find(({ id }) => id === groupId);
  if (!group || group.id === 1) return;
  if (!window.confirm(`Archive the empty ${group.name} content group?`)) return;
  elements.contentGroupFormError.textContent = "";
  elements.contentGroupArchive.disabled = true;
  try {
    await api(`/api/content-groups/${groupId}/archive`, { method: "POST" });
    elements.status.textContent = `${group.name} was archived.`;
    elements.contentGroupDialog.close();
    await refreshContent();
  } catch (error) {
    elements.contentGroupFormError.textContent = error.message || "Could not archive the content group.";
  } finally {
    elements.contentGroupArchive.disabled = false;
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

const interactionCompletionLabels = {
  response_valid: "Answers validate",
  user_advances: "User says continue",
  tool_receipt: "Successful tool result",
};

const interactionProgressLabels = {
  pending: "Pending",
  active: "In progress",
  completed: "Completed",
};

function renderInteractionGuideEmpty(title = "Select a briefing", message = "Choose a briefing to review its exchanges, or create a new one.") {
  const empty = node("div", "interaction-detail-empty");
  empty.append(
    node("p", "eyebrow", "Definition"),
    node("h3", "", title),
    node("p", "muted", message),
  );
  elements.interactionGuideDetail.replaceChildren(empty);
}

function renderInteractionGuideList() {
  elements.interactionGuideList.replaceChildren();
  elements.interactionGuideCount.textContent = `${interactionGuideSummaries.length} ${interactionGuideSummaries.length === 1 ? "briefing" : "briefings"}`;
  if (interactionGuideSummaries.length === 0) {
    elements.interactionGuideList.append(node("p", "empty interaction-list-empty", "No briefings in this view."));
    return;
  }
  for (const guide of interactionGuideSummaries) {
    const button = node("button", "interaction-guide-list-item");
    button.type = "button";
    button.classList.toggle("selected", selectedInteractionGuide?.id === guide.id);
    if (selectedInteractionGuide?.id === guide.id) button.setAttribute("aria-current", "true");
    const title = node("strong", "", guide.name);
    const metadata = node("span", "interaction-guide-list-meta");
    metadata.textContent = guide.activeRun?.requiresDailyChoice
      ? `Exchange ${guide.activeRun.currentStepNumber ?? "—"} paused from ${formatLocalDate(guide.activeRun.startedLocalDate)} · choose resume or start over`
      : guide.activeRun
        ? `Exchange ${guide.activeRun.currentStepNumber ?? "—"} in progress · version ${guide.version}`
      : `${guide.status} · version ${guide.version}`;
    button.append(title, metadata);
    button.addEventListener("click", () => void loadInteractionGuide(guide.id));
    elements.interactionGuideList.append(button);
  }
}

function interactionStepIdentity(guide, step) {
  return [
    `Briefing exchange ${step.stepNumber}: ${conciseReferenceText(step.openingText)}`,
    `Briefing: ${conciseReferenceText(guide.name, 120)}`,
    referenceCode({
      interaction_guide_id: guide.id,
      interaction_guide_step_id: step.id,
    }),
  ].join("\n");
}

async function reorderInteractionGuideSteps(guide, orderedStepIds) {
  if (interactionGuideReorderInProgress) return;
  const currentOrder = guide.steps.map(({ id }) => id);
  if (currentOrder.every((stepId, index) => stepId === orderedStepIds[index])) return;
  interactionGuideReorderInProgress = true;
  elements.interactionGuideStatusMessage.textContent = "Saving exchange order…";
  elements.interactionGuideDetail.classList.add("reorder-saving");
  try {
    await api(`/api/interaction-guides/${guide.id}/steps/order`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: guide.version,
        orderedStepIds,
      }),
    });
    await refreshInteractionGuides({ selectId: guide.id });
    elements.interactionGuideStatusMessage.textContent = "Exchange order saved.";
  } catch (error) {
    if (selectedInteractionGuide?.id === guide.id) await loadInteractionGuide(guide.id);
    elements.interactionGuideStatusMessage.textContent = error.message || "Could not save the exchange order.";
  } finally {
    interactionGuideReorderInProgress = false;
    elements.interactionGuideDetail.classList.remove("reorder-saving");
  }
}

function enableInteractionStepDragging({ guide, step, card, handle, list }) {
  let pointerId = null;
  let orderBeforeDrag = [];
  let placeholder = null;
  let pointerOffsetY = 0;
  let styleBeforeDrag = null;

  const movePointerDrag = (event) => {
    if (pointerId === null || event.pointerId !== pointerId || !placeholder) return;
    event.preventDefault();
    card.style.top = `${event.clientY - pointerOffsetY}px`;

    const nextCard = [...list.querySelectorAll(".interaction-turn-card")]
      .find((candidate) => {
        const bounds = candidate.getBoundingClientRect();
        return event.clientY < bounds.top + bounds.height / 2;
      });
    if (nextCard) list.insertBefore(placeholder, nextCard);
    else list.append(placeholder);
  };

  const stopListeningForPointerDrag = () => {
    window.removeEventListener("pointermove", movePointerDrag, true);
    window.removeEventListener("pointerup", finishPointerDrag, true);
    window.removeEventListener("pointercancel", cancelPointerDrag, true);
  };

  function finishPointerDrag(event, { cancelled = false } = {}) {
    if (pointerId === null || event.pointerId !== pointerId) return;
    stopListeningForPointerDrag();
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    pointerId = null;
    placeholder.replaceWith(card);
    placeholder = null;
    if (styleBeforeDrag === null) card.removeAttribute("style");
    else card.setAttribute("style", styleBeforeDrag);
    card.classList.remove("dragging");
    list.classList.remove("reordering");
    if (cancelled) {
      const cardsById = new Map(
        [...list.querySelectorAll(".interaction-turn-card")]
          .map((candidate) => [Number(candidate.dataset.stepId), candidate]),
      );
      for (const stepId of orderBeforeDrag) list.append(cardsById.get(stepId));
      return;
    }
    const orderedStepIds = [...list.querySelectorAll(".interaction-turn-card")]
      .map((candidate) => Number(candidate.dataset.stepId));
    void reorderInteractionGuideSteps(guide, orderedStepIds);
  }

  function cancelPointerDrag(event) {
    finishPointerDrag(event, { cancelled: true });
  }

  handle.addEventListener("pointerdown", (event) => {
    if (interactionGuideReorderInProgress || event.button !== 0) return;
    event.preventDefault();
    pointerId = event.pointerId;
    orderBeforeDrag = [...list.querySelectorAll(".interaction-turn-card")]
      .map((candidate) => Number(candidate.dataset.stepId));
    const bounds = card.getBoundingClientRect();
    pointerOffsetY = event.clientY - bounds.top;
    styleBeforeDrag = card.getAttribute("style");
    placeholder = node("div", "interaction-turn-placeholder");
    placeholder.style.height = `${bounds.height}px`;
    list.replaceChild(placeholder, card);
    document.body.append(card);
    Object.assign(card.style, {
      boxSizing: "border-box",
      height: `${bounds.height}px`,
      left: `${bounds.left}px`,
      margin: "0",
      pointerEvents: "none",
      position: "fixed",
      top: `${bounds.top}px`,
      width: `${bounds.width}px`,
      zIndex: "1000",
    });
    handle.setPointerCapture(pointerId);
    card.classList.add("dragging");
    list.classList.add("reordering");
    window.addEventListener("pointermove", movePointerDrag, true);
    window.addEventListener("pointerup", finishPointerDrag, true);
    window.addEventListener("pointercancel", cancelPointerDrag, true);
  });
  handle.addEventListener("keydown", (event) => {
    if (interactionGuideReorderInProgress || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const orderedStepIds = guide.steps.map(({ id }) => id);
    const currentIndex = orderedStepIds.indexOf(step.id);
    const nextIndex = event.key === "ArrowUp" ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= orderedStepIds.length) return;
    [orderedStepIds[currentIndex], orderedStepIds[nextIndex]] = [
      orderedStepIds[nextIndex], orderedStepIds[currentIndex],
    ];
    void reorderInteractionGuideSteps(guide, orderedStepIds);
  });
}

function renderInteractionGuideDetail() {
  const guide = selectedInteractionGuide;
  if (!guide) {
    renderInteractionGuideEmpty();
    return;
  }
  elements.interactionGuideDetail.replaceChildren();
  const editable = guide.status === "active" && !guide.activeRun;
  const needsDailyChoice = Boolean(guide.activeRun?.requiresDailyChoice);
  const header = node("header", "interaction-detail-heading");
  const identity = node("div", "interaction-detail-identity");
  identity.append(
    node("p", "eyebrow", guide.activeRun ? "Briefing in progress" : "Agent-led briefing"),
    node("h3", "", guide.name),
    node("p", "interaction-guide-meta", `${guide.status} · version ${guide.version} · ${guide.steps.length} ${guide.steps.length === 1 ? "exchange" : "exchanges"}`),
  );
  if (needsDailyChoice) {
    identity.append(node(
      "p",
      "interaction-guide-meta",
      `This unfinished run began on ${formatLocalDate(guide.activeRun.startedLocalDate)}. Resume it or start over.`,
    ));
  }
  const actions = node("div", "interaction-detail-actions");
  if (guide.status === "active") {
    const start = node(
      "button",
      "",
      needsDailyChoice ? "Resume previous run" : guide.activeRun ? "Resume this briefing" : "Start this briefing",
    );
    start.type = "button";
    start.disabled = !guide.steps.some(({ enabled }) => enabled);
    if (start.disabled) start.title = "Add and enable at least one exchange before starting.";
    start.addEventListener("click", () => void startInteractionGuide(guide, start, {
      resumePrevious: needsDailyChoice,
    }));
    actions.append(start);
    if (needsDailyChoice) {
      const restart = node("button", "secondary", "Start over");
      restart.type = "button";
      restart.addEventListener("click", () => void startInteractionGuide(guide, restart, {
        restart: true,
      }));
      actions.append(restart);
    }
  }
  const edit = node("button", "secondary", "Edit briefing");
  edit.type = "button";
  edit.disabled = !editable;
  if (!editable) edit.title = guide.activeRun ? "Cancel or finish the active briefing before editing." : "Archived briefings cannot be edited.";
  edit.addEventListener("click", () => openInteractionGuideEditor(guide));
  actions.append(edit);
  if (guide.activeRun) {
    const cancel = node("button", "danger", "Cancel briefing");
    cancel.type = "button";
    cancel.addEventListener("click", () => void cancelInteractionGuideRun(guide, cancel));
    actions.append(cancel);
  }
  header.append(identity, actions);

  const turns = node("section", "interaction-turns");
  const turnsHeading = node("header", "interaction-turns-heading");
  const turnsTitle = node("div");
  turnsTitle.append(node("p", "eyebrow", "Conversation structure"), node("h4", "", "Exchanges"));
  const add = node("button", "secondary compact", "Add exchange");
  add.type = "button";
  add.disabled = !editable;
  if (!editable) add.title = guide.activeRun ? "Cancel or finish the active briefing before editing." : "Archived briefings cannot be edited.";
  add.addEventListener("click", () => openInteractionStepEditor());
  turnsHeading.append(turnsTitle, add);
  turns.append(turnsHeading);
  if (guide.steps.length === 0) {
    turns.append(node("p", "empty", "No exchanges yet. Add exchange 1 to make this briefing runnable."));
  } else {
    const list = node("div", "interaction-turn-list");
    for (const step of guide.steps) {
      const card = node("article", `interaction-turn-card${step.enabled ? "" : " disabled"}`);
      card.dataset.stepId = String(step.id);
      const stepHeading = node("header", "interaction-turn-heading");
      const stepIdentity = node("div", "interaction-turn-identity");
      const dragHandle = node("button", "interaction-turn-drag-handle", "⠿");
      dragHandle.type = "button";
      dragHandle.disabled = !editable;
      dragHandle.title = editable
        ? "Drag to reorder; use Up and Down arrow keys for keyboard reordering"
        : guide.activeRun
          ? "Cancel or finish the active briefing before reordering."
          : "Archived briefings cannot be reordered.";
      dragHandle.setAttribute("aria-label", `Reorder exchange ${step.stepNumber}`);
      dragHandle.setAttribute("aria-keyshortcuts", "ArrowUp ArrowDown");
      const openingCopy = node("button", "copy-text-button interaction-turn-opening-copy", step.openingText);
      openingCopy.type = "button";
      openingCopy.title = "Copy exchange opening";
      openingCopy.setAttribute("aria-label", `Copy exchange ${step.stepNumber} opening: ${step.openingText}`);
      openingCopy.addEventListener("click", (event) => void copyText(step.openingText, event.currentTarget));
      stepIdentity.append(
        node("span", "interaction-turn-number", String(step.stepNumber)),
        openingCopy,
        node(
          "span",
          `interaction-turn-state${step.enabled ? "" : " disabled"}`,
          step.enabled
            ? `${interactionProgressLabels[step.progressState] ?? step.progressState} · ${interactionCompletionLabels[step.completionMode]}`
            : "Disabled",
        ),
      );
      const editStep = node("button", "secondary compact", "Edit");
      editStep.type = "button";
      editStep.disabled = !editable;
      editStep.addEventListener("click", () => openInteractionStepEditor(step));
      const stepActions = node("div", "interaction-detail-actions");
      stepActions.append(
        agentReferenceButton(interactionStepIdentity(guide, step), `briefing exchange ${step.stepNumber}`),
        editStep,
        dragHandle,
      );
      stepHeading.append(stepIdentity, stepActions);

      card.append(stepHeading);
      const answerKeys = Object.keys(step.answers ?? {});
      if (answerKeys.length) {
        const answers = node("details", "interaction-turn-answers");
        const answerJson = node("pre");
        answerJson.textContent = JSON.stringify(step.answers, null, 2);
        answers.append(node("summary", "", `${answerKeys.length} recorded ${answerKeys.length === 1 ? "answer" : "answers"}`), answerJson);
        card.append(answers);
      }
      list.append(card);
      if (editable) enableInteractionStepDragging({ guide, step, card, handle: dragHandle, list });
    }
    turns.append(list);
  }
  elements.interactionGuideDetail.append(header, turns);
}

async function loadInteractionGuide(guideId) {
  const sequence = ++interactionGuideLoadSequence;
  elements.interactionGuideStatusMessage.textContent = "Loading briefing…";
  try {
    const body = await api(`/api/interaction-guides/${guideId}`);
    if (sequence !== interactionGuideLoadSequence) return;
    selectedInteractionGuide = body.guide;
    renderInteractionGuideList();
    renderInteractionGuideDetail();
    elements.interactionGuideStatusMessage.textContent = "";
  } catch (error) {
    if (sequence !== interactionGuideLoadSequence) return;
    selectedInteractionGuide = null;
    renderInteractionGuideList();
    renderInteractionGuideEmpty("Could not load this briefing", error.message || "Briefing unavailable.");
    elements.interactionGuideStatusMessage.textContent = error.message || "Briefing unavailable.";
  }
}

async function refreshInteractionGuides({ selectId = selectedInteractionGuide?.id ?? null } = {}) {
  elements.refreshInteractionGuides.disabled = true;
  elements.interactionGuideStatusMessage.textContent = "Loading briefings…";
  try {
    const status = elements.interactionGuideStatus.value;
    const body = await api(`/api/interaction-guides?status=${encodeURIComponent(status)}&limit=500`);
    interactionGuideSummaries = body.guides;
    const nextId = interactionGuideSummaries.some(({ id }) => id === selectId)
      ? selectId
      : interactionGuideSummaries[0]?.id ?? null;
    if (!nextId) {
      selectedInteractionGuide = null;
      renderInteractionGuideList();
      renderInteractionGuideEmpty();
      elements.interactionGuideStatusMessage.textContent = "";
      return;
    }
    renderInteractionGuideList();
    await loadInteractionGuide(nextId);
  } catch (error) {
    interactionGuideSummaries = [];
    selectedInteractionGuide = null;
    renderInteractionGuideList();
    renderInteractionGuideEmpty("Briefings unavailable", error.message || "Could not load briefings.");
    elements.interactionGuideStatusMessage.textContent = error.message || "Could not load briefings.";
  } finally {
    elements.refreshInteractionGuides.disabled = false;
  }
}

function openInteractionGuideEditor(guide = null) {
  elements.interactionGuideForm.reset();
  elements.interactionGuideFormError.textContent = "";
  elements.interactionGuideDialogTitle.textContent = guide ? "Edit briefing" : "New briefing";
  elements.interactionGuideId.value = guide?.id ?? "";
  elements.interactionGuideVersion.value = guide?.version ?? "";
  elements.interactionGuideName.value = guide?.name ?? "";
  elements.archiveInteractionGuide.hidden = !guide || guide.status !== "active";
  elements.interactionGuideDialog.showModal();
  elements.interactionGuideName.focus();
}

async function saveInteractionGuide(event) {
  event.preventDefault();
  elements.interactionGuideFormError.textContent = "";
  const submit = elements.interactionGuideForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const id = elements.interactionGuideId.value;
    const payload = {
      name: elements.interactionGuideName.value,
    };
    if (id) payload.expectedVersion = Number(elements.interactionGuideVersion.value);
    const result = await api(id ? `/api/interaction-guides/${id}` : "/api/interaction-guides", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    elements.interactionGuideDialog.close();
    await refreshInteractionGuides({ selectId: result.guide.id });
    elements.interactionGuideStatusMessage.textContent = id ? "Briefing updated." : "Briefing created. Add its first exchange.";
  } catch (error) {
    elements.interactionGuideFormError.textContent = error.message || "Could not save the briefing.";
  } finally {
    submit.disabled = false;
  }
}

async function archiveEditedInteractionGuide() {
  const id = Number(elements.interactionGuideId.value);
  if (!id || !window.confirm("Archive this briefing?")) return;
  elements.archiveInteractionGuide.disabled = true;
  elements.interactionGuideFormError.textContent = "";
  try {
    await api(`/api/interaction-guides/${id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: Number(elements.interactionGuideVersion.value) }),
    });
    elements.interactionGuideDialog.close();
    await refreshInteractionGuides({ selectId: null });
    elements.interactionGuideStatusMessage.textContent = "Briefing archived.";
  } catch (error) {
    elements.interactionGuideFormError.textContent = error.message || "Could not archive the briefing.";
  } finally {
    elements.archiveInteractionGuide.disabled = false;
  }
}

function openInteractionStepEditor(step = null) {
  const guide = selectedInteractionGuide;
  if (!guide) return;
  elements.interactionStepForm.reset();
  elements.interactionStepFormError.textContent = "";
  elements.interactionStepDialogTitle.textContent = step ? `Edit exchange ${step.stepNumber}` : "New exchange";
  elements.interactionStepId.value = step?.id ?? "";
  elements.deleteInteractionStep.hidden = !step;
  const guideOptions = new Map([[guide.id, guide]]);
  for (const candidate of interactionGuideSummaries) {
    if (candidate.status === "active" && !candidate.activeRun) guideOptions.set(candidate.id, candidate);
  }
  elements.interactionStepGuide.replaceChildren();
  for (const candidate of [...guideOptions.values()].sort((left, right) => left.name.localeCompare(right.name))) {
    const option = node("option", "", candidate.name);
    option.value = String(candidate.id);
    option.dataset.version = String(candidate.version);
    elements.interactionStepGuide.append(option);
  }
  elements.interactionStepGuide.value = String(step?.guideId ?? guide.id);
  elements.interactionStepGuideHint.textContent = step
    ? "Changing the briefing moves this exchange to the end. Saved run answers and progress reset; ledger history remains available."
    : "Choose which briefing will contain this exchange.";
  elements.interactionStepNumber.value = step?.stepNumber
    ?? Math.max(0, ...guide.steps.map(({ stepNumber }) => stepNumber)) + 1;
  elements.interactionStepOpening.value = step?.openingText ?? "";
  elements.interactionStepInstructions.value = step?.instructionsText ?? "";
  elements.interactionStepCompletionMode.value = step?.completionMode ?? "response_valid";
  elements.interactionStepEnabled.checked = step?.enabled ?? true;
  elements.interactionStepDialog.showModal();
  elements.interactionStepNumber.focus();
}

async function saveInteractionStep(event) {
  event.preventDefault();
  const guide = selectedInteractionGuide;
  if (!guide) return;
  elements.interactionStepFormError.textContent = "";
  const submit = elements.interactionStepForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const stepId = elements.interactionStepId.value;
    const targetOption = elements.interactionStepGuide.selectedOptions[0];
    const targetGuideId = Number(elements.interactionStepGuide.value);
    const targetVersion = Number(targetOption?.dataset.version);
    const payload = {
      expectedVersion: stepId ? guide.version : targetVersion,
      stepNumber: Number(elements.interactionStepNumber.value),
      openingText: elements.interactionStepOpening.value,
      instructionsText: elements.interactionStepInstructions.value || null,
      completionMode: elements.interactionStepCompletionMode.value,
      enabled: elements.interactionStepEnabled.checked,
    };
    if (stepId && targetGuideId !== guide.id) {
      payload.targetGuideId = targetGuideId;
      payload.expectedTargetVersion = targetVersion;
    }
    const result = await api(stepId
      ? `/api/interaction-guide-steps/${stepId}`
      : `/api/interaction-guides/${targetGuideId}/steps`, {
      method: stepId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    elements.interactionStepDialog.close();
    const destinationGuide = result.targetGuide ?? result.guide;
    await refreshInteractionGuides({ selectId: destinationGuide.id });
    elements.interactionGuideStatusMessage.textContent = result.moved
      ? `Exchange updated and moved to ${destinationGuide.name}.`
      : stepId ? "Exchange updated." : "Exchange added.";
  } catch (error) {
    elements.interactionStepFormError.textContent = error.message || "Could not save the exchange.";
  } finally {
    submit.disabled = false;
  }
}

async function deleteEditedInteractionStep() {
  const guide = selectedInteractionGuide;
  const stepId = Number(elements.interactionStepId.value);
  if (!guide || !stepId) return;
  const stepNumber = guide.steps.find(({ id }) => id === stepId)?.stepNumber
    ?? Number(elements.interactionStepNumber.value);
  if (!window.confirm(`Delete exchange ${stepNumber} from “${guide.name}”? This cannot be undone.`)) return;
  elements.deleteInteractionStep.disabled = true;
  elements.interactionStepFormError.textContent = "";
  try {
    await api(`/api/interaction-guide-steps/${stepId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: guide.version }),
    });
    elements.interactionStepDialog.close();
    await refreshInteractionGuides({ selectId: guide.id });
    elements.interactionGuideStatusMessage.textContent = `Exchange ${stepNumber} deleted.`;
  } catch (error) {
    elements.interactionStepFormError.textContent = error.message || "Could not delete the exchange.";
  } finally {
    elements.deleteInteractionStep.disabled = false;
  }
}

async function startInteractionGuide(guide, button, { restart = false, resumePrevious = false } = {}) {
  button.disabled = true;
  const respondSilently = elements.respondSilently.checked;
  prepareSpeechOutput(respondSilently);
  try {
    const action = restart
      ? `Start briefing ${guide.id} ("${guide.name}") over from the beginning. I explicitly authorize discarding its unfinished current-run answers. Do not resume the old run.`
      : resumePrevious
        ? `Resume the existing run of briefing ${guide.id} ("${guide.name}"). I explicitly choose to keep its unfinished answers from ${guide.activeRun.startedLocalDate} and continue where it stopped. Do not restart it.`
        : `Start or resume briefing ${guide.id} ("${guide.name}"). Follow its ordered exchanges and persist each answer through the internal interaction-guide tools.`;
    const created = await api("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `${action} Use the user-facing terms briefing, exchange, and opening.`,
      }),
    });
    expectSpokenResponse(created.requestId, respondSilently);
    elements.status.textContent = `${guide.name} queued.`;
    switchView("agent");
    await loadRequests({ force: true, followLatest: true });
  } catch (error) {
    window.alert(error.message || "Could not start the briefing.");
    button.disabled = false;
  }
}

async function cancelInteractionGuideRun(guide, button) {
  const reason = window.prompt("Why are you cancelling this briefing?", "Cancelled from the Briefings page");
  if (reason === null) return;
  if (!reason.trim()) {
    window.alert("A cancellation reason is required.");
    return;
  }
  button.disabled = true;
  try {
    await api(`/api/interaction-guide-runs/${encodeURIComponent(guide.activeRun.id)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    await refreshInteractionGuides({ selectId: guide.id });
    elements.interactionGuideStatusMessage.textContent = "Briefing cancelled. It can be edited again.";
  } catch (error) {
    window.alert(error.message || "Could not cancel the briefing.");
    button.disabled = false;
  }
}

async function refreshLogs() {
  try {
    const trackerParameters = new URLSearchParams({
      limit: "500",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      localDate: localDateKey(new Date()),
    });
    const [trackerBody, entryBody] = await Promise.all([
      api(`/api/log-trackers?${trackerParameters}`),
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

function formatLogAverage(average, unit) {
  if (average?.value === null || average?.value === undefined) return "—";
  const value = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(average.value);
  return `${value} ${unit}`;
}

function logAverageGrid(tracker) {
  const grid = node("div", "log-average-grid");
  const averages = [
    ["7-day average", tracker.numericAverages?.sevenDay],
    ["1-year average", tracker.numericAverages?.oneYear],
    ["All-time average", tracker.numericAverages?.allTime],
  ];
  for (const [label, average] of averages) {
    const statistic = node("div", "log-average-stat");
    statistic.append(
      node("span", "", label),
      node("strong", "", formatLogAverage(average, tracker.unit)),
      node(
        "small",
        "",
        `${average?.dayCount ?? 0} ${(average?.dayCount ?? 0) === 1 ? "logged day" : "logged days"}`,
      ),
    );
    grid.append(statistic);
  }
  return grid;
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
        + ` · ${tracker.unit}`;
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
            metadata.append(node("span", "log-value", `${entry.numberValue} ${tracker.unit}`));
          }
          item.append(metadata, node("p", "", entry.contentText));
          entryList.append(item);
        }
      }
      const entryDisclosure = node("details", "log-entry-disclosure");
      const entrySummary = node("summary", "log-entry-summary");
      entrySummary.append(
        node("span", "", "Recent entries"),
        node(
          "span",
          "log-entry-summary-count",
          entries.length === tracker.entryCount
            ? String(entries.length)
            : `${entries.length} of ${tracker.entryCount}`,
        ),
      );
      entryDisclosure.append(entrySummary, entryList);
      card.append(cardHeading, logAverageGrid(tracker), entryDisclosure);
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
  const unitNeedsReview = tracker?.unit?.toLowerCase() === "set me";
  elements.logTrackerUnit.value = unitNeedsReview ? "" : tracker?.unit ?? "";
  elements.logTrackerUnit.readOnly = Boolean(tracker && !unitNeedsReview);
  elements.logTrackerUnit.required = isNew || unitNeedsReview;
  elements.logTrackerUnit.placeholder = unitNeedsReview ? "Replace ‘set me’" : "e.g. kg, reps, out of 10";
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
      trackerUnit: elements.logTrackerUnit.value || null,
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
  const referencedRequestIds = referencedRequestIdsFromComposer(text);
  const respondSilently = elements.respondSilently.checked;
  prepareSpeechOutput(respondSilently);
  elements.send.disabled = true;
  elements.respondSilently.disabled = true;
  elements.status.textContent = "Submitting…";
  try {
    const file = elements.requestFile.files?.[0] ?? null;
    let primaryFileId = Number(elements.requestExistingFile.value) || null;
    let selectedStoredFile = storedFiles.find((entry) => entry.fileId === primaryFileId) ?? null;
    let uploadedNewFile = false;
    if (file) {
      elements.status.textContent = "Uploading attachment…";
      const mimeType = requestFileMimeType(file);
      const uploaded = await api(`/api/request-files?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": mimeType },
        body: file,
      });
      primaryFileId = uploaded.fileId;
      selectedStoredFile = uploaded;
      uploadedNewFile = true;
      elements.status.textContent = `Uploaded ${uploaded.originalFilename} as file #${uploaded.fileId}. Submitting request…`;
    }
    const created = await api("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, primaryFileId, referencedRequestIds, runLimits: pendingRunLimits }),
    });
    expectSpokenResponse(created.requestId, respondSilently);
    elements.text.value = "";
    resizeRequestText();
    elements.requestFile.value = "";
    elements.requestExistingFile.value = "";
    updateRequestFileSelection();
    pendingRunLimits = null;
    updateRunLimitsSummary();
    elements.status.textContent = uploadedNewFile
      ? `Uploaded ${selectedStoredFile.originalFilename} as file #${primaryFileId}. Request queued.`
      : selectedStoredFile
        ? `Queued with file #${primaryFileId} — ${selectedStoredFile.title || selectedStoredFile.originalFilename}.`
      : "Queued.";
    switchView("agent");
    await Promise.all([loadRequests({ force: true, followLatest: true }), loadFiles()]);
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    elements.send.disabled = false;
    elements.respondSilently.disabled = false;
  }
});

elements.text.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (!elements.send.disabled) elements.form.requestSubmit();
});
elements.text.addEventListener("input", resizeRequestText);
elements.composerAttachFile.addEventListener("click", () => elements.requestFile.click());
elements.requestFile.addEventListener("change", () => {
  if (elements.requestFile.files?.length) elements.requestExistingFile.value = "";
  updateRequestFileSelection();
});
elements.requestExistingFile.addEventListener("change", () => {
  if (elements.requestExistingFile.value) elements.requestFile.value = "";
  updateRequestFileSelection();
});
elements.editSelectedFile.addEventListener("click", () => {
  const fileId = Number(elements.requestExistingFile.value);
  if (fileId) void openFileEditor(fileId);
});
elements.fileForm.addEventListener("submit", saveFileDetails);
elements.respondSilently.addEventListener("change", saveResponseSilencePreference);
function clearRequestFileSelection() {
  elements.requestFile.value = "";
  elements.requestExistingFile.value = "";
  updateRequestFileSelection();
}
elements.removeRequestFile.addEventListener("click", clearRequestFileSelection);
elements.composerRemoveRequestFile.addEventListener("click", clearRequestFileSelection);
elements.runLimitsButton.addEventListener("click", openRunLimitsDialog);
elements.runLimitsForm.addEventListener("submit", applyRunLimits);
elements.runLimitsDefaults.addEventListener("click", clearRunLimits);
elements.runToolCallsUnlimited.addEventListener("change", updateRunLimitFields);
elements.runTimeUnlimited.addEventListener("change", updateRunLimitFields);
elements.send.addEventListener("click", (event) => {
  if (!sendRecording()) return;
  event.preventDefault();
});

elements.record.addEventListener("click", async () => {
  if (recorder?.state === "recording") return;
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    recordingChunks = [];
    recordingCancelled = false;
    recorder = new MediaRecorder(recordingStream);
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size) recordingChunks.push(event.data); });
    recorder.addEventListener("stop", async () => {
      stopRecordingMeter();
      recordingStream?.getTracks().forEach((track) => track.stop());
      if (recordingCancelled) {
        recordingChunks = [];
        recorder = null;
        recordingStream = null;
        recordingStartedAt = null;
        recordingRespondSilently = false;
        recordingCancelled = false;
        elements.record.disabled = false;
        elements.send.disabled = false;
        elements.cancelRecording.disabled = false;
        elements.cancelRecording.hidden = true;
        elements.respondSilently.disabled = false;
        elements.composer.classList.remove("recording");
        elements.record.classList.remove("recording");
        elements.record.setAttribute("aria-label", "Start recording");
        elements.record.title = "Record a voice request";
        elements.recordLabel.textContent = "Recording";
        elements.recordTimer.textContent = "00:00";
        elements.status.textContent = "Recording cancelled.";
        return;
      }
      const blob = new Blob(recordingChunks, { type: recorder.mimeType || "audio/webm" });
      elements.status.textContent = "Uploading voice request…";
      try {
        const created = await api("/api/voice", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
        expectSpokenResponse(created.requestId, recordingRespondSilently);
        elements.status.textContent = "Voice request queued.";
        switchView("agent");
        await loadRequests({ force: true, followLatest: true });
      } catch (error) {
        elements.status.textContent = error.message;
      } finally {
        recorder = null;
        recordingStream = null;
        recordingStartedAt = null;
        recordingRespondSilently = false;
        recordingCancelled = false;
        elements.record.disabled = false;
        elements.send.disabled = false;
        elements.cancelRecording.disabled = false;
        elements.cancelRecording.hidden = true;
        elements.respondSilently.disabled = false;
        elements.composer.classList.remove("recording");
        elements.record.classList.remove("recording");
        elements.record.setAttribute("aria-label", "Start recording");
        elements.record.title = "Record a voice request";
        elements.recordLabel.textContent = "Recording";
        elements.recordTimer.textContent = "00:00";
      }
    });
    recorder.start(1000);
    recordingStartedAt = Date.now();
    elements.composer.classList.add("recording");
    elements.record.classList.add("recording");
    elements.cancelRecording.hidden = false;
    elements.record.setAttribute("aria-label", "Microphone input level");
    elements.record.title = "Microphone input level";
    elements.recordLabel.textContent = "Recording";
    elements.recordTimer.textContent = "00:00";
    startRecordingMeter(recordingStream);
    recordingTimer = setInterval(() => {
      elements.recordTimer.textContent = formatClock(Date.now() - recordingStartedAt);
    }, 250);
    elements.status.textContent = "";
  } catch (error) {
    recordingStream?.getTracks().forEach((track) => track.stop());
    recordingStream = null;
    recorder = null;
    recordingCancelled = false;
    stopRecordingMeter();
    elements.composer.classList.remove("recording");
    elements.record.classList.remove("recording");
    elements.cancelRecording.hidden = true;
    elements.record.setAttribute("aria-label", "Start recording");
    elements.record.title = "Record a voice request";
    elements.recordLabel.textContent = "Recording";
    elements.recordTimer.textContent = "00:00";
    elements.status.textContent = error.message;
  }
});

elements.cancelRecording.addEventListener("click", () => {
  if (recorder?.state !== "recording") return;
  recordingCancelled = true;
  clearInterval(recordingTimer);
  stopRecordingMeter();
  elements.record.disabled = true;
  elements.send.disabled = true;
  elements.cancelRecording.disabled = true;
  elements.composer.classList.remove("recording");
  elements.record.classList.remove("recording");
  elements.record.setAttribute("aria-label", "Cancelling recording");
  elements.record.title = "Cancelling recording";
  elements.recordLabel.textContent = "Cancelling…";
  recorder.stop();
});

elements.refresh.addEventListener("click", async () => {
  elements.refresh.disabled = true;
  elements.refresh.textContent = "Refreshing…";
  elements.status.textContent = "Refreshing MCP tools…";
  try {
    await api("/api/integrations/mcp/refresh", { method: "POST" });
    window.location.reload();
  } catch (error) {
    elements.status.textContent = error.message;
    elements.refresh.disabled = false;
    elements.refresh.textContent = "Refresh";
  }
});
elements.requestLimit.addEventListener("change", () => loadRequests({ force: true }).catch((error) => { elements.status.textContent = error.message; }));
elements.newConversation.addEventListener("click", async () => {
  if (!window.confirm("Start a new conversation? Chapeaux Fous will stop carrying the current conversation context into the next request.")) return;
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
elements.mcpIntegrationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.mcpIntegrationConnect.disabled = true;
  elements.mcpIntegrationError.textContent = "";
  try {
    const name = elements.mcpIntegrationName.value.trim();
    await api("/api/integrations/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        url: elements.mcpIntegrationUrl.value.trim(),
        token: elements.mcpIntegrationToken.value,
      }),
    });
    elements.mcpIntegrationForm.reset();
    elements.status.textContent = `${name} connected.`;
    await loadHealth();
  } catch (error) {
    elements.mcpIntegrationError.textContent = error.message;
  } finally {
    elements.mcpIntegrationConnect.disabled = false;
  }
});
elements.integrationList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-name]");
  if (!button || !elements.integrationList.contains(button)) return;
  const name = button.dataset.name;
  button.disabled = true;
  try {
    if (button.classList.contains("remove-integration")) {
      if (!window.confirm(`Remove ${name}? Its locally stored API token and tools will be deleted from Chapeaux Fous.`)) return;
      await api(`/api/integrations/${encodeURIComponent(name)}`, { method: "DELETE" });
      elements.status.textContent = `${name} removed.`;
      await loadHealth();
    } else if (button.classList.contains("disconnect-integration")) {
      if (!window.confirm(`Disconnect ${name}? Chapeaux Fous will delete its local OAuth credentials and remove the provider's tools.`)) return;
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
elements.usage.addEventListener("click", () => {
  elements.settingsMenu.open = false;
  switchView("ai-usage");
});
elements.refreshAiUsage.addEventListener("click", () => void loadAiUsage());
elements.aiPricingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const pricing = {
    inputPerMillion: Number(elements.aiInputPrice.value),
    cachedInputPerMillion: Number(elements.aiCachedInputPrice.value),
    cacheWritePerMillion: Number(elements.aiCacheWritePrice.value),
    outputPerMillion: Number(elements.aiOutputPrice.value),
  };
  if (!validPricing(pricing)) {
    elements.aiUsageStatus.textContent = "Prices must be non-negative numbers.";
    return;
  }
  localStorage.setItem(aiPricingStorageKey, JSON.stringify(pricing));
  renderAiUsage();
  elements.aiUsageStatus.textContent = "Pricing override saved in this browser.";
});
elements.resetAiPricing.addEventListener("click", () => {
  localStorage.removeItem(aiPricingStorageKey);
  renderAiUsage();
  elements.aiUsageStatus.textContent = "Using the server pricing defaults.";
});
elements.closeTrace.addEventListener("click", () => { elements.tracePanel.hidden = true; });
elements.copyTrace.addEventListener("click", (event) => copyText(JSON.stringify(activeTrace, null, 2), event.currentTarget));
elements.tokenForm.addEventListener("submit", () => {
  accessToken = elements.token.value.trim();
  localStorage.setItem("agent-slayer-token", accessToken);
  setTimeout(() => Promise.allSettled([loadHealth(), loadRequests({ force: true })]), 0);
});
for (const button of elements.navButtons) {
  button.addEventListener("click", () => {
    elements.settingsMenu.open = false;
    switchView(button.dataset.view);
  });
}
document.addEventListener("click", (event) => {
  if (elements.settingsMenu.open && !elements.settingsMenu.contains(event.target)) {
    elements.settingsMenu.open = false;
  }
});
elements.composerHatsLink.addEventListener("click", () => switchView("hats"));
elements.previousWeeks.addEventListener("click", () => {
  selectedCalendarDate = addDays(selectedCalendarDate, -14);
  calendarRangeStart = startOfWeek(selectedCalendarDate);
  void refreshCalendar();
});
elements.nextWeeks.addEventListener("click", () => {
  selectedCalendarDate = addDays(selectedCalendarDate, 14);
  calendarRangeStart = startOfWeek(selectedCalendarDate);
  void refreshCalendar();
});
elements.previousCalendarMonth.addEventListener("click", () => {
  selectedCalendarDate = addCalendarMonths(selectedCalendarDate, -1);
  calendarRangeStart = startOfWeek(selectedCalendarDate);
  void refreshCalendar();
});
elements.nextCalendarMonth.addEventListener("click", () => {
  selectedCalendarDate = addCalendarMonths(selectedCalendarDate, 1);
  calendarRangeStart = startOfWeek(selectedCalendarDate);
  void refreshCalendar();
});
elements.previousCalendarYear.addEventListener("click", () => {
  selectedCalendarDate = addCalendarMonths(selectedCalendarDate, -12);
  calendarRangeStart = startOfWeek(selectedCalendarDate);
  void refreshCalendar();
});
elements.nextCalendarYear.addEventListener("click", () => {
  selectedCalendarDate = addCalendarMonths(selectedCalendarDate, 12);
  calendarRangeStart = startOfWeek(selectedCalendarDate);
  void refreshCalendar();
});
elements.today.addEventListener("click", () => {
  selectedCalendarDate = new Date();
  calendarRangeStart = startOfWeek(selectedCalendarDate);
  void refreshCalendar();
});
elements.cancelCalendarSchedule.addEventListener("click", () => cancelCalendarScheduling());
elements.newEvent.addEventListener("click", () => openEventEditor());
elements.calendarSearch.addEventListener("input", queueCalendarSearch);
elements.calendarSearchIncludeArchived.addEventListener("change", () => {
  if (elements.calendarSearch.value.trim()) void searchCalendarEvents();
});
elements.eventForm.addEventListener("submit", saveEvent);
elements.eventDelete.addEventListener("click", () => void deleteEditedEvent());
elements.eventInviteDraft.addEventListener("click", () => void openEventInviteDraft());
elements.eventInviteSearch.addEventListener("input", renderEventInviteContacts);
elements.eventInviteForm.addEventListener("submit", createEventInviteDraft);
for (const control of [
  elements.eventRepeatEnabled, elements.eventRepeatInterval, elements.eventRepeatFrequency,
  elements.eventRepeatEnd, elements.eventRepeatCount, elements.eventRepeatUntil,
  elements.eventRepeatPattern, elements.eventRepeatMonthDay,
  elements.eventRepeatOrdinal, elements.eventRepeatOrdinalWeekday,
  ...elements.eventRepeatWeekdays.querySelectorAll('input[type="checkbox"]'),
]) {
  control.addEventListener("change", updateEventRecurrenceEditor);
  if (control.matches('input[type="number"]')) control.addEventListener("input", updateEventRecurrenceEditor);
}
elements.newTodo.addEventListener("click", async () => {
  if (todoGroups.length === 0) await refreshTodos();
  openTodoEditor();
});
elements.newRoutine.addEventListener("click", () => void openNewRoutine());
elements.publishRoutineThisWeek.addEventListener("click", () => {
  const from = startOfDay(new Date());
  void publishRoutineRange(from, addDays(startOfWeek(from), 7));
});
elements.publishRoutineNextWeek.addEventListener("click", () => {
  const from = addDays(startOfWeek(new Date()), 7);
  void publishRoutineRange(from, addDays(from, 7));
});
elements.newTodoGroup.addEventListener("click", () => void createTodoGroup());
elements.todoNewGroup.addEventListener("click", async () => {
  const group = await createTodoGroup({ selectFilter: false });
  if (group) populateTodoGroupEditor(group.id);
});
elements.todoScope.addEventListener("change", () => void refreshTodos());
elements.todoGroupFilter.addEventListener("change", renderTodos);
elements.todoContactFilter.addEventListener("change", renderTodos);
elements.todoGroup.addEventListener("change", updateTodoSequenceHint);
elements.moveOverdueTodos.addEventListener("click", () => void moveOverdueTodosToToday());
elements.todoForm.addEventListener("submit", saveTodo);
elements.todoClearScheduled.addEventListener("click", clearTodoScheduledInEditor);
for (const control of [
  elements.todoRepeatEnabled, elements.todoRepeatInterval, elements.todoRepeatFrequency,
  elements.todoRepeatEnd, elements.todoRepeatCount, elements.todoRepeatUntil,
  elements.todoRepeatPattern, elements.todoRepeatMonthDay,
  elements.todoRepeatOrdinal, elements.todoRepeatOrdinalWeekday,
  ...elements.todoRepeatWeekdays.querySelectorAll('input[type="checkbox"]'),
]) {
  const recurrenceChanged = () => {
    todoRecurrenceDirty = true;
    updateTodoRecurrenceEditor();
    updateTodoClearScheduledVisibility();
  };
  control.addEventListener("change", recurrenceChanged);
  if (control.matches('input[type="number"]')) control.addEventListener("input", recurrenceChanged);
}
elements.newContentGroup.addEventListener("click", () => void createContentGroup());
elements.contentGroupForm.addEventListener("submit", saveContentGroup);
elements.contentGroupArchive.addEventListener("click", () => void archiveEditedContentGroup());
elements.contentNewGroup.addEventListener("click", async () => {
  const group = await createContentGroup({ selectFilter: false });
  if (group) populateContentGroupEditor(group.id);
});
elements.contentSearch.addEventListener("input", queueContentSearch);
elements.contentStatusFilter.addEventListener("change", () => void refreshContent());
elements.contentGroupFilter.addEventListener("change", () => void refreshContent());
elements.contentForm.addEventListener("submit", saveContent);
elements.contentDelete.addEventListener("click", () => void deleteEditedContent());
elements.refreshVideoScripts.addEventListener("click", () => void refreshVideoScripts());
elements.videoScriptStatusFilter.addEventListener("change", () => void refreshVideoScripts());
elements.videoContentForm.addEventListener("submit", addVideoToContentSequence);
elements.refreshFiles.addEventListener("click", () => void loadFiles());
elements.selectVideoScriptSources.addEventListener("click", () => {
  elements.settingsMenu.open = false;
  if (selectingVideoScriptSources) showVideoScriptSelection();
  else beginVideoScriptSelection();
});
elements.cancelVideoScriptSelection.addEventListener("click", cancelVideoScriptSelection);
elements.generateVideoScript.addEventListener("click", () => void generateSelectedVideoScript());
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
elements.newInteractionGuide.addEventListener("click", () => openInteractionGuideEditor());
elements.refreshInteractionGuides.addEventListener("click", () => void refreshInteractionGuides());
elements.interactionGuideStatus.addEventListener("change", () => {
  selectedInteractionGuide = null;
  void refreshInteractionGuides({ selectId: null });
});
elements.interactionGuideForm.addEventListener("submit", saveInteractionGuide);
elements.archiveInteractionGuide.addEventListener("click", () => void archiveEditedInteractionGuide());
elements.interactionStepForm.addEventListener("submit", saveInteractionStep);
elements.deleteInteractionStep.addEventListener("click", () => void deleteEditedInteractionStep());
for (const button of document.querySelectorAll(".dialog-close")) {
  button.addEventListener("click", () => button.closest("dialog")?.close());
}

renderAgentMascot(elements.agentMascot);
updateComposerHeight();
resizeRequestText();
if ("scrollRestoration" in history) history.scrollRestoration = "manual";
window.addEventListener("load", () => scrollChatToLatest(), { once: true });
window.addEventListener("scroll", scheduleScrollLatestButtonUpdate, { passive: true });
window.addEventListener("resize", scheduleScrollLatestButtonUpdate);
elements.scrollLatest.addEventListener("click", () => scrollChatToLatest({ behavior: "smooth" }));
if (!accessToken) elements.tokenDialog.showModal();
if (new URLSearchParams(window.location.search).get("oauth") === "connected") {
  elements.status.textContent = "MCP OAuth connected.";
  history.replaceState(null, "", window.location.pathname);
}
loadHealth().catch(() => {});
loadRequests({ force: true }).catch(() => {});
loadFiles().catch(() => {});
switchView("agent");
setInterval(() => loadHealth().catch(() => {}), 5000);
setInterval(() => loadRequests().catch(() => {}), 1500);
setInterval(updateProgressClocks, 250);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});
