const fields = {
  serverUrl: document.querySelector("#server-url"),
  accessToken: document.querySelector("#access-token"),
  historyMode: document.querySelector("#history-mode"),
  save: document.querySelector("#save"),
  check: document.querySelector("#check"),
  sync: document.querySelector("#sync"),
  cancel: document.querySelector("#cancel"),
  status: document.querySelector("#status"),
};

function runtimeMessage(message) {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (!response?.ok) throw new Error(response?.error || "The extension did not respond.");
    return response;
  });
}

async function messagesTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.url?.startsWith("https://messages.google.com/web/")) return active;
  const tabs = await chrome.tabs.query({ url: "https://messages.google.com/web/*" });
  return tabs[0] || null;
}

function durationText(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function historyText(mode) {
  return ({ incremental: "Since last sync", days_30: "Last 30 days", days_90: "Last 90 days", days_365: "Last year", all: "All available history" })[mode] || "Since last sync";
}

function jobText(job, config, commandStatus) {
  const command = commandStatus
    ? `Server command check: ${commandStatus.status}\n${commandStatus.detail}\n${commandStatus.serverUrl || "No server URL"} · account ${commandStatus.accountKey || "default"}`
    : "Server command check has not run yet.";
  if (!job) {
    const history = config.lastSuccessfulSyncMs
      ? `Last successful sync\n${new Date(config.lastSuccessfulSyncMs).toLocaleString()}`
      : "No synchronization has completed yet.";
    return `${history}\n\n${command}`;
  }
  const total = job.conversations?.length || 0;
  const current = Math.min(total, Number(job.conversationIndex || 0) + (job.status === "complete" ? 0 : 1));
  const elapsed = Math.max(0, Date.now() - Number(job.startedAtMs || Date.now()));
  const completed = job.status === "complete" ? total : Math.min(total, Number(job.conversationIndex || 0));
  const remaining = job.status === "running" && completed > 0
    ? (elapsed / completed) * Math.max(0, total - completed)
    : null;
  return [
    `${job.status.toUpperCase()} — ${job.phase || "Working"}`,
    total ? `Conversation ${current}/${total}` : "Conversation discovery in progress",
    `History range ${historyText(job.historyMode)}`,
    `Read ${Number(job.messagesRead || 0).toLocaleString()} · accepted ${Number(job.messagesAccepted || 0).toLocaleString()}`,
    `New ${Number(job.messagesCreated || 0).toLocaleString()} · refreshed ${Number(job.messagesUpdated || 0).toLocaleString()} · deduplicated ${Number(job.messagesDeduplicated || 0).toLocaleString()}`,
    `Ambiguous duplicates ${Number(job.messagesAmbiguous || 0).toLocaleString()} · unresolved participants ${Number(job.unresolvedParticipants || 0).toLocaleString()}`,
    `Skipped without usable time ${Number(job.undatedSkipped || 0).toLocaleString()}`,
    `Elapsed ${durationText(elapsed)}${remaining == null ? "" : ` · rough remaining ${durationText(remaining)}`}`,
    job.error ? `Error: ${job.error}` : "",
    "",
    command,
  ].filter((value, index, values) => value || (index > 0 && values[index - 1])).join("\n");
}

async function refresh() {
  const { config, job, commandStatus } = await runtimeMessage({ type: "GET_STATE" });
  fields.serverUrl.textContent = config.serverUrl || "Packaged server unavailable";
  fields.accessToken.placeholder = config.hasAccessToken
    ? "Saved — leave blank to keep it"
    : "Required";
  const running = job?.status === "running";
  fields.sync.disabled = running;
  fields.cancel.disabled = !running;
  fields.status.textContent = jobText(job, config, commandStatus);
}

fields.save.addEventListener("click", async () => {
  try {
    const saved = await runtimeMessage({
      type: "SAVE_CONFIG",
      config: {
        accessToken: fields.accessToken.value,
      },
    });
    fields.accessToken.value = "";
    const origin = new URL(saved.config.serverUrl).origin;
    const allowed = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!allowed) throw new Error("Connection saved, but Brave did not grant access to the Time V3 server.");
    await runtimeMessage({ type: "CHECK_COMMANDS" });
    await refresh();
  } catch (error) {
    fields.status.textContent = `Error: ${error.message}`;
  }
});

fields.check.addEventListener("click", async () => {
  fields.check.disabled = true;
  try {
    await runtimeMessage({ type: "CHECK_COMMANDS" });
    await refresh();
  } catch (error) {
    fields.status.textContent = `Server command check failed:\n${error.message}`;
  } finally {
    fields.check.disabled = false;
  }
});

fields.sync.addEventListener("click", async () => {
  try {
    const tab = await messagesTab();
    if (!tab?.id) throw new Error("Open and pair Google Messages for Web first.");
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "START_SYNC",
      historyMode: fields.historyMode.value,
    });
    if (!response?.ok) throw new Error(response?.error || "Google Messages did not start synchronization.");
    await refresh();
  } catch (error) {
    fields.status.textContent = `Error: ${error.message}`;
  }
});

fields.cancel.addEventListener("click", async () => {
  try {
    await runtimeMessage({ type: "CANCEL_JOB" });
    await refresh();
  } catch (error) {
    fields.status.textContent = `Error: ${error.message}`;
  }
});

void refresh().catch((error) => { fields.status.textContent = `Error: ${error.message}`; });
setInterval(() => void refresh().catch(() => {}), 1000);
