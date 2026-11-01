const CONFIG_KEY = "timeV3GoogleMessagesConfig";
const JOB_KEY = "timeV3GoogleMessagesJob";
const COMMAND_STATUS_KEY = "timeV3GoogleMessagesCommandStatus";
const COMMAND_ALARM = "timeV3GoogleMessagesCommands";
let commandPollRunning = false;
let packagedConnectionPromise = null;

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(value) {
  return chrome.storage.local.set(value);
}

function packagedConnection() {
  packagedConnectionPromise ||= fetch(chrome.runtime.getURL("connection.json"))
    .then((response) => {
      if (!response.ok) throw new Error("The packaged Time V3 connection is missing.");
      return response.json();
    })
    .then((value) => {
      const serverUrl = new URL(String(value.serverUrl || "")).origin;
      const accountKey = String(value.accountKey || "default");
      if (!/^[A-Za-z0-9._-]+$/u.test(accountKey)) throw new Error("The packaged account key is invalid.");
      return { serverUrl, accountKey };
    });
  return packagedConnectionPromise;
}

async function configuredConnection(storedConfig = null) {
  const stored = storedConfig ?? (await storageGet(CONFIG_KEY))[CONFIG_KEY] ?? {};
  return { ...stored, ...await packagedConnection() };
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
  const stored = await storageGet([CONFIG_KEY, JOB_KEY, COMMAND_STATUS_KEY]);
  return {
    config: publicConfig(await configuredConnection(stored[CONFIG_KEY])),
    job: stored[JOB_KEY] || null,
    commandStatus: stored[COMMAND_STATUS_KEY] || null,
  };
}

async function commandStatus(status, detail, config = {}) {
  const value = {
    status,
    detail,
    serverUrl: config.serverUrl || null,
    accountKey: config.accountKey || "default",
    checkedAtMs: Date.now(),
  };
  await storageSet({ [COMMAND_STATUS_KEY]: value });
  return value;
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
  const config = await configuredConnection();
  if (!config.accessToken) throw new Error("Save the Time V3 access token first.");
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
  if (responseBody == null) throw new Error("Time V3 returned a non-JSON response. Save only the server origin, without /app or another path.");
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

async function pollServerCommands({ surfaceErrors = false } = {}) {
  if (commandPollRunning) return (await storageGet(COMMAND_STATUS_KEY))[COMMAND_STATUS_KEY] || null;
  commandPollRunning = true;
  let config = {};
  try {
    config = await configuredConnection();
    if (!config.accessToken) {
      return await commandStatus("configuration_required", "Save the Time V3 access token.", config);
    }
    await commandStatus("checking", "Checking Time V3 for a pending synchronization request…", config);
    const command = await serverRequest(
      `/api/correspondence/google-messages-sync/next?accountKey=${encodeURIComponent(config.accountKey || "default")}`,
      { allowNoContent: true },
    );
    if (!command) return await commandStatus(
      "connected",
      "Connected successfully; this server has no pending request for this account key.",
      config,
    );
    await commandStatus("request_received", `Received synchronization request ${command.requestId}.`, config);
    const current = await state();
    if (current.job?.status === "running") {
      await reportPending(command.requestId, "Waiting for the current browser synchronization to finish");
      return await commandStatus("waiting", "A browser synchronization is already running.", config);
    }
    const tabs = await chrome.tabs.query({ url: "https://messages.google.com/web/*" });
    const tab = tabs[0];
    if (!tab?.id) {
      await reportPending(command.requestId, "Open the paired Google Messages for Web tab in Brave");
      return await commandStatus("waiting", "Open the paired Google Messages for Web tab in Brave.", config);
    }
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "START_SYNC",
        fullHistory: command.fullHistory === true,
        requestId: command.requestId,
      });
      if (!response?.ok) throw new Error(response?.error || "The Google Messages tab did not start synchronization.");
      return await commandStatus("started", "The Google Messages tab accepted the synchronization request.", config);
    } catch {
      await reportPending(command.requestId, "Reload the Google Messages for Web tab so the extension can connect");
      return await commandStatus("waiting", "Reload the Google Messages for Web tab so the extension can connect.", config);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("Time V3 command check failed:", error);
    const status = await commandStatus("error", detail, config).catch(() => ({ status: "error", detail }));
    if (surfaceErrors) throw new Error(detail);
    return status;
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
        const suppliedAccessToken = String(message.config?.accessToken || "").trim();
        const previous = (await storageGet(CONFIG_KEY))[CONFIG_KEY] || {};
        const accessToken = suppliedAccessToken || previous.accessToken || "";
        if (!accessToken) throw new Error("Access token is required.");
        const config = { ...previous, accessToken };
        await storageSet({ [CONFIG_KEY]: config });
        sendResponse({ ok: true, config: publicConfig(await configuredConnection(config)) });
        void pollServerCommands();
        return;
      }
      if (message?.type === "CHECK_COMMANDS") {
        sendResponse({ ok: true, commandStatus: await pollServerCommands({ surfaceErrors: true }) });
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
