const CONFIG_KEY = "timeV3GoogleMessagesConfig";
const JOB_KEY = "timeV3GoogleMessagesJob";
const COMMAND_ALARM = "timeV3GoogleMessagesCommands";
let commandPollRunning = false;

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(value) {
  return chrome.storage.local.set(value);
}

function publicConfig(config = {}) {
  return {
    serverUrl: config.serverUrl || "",
    hasAccessToken: Boolean(config.accessToken),
    accountKey: config.accountKey || "default",
    lastSuccessfulSyncMs: config.lastSuccessfulSyncMs || null,
  };
}

async function state() {
  const stored = await storageGet([CONFIG_KEY, JOB_KEY]);
  return {
    config: publicConfig(stored[CONFIG_KEY]),
    job: stored[JOB_KEY] || null,
  };
}

async function updateJob(patch) {
  const stored = await storageGet(JOB_KEY);
  const current = stored[JOB_KEY] || {};
  const job = { ...current, ...patch, updatedAtMs: Date.now() };
  await storageSet({ [JOB_KEY]: job });
  await reportJob(job).catch(() => {});
  return job;
}

async function serverRequest(path, { method = "GET", body = null, allowNoContent = false } = {}) {
  const stored = await storageGet(CONFIG_KEY);
  const config = stored[CONFIG_KEY] || {};
  if (!config.serverUrl || !config.accessToken) throw new Error("Save the Time V3 server URL and access token first.");
  const response = await fetch(`${config.serverUrl}${path}`, {
    method,
    headers: {
      ...(body == null ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${config.accessToken}`,
    },
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
  if (allowNoContent && response.status === 204) return null;
  let responseBody;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }
  if (!response.ok) throw new Error(responseBody?.error || `Time V3 returned HTTP ${response.status}.`);
  return responseBody;
}

function uploadBatch(batch) {
  return serverRequest("/api/correspondence/google-messages-sync", { method: "POST", body: batch });
}

function reportJob(job) {
  if (!job?.requestId) return Promise.resolve();
  return serverRequest(`/api/correspondence/google-messages-sync/request/${job.requestId}/progress`, {
    method: "POST",
    body: {
      status: job.status,
      phase: job.phase,
      error: job.error || null,
      conversationIndex: Number(job.conversationIndex || 0),
      conversationCount: Number(job.conversations?.length || 0),
      messagesRead: Number(job.messagesRead || 0),
      messagesAccepted: Number(job.messagesAccepted || 0),
      messagesCreated: Number(job.messagesCreated || 0),
      messagesUpdated: Number(job.messagesUpdated || 0),
      messagesDeduplicated: Number(job.messagesDeduplicated || 0),
      messagesAmbiguous: Number(job.messagesAmbiguous || 0),
      unresolvedParticipants: Number(job.unresolvedParticipants || 0),
      undatedSkipped: Number(job.undatedSkipped || 0),
    },
  });
}

async function reportPending(requestId, phase, error = null) {
  await serverRequest(`/api/correspondence/google-messages-sync/request/${requestId}/progress`, {
    method: "POST",
    body: { status: "pending", phase, error },
  });
}

async function pollServerCommands() {
  if (commandPollRunning) return;
  commandPollRunning = true;
  try {
    const stored = await storageGet(CONFIG_KEY);
    const config = stored[CONFIG_KEY] || {};
    if (!config.serverUrl || !config.accessToken) return;
    const command = await serverRequest(
      `/api/correspondence/google-messages-sync/next?accountKey=${encodeURIComponent(config.accountKey || "default")}`,
      { allowNoContent: true },
    );
    if (!command) return;
    const current = await state();
    if (current.job?.status === "running") {
      await reportPending(command.requestId, "Waiting for the current browser synchronization to finish");
      return;
    }
    const tabs = await chrome.tabs.query({ url: "https://messages.google.com/web/*" });
    const tab = tabs[0];
    if (!tab?.id) {
      await reportPending(command.requestId, "Open the paired Google Messages for Web tab in Brave");
      return;
    }
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "START_SYNC",
        fullHistory: command.fullHistory === true,
        requestId: command.requestId,
      });
      if (!response?.ok) throw new Error(response?.error || "The Google Messages tab did not start synchronization.");
    } catch {
      await reportPending(command.requestId, "Reload the Google Messages for Web tab so the extension can connect");
    }
  } catch {
    // The alarm will retry. Connection errors must not disable popup-driven synchronization.
  } finally {
    commandPollRunning = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    try {
      if (message?.type === "GET_STATE") {
        sendResponse({ ok: true, ...(await state()), senderTabId: sender.tab?.id ?? null });
        return;
      }
      if (message?.type === "SAVE_CONFIG") {
        const serverUrl = String(message.config?.serverUrl || "").trim().replace(/\/+$/u, "");
        const suppliedAccessToken = String(message.config?.accessToken || "").trim();
        const accountKey = String(message.config?.accountKey || "default").trim();
        if (!/^https?:\/\//u.test(serverUrl)) throw new Error("Server URL must begin with http:// or https://.");
        if (!/^[A-Za-z0-9._-]+$/u.test(accountKey)) throw new Error("Account key contains unsupported characters.");
        const previous = (await storageGet(CONFIG_KEY))[CONFIG_KEY] || {};
        const accessToken = suppliedAccessToken || previous.accessToken || "";
        if (!accessToken) throw new Error("Access token is required.");
        const config = { ...previous, serverUrl, accessToken, accountKey };
        await storageSet({ [CONFIG_KEY]: config });
        sendResponse({ ok: true, config: publicConfig(config) });
        void pollServerCommands();
        return;
      }
      if (message?.type === "START_SYNC") {
        const current = await state();
        if (!current.config.serverUrl || !current.config.hasAccessToken) throw new Error("Save connection settings first.");
        if (!sender.tab?.id) throw new Error("Open Google Messages for Web before starting synchronization.");
        if (current.job?.status === "running") throw new Error("Google Messages synchronization is already running.");
        const fullHistory = message.fullHistory === true || !current.config.lastSuccessfulSyncMs;
        const overlapMs = 2 * 24 * 60 * 60 * 1000;
        const sinceMs = fullHistory ? null : Math.max(0, current.config.lastSuccessfulSyncMs - overlapMs);
        const job = {
          syncId: crypto.randomUUID(),
          requestId: message.requestId || null,
          status: "running",
          phase: "Discovering conversations",
          tabId: sender.tab.id,
          fullHistory,
          sinceMs,
          conversations: [],
          conversationIndex: 0,
          messagesRead: 0,
          messagesAccepted: 0,
          messagesCreated: 0,
          messagesUpdated: 0,
          messagesDeduplicated: 0,
          messagesAmbiguous: 0,
          unresolvedParticipants: 0,
          undatedSkipped: 0,
          warnings: [],
          startedAtMs: Date.now(),
          updatedAtMs: Date.now(),
        };
        await storageSet({ [JOB_KEY]: job });
        await reportJob(job).catch(() => {});
        sendResponse({ ok: true, job });
        return;
      }
      if (message?.type === "UPDATE_JOB") {
        sendResponse({ ok: true, job: await updateJob(message.patch || {}) });
        return;
      }
      if (message?.type === "UPLOAD_BATCH") {
        sendResponse({ ok: true, result: await uploadBatch(message.batch) });
        return;
      }
      if (message?.type === "COMPLETE_JOB") {
        const completedAtMs = Date.now();
        const job = await updateJob({
          ...(message.patch || {}),
          status: "complete",
          phase: "Complete",
          completedAtMs,
        });
        const stored = await storageGet(CONFIG_KEY);
        const config = { ...(stored[CONFIG_KEY] || {}), lastSuccessfulSyncMs: completedAtMs };
        await storageSet({ [CONFIG_KEY]: config });
        sendResponse({ ok: true, job });
        return;
      }
      if (message?.type === "FAIL_JOB") {
        sendResponse({ ok: true, job: await updateJob({
          status: "error",
          phase: "Failed",
          error: String(message.error || "Unknown synchronization failure"),
          completedAtMs: Date.now(),
        }) });
        return;
      }
      if (message?.type === "CANCEL_JOB") {
        sendResponse({ ok: true, job: await updateJob({
          status: "cancelled",
          phase: "Cancelled",
          completedAtMs: Date.now(),
        }) });
        return;
      }
      sendResponse({ ok: false, error: "Unknown extension message." });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
  return true;
});

chrome.alarms.create(COMMAND_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === COMMAND_ALARM) void pollServerCommands();
});
chrome.runtime.onStartup.addListener(() => void pollServerCommands());
chrome.runtime.onInstalled.addListener(() => void pollServerCommands());
void pollServerCommands();
