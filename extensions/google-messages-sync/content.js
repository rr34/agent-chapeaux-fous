(() => {
  "use strict";

  const SKIP_TAGS = new Set([
    "MWS-LINK-PREVIEW-DECORATOR", "MWS-MESSAGE-STATUS", "MWS-MESSAGE-ACTIONS",
    "MWS-ABSOLUTE-TIMESTAMP", "MWS-RELATIVE-TIMESTAMP", "MW-MESSAGE-REACTIONS-DISPLAY",
    "MW-MESSAGE-REACTIONS-SPACER", "MAT-PROGRESS-SPINNER", "MWS-SPINNER", "MWS-ICON",
  ]);
  const BLOCK_TAGS = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT", "FIGCAPTION",
    "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "OL", "P", "PRE", "SECTION",
    "TABLE", "TR", "UL",
  ]);
  const PART_LABELS = {
    "mws-image-message-part": { label: "[Image]", kind: "image" },
    "mws-video-message-part": { label: "[Video]", kind: "video" },
    "mws-audio-message-part": { label: "[Audio]", kind: "audio" },
    "mws-file-message-part": { label: "[File]", kind: "file" },
    "mws-vcard-message-part": { label: "[Contact card]", kind: "contact_card" },
    "mws-location-message-part": { label: "[Location]", kind: "location" },
    "mws-sticker-message-part": { label: "[Sticker]", kind: "sticker" },
    "mws-lottie-message-part": { label: "[Animated emoji]", kind: "animated_emoji" },
  };
  const BATCH_SIZE = 250;
  let syncRunning = false;

  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function runtimeMessage(message) {
    return chrome.runtime.sendMessage(message).then((response) => {
      if (!response?.ok) throw new Error(response?.error || "The Time V3 extension did not respond.");
      return response;
    });
  }

  async function currentState() {
    return runtimeMessage({ type: "GET_STATE" });
  }

  async function updateJob(patch) {
    return (await runtimeMessage({ type: "UPDATE_JOB", patch })).job;
  }

  function conversationIdFromHref(href) {
    const id = /\/web\/conversations\/([^/?#]+)/u.exec(String(href || ""))?.[1] || null;
    return id && /^[A-Za-z0-9_-]{6,}$/u.test(id) ? id : null;
  }

  function visibleTextNodes(root) {
    const values = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue?.replace(/\s+/gu, " ").trim();
      if (value && !values.includes(value)) values.push(value);
    }
    return values;
  }

  function scrollableAncestor(element) {
    let current = element?.parentElement;
    while (current && current !== document.body) {
      const style = getComputedStyle(current);
      if (/(auto|scroll)/u.test(style.overflowY) && current.scrollHeight > current.clientHeight + 20) return current;
      current = current.parentElement;
    }
    return null;
  }

  function collectConversationLinks(found) {
    for (const link of document.querySelectorAll('a[href*="/web/conversations/"]')) {
      const id = conversationIdFromHref(link.href);
      if (!id || found.has(id)) continue;
      const container = link.closest('[role="listitem"]') || link.closest("li") || link;
      const text = visibleTextNodes(container);
      found.set(id, {
        id,
        href: `https://messages.google.com/web/conversations/${encodeURIComponent(id)}`,
        title: text[0] || link.getAttribute("aria-label") || link.getAttribute("title") || "Unknown conversation",
      });
    }
  }

  function conversationContainer() {
    return document.querySelector("mw-conversation-container, mws-conversation-container")
      || document.querySelector("mws-messages-list")?.parentElement
      || null;
  }

  async function discoverConversations() {
    const first = document.querySelector('a[href*="/web/conversations/"]');
    if (!first) throw new Error("No Google Messages conversations are visible. Confirm that Messages for Web is paired.");
    const scroller = scrollableAncestor(first);
    const found = new Map();
    collectConversationLinks(found);
    if (!scroller) return [...found.values()];
    const original = scroller.scrollTop;
    scroller.scrollTop = 0;
    await sleep(500);
    collectConversationLinks(found);
    let unchanged = 0;
    let previousSize = found.size;
    for (let step = 0; step < 2000 && unchanged < 4; step += 1) {
      const beforeTop = scroller.scrollTop;
      scroller.scrollTop = Math.min(
        scroller.scrollHeight,
        scroller.scrollTop + Math.max(300, Math.floor(scroller.clientHeight * 0.8)),
      );
      await sleep(450);
      collectConversationLinks(found);
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4;
      unchanged = found.size === previousSize && (atBottom || scroller.scrollTop === beforeTop)
        ? unchanged + 1
        : 0;
      previousSize = found.size;
    }
    scroller.scrollTop = original;
    await sleep(250);
    return [...found.values()];
  }

  function messageParts(wrapper) {
    const routed = wrapper.querySelectorAll("mws-message-part-router > *");
    if (routed.length) return [...routed];
    return [...wrapper.querySelectorAll("*")]
      .filter((element) => element.tagName.toLocaleLowerCase("en-US").endsWith("-message-part"));
  }

  function parseAria(aria) {
    const result = { sender: null, date: null };
    if (!aria) return result;
    const sender = /^(.*?)\s+(?:said|sent)\b/u.exec(aria);
    if (sender) result.sender = sender[1].trim();
    const stamps = [...aria.matchAll(/\b(?:Sent|Received) on ([^.]+?)(?=\.(?:\s|$))/gu)];
    if (stamps.length) {
      const date = new Date(stamps.at(-1)[1].replace(/\s+at\s+/iu, " "));
      if (Number.isFinite(date.getTime())) result.date = date;
    }
    return result;
  }

  function messageMeta(wrapper) {
    const labels = [...wrapper.querySelectorAll("[aria-label]")]
      .map((element) => element.getAttribute("aria-label") || "")
      .filter(Boolean);
    const result = { sender: null, date: null, labels };
    for (const part of messageParts(wrapper)) {
      const parsed = parseAria(part.getAttribute("aria-label"));
      result.sender ||= parsed.sender;
      result.date ||= parsed.date;
      if (result.sender && result.date) break;
    }
    return result;
  }

  function reactions(wrapper) {
    const values = [];
    const seen = new Set();
    for (const element of wrapper.querySelectorAll("[aria-label]")) {
      const aria = element.getAttribute("aria-label") || "";
      const pattern = /(?:^|\.\s+)([^.]{1,60}?)\s+reacted with\s+([^.]+?)(?=\.(?:\s|$))/gu;
      for (const match of aria.matchAll(pattern)) {
        const key = `${match[1].trim()}|${match[2].trim()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        values.push({ by: match[1].trim(), type: match[2].trim(), emoji: null });
      }
    }
    const emoji = [...wrapper.querySelectorAll("mw-message-reactions-display [data-e2e-reaction]")]
      .map((element) => element.textContent.trim()).filter(Boolean);
    emoji.forEach((glyph, index) => {
      if (values[index]) values[index].emoji = glyph;
      else values.push({ by: null, type: null, emoji: glyph });
    });
    return values;
  }

  function extractText(root) {
    const buffer = [];
    const pushBreak = () => {
      if (buffer.length && !/\n$/u.test(buffer.at(-1))) buffer.push("\n");
    };
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        buffer.push(node.nodeValue || "");
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (SKIP_TAGS.has(node.tagName)) return;
      if (node.tagName === "BR") {
        buffer.push("\n");
        return;
      }
      const block = BLOCK_TAGS.has(node.tagName);
      if (block) pushBreak();
      node.childNodes.forEach(walk);
      if (block) pushBreak();
    }
    walk(root);
    return buffer.join("")
      .replace(/\u00a0/gu, " ")
      .replace(/[ \t]+/gu, " ")
      .replace(/ *\n */gu, "\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim();
  }

  function attachmentForPart(part) {
    const tag = part.tagName.toLocaleLowerCase("en-US");
    if (tag === "mws-text-message-part") return null;
    const known = PART_LABELS[tag];
    const kind = known?.kind || tag.replace(/^mws-/u, "").replace(/-message-part$/u, "").replace(/-/gu, "_");
    const baseLabel = known?.label || `[${kind.replace(/_/gu, " ")}]`;
    const aria = part.getAttribute("aria-label") || "";
    const named = /\bsent (?:a|an|the) [a-z ]*?:\s*((?:[^.]|\.(?!\s|$))+)/iu.exec(aria);
    const name = named?.[1]?.trim() || null;
    return {
      descriptor: name ? `${baseLabel.slice(0, -1)}: ${name}]` : baseLabel,
      metadata: { kind, name },
    };
  }

  function messageContent(wrapper) {
    const text = [];
    const attachments = [];
    for (const part of messageParts(wrapper)) {
      const attachment = attachmentForPart(part);
      if (attachment) {
        text.push(attachment.descriptor);
        attachments.push(attachment.metadata);
      }
      const content = part.querySelector("mws-message-part-content") || part;
      const value = extractText(content);
      if (value) text.push(value);
    }
    if (!text.length) {
      const fallback = extractText(wrapper);
      if (fallback) text.push(fallback);
    }
    return { text: text.join("\n") || null, attachments };
  }

  function transportFor(wrapper, meta, attachments) {
    const evidence = meta.labels.join(" ").toLocaleLowerCase("en-US");
    if (/\brcs\b|end-to-end encrypted/u.test(evidence)) return "rcs";
    if (/\bmms\b|multimedia message/u.test(evidence)) return "mms";
    if (/\bsms\b|text message/u.test(evidence)) return "sms";
    if (attachments.length) return "unknown";
    return "unknown";
  }

  function deliveryStatus(direction, labels) {
    if (direction === "inbound") return "unknown";
    const evidence = labels.join(" ").toLocaleLowerCase("en-US");
    if (/failed|not sent|couldn't send/u.test(evidence)) return "failed";
    if (/delivered|read by/u.test(evidence)) return "delivered";
    if (/\bsent\b/u.test(evidence)) return "sent";
    return "unknown";
  }

  function headerMetadata(conversation) {
    const header = conversation.querySelector("mws-header");
    const text = header?.innerText || "";
    const threadTitle = text.trim().split("\n")[0]?.trim() || "Unknown conversation";
    const evidence = [text];
    for (const element of header?.querySelectorAll("[aria-label], [title]") || []) {
      evidence.push(element.getAttribute("aria-label") || element.getAttribute("title") || "");
    }
    const addresses = new Set();
    for (const source of evidence) {
      for (const match of source.matchAll(/(?:\+?\d[\d().\s-]{6,}\d)/gu)) addresses.add(match[0].trim());
    }
    const nameParts = threadTitle.split(/,\s*/u).map((value) => value.trim()).filter(Boolean);
    const participants = [...addresses].map((address) => ({ address, displayName: null }));
    if (!participants.length) {
      for (const displayName of nameParts) participants.push({ address: null, displayName });
    }
    return { threadTitle, participants, group: participants.length > 1 || nameParts.length > 1 };
  }

  async function sha256Ascii(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function extractMessages(conversationId) {
    const conversation = conversationContainer();
    if (!conversation) throw new Error("Google Messages did not render the selected conversation.");
    const header = headerMetadata(conversation);
    const wrappers = [...conversation.querySelectorAll("mws-message-wrapper")];
    const messages = [];
    let undated = 0;
    for (let index = 0; index < wrappers.length; index += 1) {
      const wrapper = wrappers[index];
      const meta = messageMeta(wrapper);
      if (!meta.date) {
        undated += 1;
        continue;
      }
      const direction = wrapper.getAttribute("is-outgoing") === "true" ? "outbound" : "inbound";
      const content = messageContent(wrapper);
      if (!content.text && !content.attachments.length) continue;
      const senderName = direction === "outbound"
        ? "You"
        : (meta.sender && meta.sender !== "You" ? meta.sender : header.threadTitle);
      const participants = direction === "inbound"
        ? [{ address: null, displayName: senderName, role: "sender" }]
        : header.participants.map((participant) => ({ ...participant, role: "recipient" }));
      const rawId = wrapper.getAttribute("msg-id") || "";
      const fallbackIdentity = `${conversationId}\u0000${direction}\u0000${meta.date.toISOString()}\u0000${senderName}\u0000${content.text || ""}\u0000${index}`;
      const externalId = /^[\x20-\x7E]{1,255}$/u.test(rawId)
        ? rawId
        : `sha256:${await sha256Ascii(fallbackIdentity)}`;
      messages.push({
        conversationId,
        externalId,
        transport: transportFor(wrapper, meta, content.attachments),
        direction,
        occurredAtMs: meta.date.getTime(),
        timestampPrecision: "minute",
        text: content.text,
        deliveryStatus: deliveryStatus(direction, meta.labels),
        threadTitle: header.threadTitle,
        senderName,
        group: header.group,
        participants,
        reactions: reactions(wrapper),
        attachments: content.attachments,
        providerLabels: [...new Set(meta.labels)].slice(0, 20),
      });
    }
    return { messages, undated };
  }

  function oldestLoaded(conversation) {
    const wrapper = conversation.querySelector("mws-message-wrapper");
    return wrapper ? messageMeta(wrapper).date : null;
  }

  async function assertStillRunning() {
    const state = await currentState();
    if (state.job?.status !== "running") throw new Error("Synchronization was cancelled.");
    return state.job;
  }

  async function loadThread(conversation, cutoffMs, progress) {
    const wrappers = () => conversation.querySelectorAll("mws-message-wrapper");
    const button = () => conversation.querySelector("mws-messages-list button.load-more");
    const cutoff = cutoffMs == null ? null : new Date(cutoffMs);
    const alreadyOldEnough = () => {
      const oldest = oldestLoaded(conversation);
      return cutoff && oldest && oldest <= cutoff;
    };
    if (alreadyOldEnough()) return;
    for (let clicks = 0; clicks < 500; clicks += 1) {
      await assertStillRunning();
      const control = button();
      if (!control) return;
      const before = wrappers().length;
      control.click();
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline && wrappers().length <= before) await sleep(250);
      const after = wrappers().length;
      if (after <= before) return;
      await progress(after, oldestLoaded(conversation));
      if (alreadyOldEnough()) return;
    }
    throw new Error("Stopped after 500 history loads in one conversation; the requested history is larger than the safety limit.");
  }

  async function waitForConversation(conversationId, timeoutMs = 12_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (conversationIdFromHref(location.href) === conversationId
          && document.querySelector("mws-message-wrapper")) return true;
      await sleep(200);
    }
    return false;
  }

  async function navigateToConversation(target) {
    const alreadyAtTarget = conversationIdFromHref(location.href) === target.id;
    if (alreadyAtTarget && await waitForConversation(target.id, 12_000)) return true;
    if (alreadyAtTarget) {
      throw new Error(`Google Messages opened ${target.title}, but its message list did not render. Reload the tab once and retry.`);
    }
    await updateJob({ phase: `Opening ${target.title}` });
    location.assign(target.href);
    return false;
  }

  async function uploadMessages(job, messages) {
    let current = job;
    for (let offset = 0; offset < messages.length; offset += BATCH_SIZE) {
      current = await assertStillRunning();
      const batchMessages = messages.slice(offset, offset + BATCH_SIZE);
      const response = await runtimeMessage({
        type: "UPLOAD_BATCH",
        batch: {
          protocol: "timev3.google-messages-web-sync",
          version: 1,
          accountKey: (await currentState()).config.accountKey || "default",
          syncId: current.syncId,
          messages: batchMessages,
        },
      });
      const counts = response.result.messages;
      current = await updateJob({
        phase: `Uploading messages ${Math.min(messages.length, offset + batchMessages.length)}/${messages.length}`,
        messagesAccepted: Number(current.messagesAccepted || 0) + Number(counts.received || 0),
        messagesCreated: Number(current.messagesCreated || 0) + Number(counts.created || 0),
        messagesUpdated: Number(current.messagesUpdated || 0) + Number(counts.updated || 0),
        messagesDeduplicated: Number(current.messagesDeduplicated || 0) + Number(counts.deduplicated || 0),
        messagesAmbiguous: Number(current.messagesAmbiguous || 0) + Number(counts.ambiguous || 0),
        unresolvedParticipants: Number(current.unresolvedParticipants || 0)
          + Number(counts.unresolvedParticipants || 0),
      });
    }
    return current;
  }

  async function runSync(initialJob = null) {
    if (syncRunning) return;
    syncRunning = true;
    try {
      let job = initialJob || (await currentState()).job;
      if (!job || job.status !== "running") return;
      if (!job.conversations?.length) {
        const conversations = await discoverConversations();
        job = await updateJob({
          conversations,
          conversationIndex: 0,
          phase: `Discovered ${conversations.length} conversations`,
        });
      }
      for (let index = Number(job.conversationIndex || 0); index < job.conversations.length; index += 1) {
        job = await assertStillRunning();
        const target = job.conversations[index];
        job = await updateJob({ conversationIndex: index, phase: `Opening ${target.title}` });
        if (!await navigateToConversation(target)) return;
        const conversation = conversationContainer();
        if (!conversation) throw new Error(`Google Messages did not render the message list for ${target.title}.`);
        job = await updateJob({ phase: `Loading history for ${target.title}` });
        await loadThread(conversation, job.sinceMs, async (loaded, oldest) => {
          job = await updateJob({
            phase: `Loading ${target.title}: ${loaded.toLocaleString()} messages${oldest ? `, back to ${oldest.toLocaleDateString()}` : ""}`,
          });
        });
        const extracted = await extractMessages(target.id);
        const selected = job.sinceMs == null
          ? extracted.messages
          : extracted.messages.filter((message) => message.occurredAtMs >= job.sinceMs);
        job = await updateJob({
          phase: `Read ${selected.length.toLocaleString()} messages from ${target.title}`,
          messagesRead: Number(job.messagesRead || 0) + selected.length,
          undatedSkipped: Number(job.undatedSkipped || 0) + extracted.undated,
        });
        job = await uploadMessages(job, selected);
        job = await updateJob({ conversationIndex: index + 1, phase: `Accepted ${target.title}` });
      }
      await runtimeMessage({ type: "COMPLETE_JOB", patch: { conversationIndex: job.conversations.length } });
    } catch (error) {
      const current = await currentState().catch(() => ({ job: null }));
      if (current.job?.status === "running") {
        await runtimeMessage({ type: "FAIL_JOB", error: error instanceof Error ? error.message : String(error) }).catch(() => {});
      }
    } finally {
      syncRunning = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "START_SYNC") return false;
    void (async () => {
      try {
        const started = await runtimeMessage({
          type: "START_SYNC",
          fullHistory: message.fullHistory === true,
          requestId: message.requestId || null,
        });
        sendResponse({ ok: true });
        void runSync(started.job);
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
    return true;
  });

  setTimeout(() => {
    void currentState().then(({ job, senderTabId }) => {
      if (job?.status === "running" && job.tabId === senderTabId) void runSync(job);
    }).catch(() => {});
  }, 1200);
})();
