const fields = {
  serverUrl: document.querySelector("#server-url"),
  accessToken: document.querySelector("#access-token"),
  accountKey: document.querySelector("#account-key"),
  fullHistory: document.querySelector("#full-history"),
  save: document.querySelector("#save"),
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

function jobText(job, config) {
  if (!job) {
    return config.lastSuccessfulSyncMs
      ? `Last successful sync\n${new Date(config.lastSuccessfulSyncMs).toLocaleString()}`
      : "No synchronization has completed yet.";
  }
  const total = job.conversations?.length || 0;
  const current = Math.min(total, Number(job.conversationIndex || 0) + (job.status === "complete" ? 0 : 1));
  const elapsed = Math.max(0, Date.now() - Number(job.startedAtMs || Date.now()));
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  return [
    `${job.status.toUpperCase()} — ${job.phase || "Working"}`,
    total ? `Conversation ${current}/${total}` : "Conversation discovery in progress",
    `Read ${Number(job.messagesRead || 0).toLocaleString()} · accepted ${Number(job.messagesAccepted || 0).toLocaleString()}`,
    `New ${Number(job.messagesCreated || 0).toLocaleString()} · refreshed ${Number(job.messagesUpdated || 0).toLocaleString()} · deduplicated ${Number(job.messagesDeduplicated || 0).toLocaleString()}`,
    `Ambiguous duplicates ${Number(job.messagesAmbiguous || 0).toLocaleString()} · unresolved participants ${Number(job.unresolvedParticipants || 0).toLocaleString()}`,
    `Skipped without usable time ${Number(job.undatedSkipped || 0).toLocaleString()}`,
    `Elapsed ${minutes}:${String(seconds).padStart(2, "0")}`,
    job.error ? `Error: ${job.error}` : "",
  ].filter(Boolean).join("\n");
}

async function refresh() {
  const { config, job } = await runtimeMessage({ type: "GET_STATE" });
  if (document.activeElement !== fields.serverUrl) fields.serverUrl.value = config.serverUrl || "";
  fields.accessToken.placeholder = config.hasAccessToken
    ? "Saved — leave blank to keep it"
    : "Required";
  if (document.activeElement !== fields.accountKey) fields.accountKey.value = config.accountKey || "default";
  if (!config.lastSuccessfulSyncMs) fields.fullHistory.checked = true;
  const running = job?.status === "running";
  fields.sync.disabled = running;
  fields.cancel.disabled = !running;
  fields.status.textContent = jobText(job, config);
}

fields.save.addEventListener("click", async () => {
  try {
    const serverUrl = fields.serverUrl.value.trim().replace(/\/+$/u, "");
    const origin = new URL(serverUrl).origin;
    const allowed = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!allowed) throw new Error("Brave did not grant access to the Time V3 server.");
    await runtimeMessage({
      type: "SAVE_CONFIG",
      config: {
        serverUrl,
        accessToken: fields.accessToken.value,
        accountKey: fields.accountKey.value,
      },
    });
    fields.accessToken.value = "";
    fields.status.textContent = "Connection settings saved.";
    await refresh();
  } catch (error) {
    fields.status.textContent = `Error: ${error.message}`;
  }
});

fields.sync.addEventListener("click", async () => {
  try {
    const tab = await messagesTab();
    if (!tab?.id) throw new Error("Open and pair Google Messages for Web first.");
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "START_SYNC",
      fullHistory: fields.fullHistory.checked,
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
