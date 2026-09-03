import { redactText } from "./redaction.mjs";
import { videoDialogueText } from "./video-dialogue.mjs";

const requestTypes = ["request.received", "voice.request.received"];
const terminalTypes = [
  "request.complete", "request.error", "agent.turn.end", "agent.turn.error",
  "voice.request.interrupted", "voice.transcription.error",
];
const scriptStatuses = new Set(["draft", "archived", "all"]);
const maximumMessageCharacters = 20_000;
const maximumProductionCharacters = 60_000;

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function positiveInteger(value, label, { maximum = null } = {}) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be a positive integer`);
  if (maximum !== null && result > maximum) throw new Error(`${label} cannot exceed ${maximum}`);
  return result;
}

function requiredText(value, label, maximum) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} cannot be empty`);
  if (result.length > maximum) throw new Error(`${label} cannot exceed ${maximum} characters`);
  return result;
}

function requestId(value) {
  const result = String(value ?? "").trim();
  if (!result || result.length > 64 || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw new Error(`Invalid source request ID: ${value}`);
  }
  return result;
}

function sourceRequestIds(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 8) {
    throw new Error("Select from 1 through 8 source interactions");
  }
  const ids = values.map(requestId);
  if (new Set(ids).size !== ids.length) throw new Error("Source interaction IDs must be unique");
  return ids;
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || "{}"); } catch { return fallback; }
}

function projectedDialogueText(value, label, fallback) {
  const text = videoDialogueText(redactText(String(value ?? "")), fallback);
  if (text.length > maximumMessageCharacters) {
    throw new Error(
      `${label} contains ${text.length.toLocaleString()} characters; the video-script limit is ${maximumMessageCharacters.toLocaleString()}. Nothing was truncated and the script was not generated.`,
    );
  }
  return text;
}

function estimatedDialogueSeconds(text) {
  const words = String(text ?? "").trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(2, Math.ceil(words / 2.75) + 1);
}

function conversationText(interactions, { markdown = false } = {}) {
  const lines = [];
  interactions.forEach((interaction, index) => {
    if (index) lines.push("");
    if (markdown) {
      lines.push(
        `### Interaction ${index + 1} · User and AI agent`,
        "",
        "**User request**",
        "",
        interaction.request,
        "",
        "**Chapeaux Fous · AI response**",
        "",
        interaction.response,
      );
    } else {
      lines.push(
        `INTERACTION ${index + 1} — USER AND AI AGENT`,
        "USER REQUEST:",
        interaction.request,
        "",
        "CHAPEAUX FOUS — AI RESPONSE:",
        interaction.response,
      );
    }
  });
  return lines.join("\n");
}

function canonicalGeneratorPrompt(plan, interactions) {
  return [
    "Create a polished 1080x1620 video of the supplied conversation below between a user and Chapeaux Fous, an AI agent.",
    `Conversation context: ${plan.concept}`,
    "The conversation is the finished product. Present every supplied user request and AI response in chronological order as one continuous chat interaction.",
    "The application has removed machine-only reference lines and unmistakably opaque identifiers from this video copy. Do not restore, read, or invent omitted codes; otherwise preserve the supplied dialogue verbatim.",
    "Show only the supplied conversation. Do not add content before, between, or after its messages.",
    "",
    conversationText(interactions),
  ].join("\n");
}

function scriptMarkdown(plan, interactions) {
  const lines = [
    `# ${plan.title}`,
    "",
    "## Video description",
    "",
    "Create a polished 1080x1620 video of a user interacting with Chapeaux Fous, an AI agent.",
    "",
    plan.concept,
    "",
    "The conversation itself is the final video. Keep the supplied video dialogue in chronological order and add no other material. Machine-only references and opaque identifiers have been omitted deterministically.",
    "",
    "## Conversation",
    "",
    conversationText(interactions, { markdown: true }),
  ];
  return lines.join("\n");
}

function publicSource(row) {
  return {
    requestId: row.turn_id,
    requestEventId: row.request_event_id,
    order: Number(row.source_order),
    request: row.request_text || "Voice request",
    submittedAtUtc: row.submitted_at_utc,
  };
}

function publicRender(row) {
  if (!row) return null;
  const outputFileId = row.output_file_id == null ? null : Number(row.output_file_id);
  return {
    id: Number(row.video_job_id),
    contentId: row.content_id == null ? null : Number(row.content_id),
    status: row.status,
    renderer: row.renderer,
    template: row.template,
    outputFileId,
    downloadUrl: outputFileId == null ? null : `/api/videos/${outputFileId}/download`,
    error: row.error_text,
    createdAtUtc: row.created_at_utc,
    startedAtUtc: row.started_at_utc,
    completedAtUtc: row.completed_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

function publicScript(row, sources = [], render = null) {
  if (!row) return null;
  return {
    id: Number(row.video_script_id),
    title: row.title,
    status: row.status,
    schemaVersion: Number(row.schema_version),
    plan: parseJson(row.script_json),
    scriptText: row.script_text,
    sources: sources.map(publicSource),
    render: publicRender(render),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    archivedAtUtc: row.archived_at_utc,
    version: Number(row.version),
  };
}

export class VideoScripts {
  constructor({ store, ledger }) {
    this.store = store;
    this.ledger = ledger;
  }

  #sourceRows(ids) {
    const selected = sourceRequestIds(ids);
    const rows = this.store.requireReady().prepare(`
      SELECT received.event_id AS request_event_id,
             received.event_seq AS request_event_seq,
             received.turn_id,
             received.occurred_at_utc AS submitted_at_utc,
             received.content_text AS request_text,
             received.payload_json
      FROM activity_events AS received
      WHERE received.turn_id IN (${placeholders(selected)})
        AND received.event_type IN (${placeholders(requestTypes)})
      ORDER BY received.event_seq
    `).all(...selected, ...requestTypes);
    const found = new Set(rows.map(({ turn_id: turnId }) => turnId));
    const missing = selected.filter((id) => !found.has(id));
    if (missing.length) throw Object.assign(
      new Error(`Source interactions were not found: ${missing.join(", ")}`),
      { statusCode: 404 },
    );
    const database = this.store.requireReady();
    for (const row of rows) {
      const sourceKind = parseJson(row.payload_json).requestKind ?? null;
      if (["video_script", "video_production", "interaction_video"].includes(sourceKind)) {
        throw Object.assign(
          new Error(`Interaction ${row.turn_id} is production workflow state, not source material`),
          { statusCode: 409 },
        );
      }
      const terminal = database.prepare(`
        SELECT status FROM activity_events
        WHERE turn_id = ? AND event_type IN (${placeholders(terminalTypes)})
        ORDER BY event_seq DESC LIMIT 1
      `).get(row.turn_id, ...terminalTypes);
      if (!terminal) throw Object.assign(
        new Error(`Wait for source interaction ${row.turn_id} to finish`),
        { statusCode: 409 },
      );
      if (terminal.status !== "complete") throw Object.assign(
        new Error(`Source interaction ${row.turn_id} did not complete successfully`),
        { statusCode: 409 },
      );
    }
    return rows;
  }

  selectionForGenerationRequest(generationRequestId) {
    const row = this.store.requireReady().prepare(`
      SELECT payload_json FROM activity_events
      WHERE turn_id = ? AND event_type IN (${placeholders(requestTypes)})
      ORDER BY event_seq LIMIT 1
    `).get(generationRequestId, ...requestTypes);
    const payload = parseJson(row?.payload_json);
    if (!["video_script", "video_production"].includes(payload.requestKind)) {
      throw new Error("This request is not bound to a video-script source selection");
    }
    return this.#sourceRows(payload.sourceRequestIds);
  }

  validateSelection(ids) {
    return this.#sourceRows(ids).map((row) => ({
      requestId: row.turn_id,
      requestEventId: row.request_event_id,
      submittedAtUtc: row.submitted_at_utc,
    }));
  }

  #dialogue(ids) {
    const interactions = ids.map((id, index) => {
      const source = this.ledger.interactionReplaySource(id);
      return {
        sourceOrder: index + 1,
        requestId: id,
        request: projectedDialogueText(source.rawTranscript, `Request ${id}`, "Voice request"),
        response: projectedDialogueText(source.response, `Response ${id}`, "No response was recorded."),
      };
    });
    const characters = interactions.reduce(
      (total, interaction) => total + interaction.request.length + interaction.response.length,
      0,
    );
    if (characters > maximumProductionCharacters) {
      throw new Error(
        `The selected conversation contains ${characters.toLocaleString()} characters; the video-script limit is ${maximumProductionCharacters.toLocaleString()}. Nothing was truncated and the script was not generated.`,
      );
    }
    return interactions;
  }

  selectedInteractionContext(generationRequestId) {
    const rows = this.selectionForGenerationRequest(generationRequestId);
    const sources = this.#dialogue(rows.map(({ turn_id: id }) => id));
    return {
      text: [
        "The user selected the following conversations for a video of interactions between a user and Chapeaux Fous, an AI agent.",
        "The application has projected them for video by removing machine-only reference lines, legacy identity JSON, UUIDs, and unmistakably opaque long tokens. The stored Agent requests and responses are unchanged.",
        "Return only a concise title and a one- or two-sentence description of what the conversation is about. The application will preserve and format the remaining request-response dialogue; do not summarize it, restore omitted codes, or add anything else.",
        JSON.stringify(sources, null, 2),
      ].join("\n\n"),
      data: { sources },
      heading: "Video-projected selected user-and-AI conversations",
    };
  }

  #scriptSources(scriptId) {
    return this.store.requireReady().prepare(`
      SELECT source.request_event_id, source.source_order,
             request.turn_id, request.content_text AS request_text,
             request.occurred_at_utc AS submitted_at_utc
      FROM video_script_sources AS source
      JOIN activity_events AS request ON request.event_id = source.request_event_id
      WHERE source.video_script_id = ?
      ORDER BY source.source_order
    `).all(scriptId);
  }

  #latestRender(scriptId) {
    return this.store.requireReady().prepare(`
      SELECT * FROM video_jobs
      WHERE video_script_id = ?
      ORDER BY video_job_id DESC LIMIT 1
    `).get(scriptId);
  }

  get(scriptId) {
    const id = positiveInteger(scriptId, "Video script ID");
    const row = this.store.requireReady().prepare(
      "SELECT * FROM video_scripts WHERE video_script_id = ?",
    ).get(id);
    return publicScript(row, row ? this.#scriptSources(id) : [], row ? this.#latestRender(id) : null);
  }

  list({ status = "draft", limit = 200 } = {}) {
    if (!scriptStatuses.has(status)) throw new Error(`Unknown video script status: ${status}`);
    const boundedLimit = positiveInteger(limit, "Video script limit");
    if (boundedLimit > 500) throw new Error("Video script limit cannot exceed 500");
    const rows = this.store.requireReady().prepare(`
      SELECT * FROM video_scripts
      ${status === "all" ? "" : "WHERE status = ?"}
      ORDER BY COALESCE(updated_at_utc, created_at_utc) DESC, video_script_id DESC
      LIMIT ?
    `).all(...(status === "all" ? [boundedLimit] : [status, boundedLimit]));
    const scripts = rows.map((row) => {
      const id = Number(row.video_script_id);
      return publicScript(row, this.#scriptSources(id), this.#latestRender(id));
    });
    return { status, count: scripts.length, scripts };
  }

  #insertRenderJob(scriptId, sourceIds, context = {}) {
    const result = this.store.requireReady().prepare(`
      INSERT INTO video_jobs (
        request_event_id, source_turn_id, renderer, template, status, input_json, video_script_id
      ) VALUES (?, ?, 'remotion', 'agent-ui-story', 'queued', ?, ?)
    `).run(
      context.requestEventId ?? null,
      sourceIds[0] ?? null,
      JSON.stringify({ contractVersion: 1, videoScriptId: scriptId, sourceRequestIds: sourceIds }),
      scriptId,
    );
    const jobId = Number(result.lastInsertRowid);
    this.ledger.append({
      type: "video.render.queued", status: "queued", actorType: context.actorType ?? "tool",
      actorName: context.actorName ?? "video_production_create", channel: context.channel ?? "web",
      turnId: context.requestId ?? null, operationId: context.callId ?? null,
      name: "Scripted interaction video queued",
      payload: { videoJobId: jobId, videoScriptId: scriptId, sourceRequestIds: sourceIds },
      subjectType: "video_job", subjectId: String(jobId),
    });
    return jobId;
  }

  create(input, context = {}, { queueRender = false } = {}) {
    if (!context.requestId || !context.requestEventId) {
      throw new Error("Video script creation requires the bound Agent Slayer request");
    }
    const generationRow = this.store.requireReady().prepare(`
      SELECT payload_json FROM activity_events
      WHERE turn_id = ? AND event_type IN (${placeholders(requestTypes)})
      ORDER BY event_seq LIMIT 1
    `).get(context.requestId, ...requestTypes);
    const generationKind = parseJson(generationRow?.payload_json).requestKind;
    if (generationKind === "video_production" && !queueRender) {
      throw new Error("A video-production request must use video_production_create");
    }
    if (generationKind === "video_script" && queueRender) {
      throw new Error("A script-only request must use video_script_create");
    }
    const selectedRows = this.selectionForGenerationRequest(context.requestId);
    const canonicalIds = selectedRows.map(({ turn_id: turnId }) => turnId);
    const suppliedIds = sourceRequestIds(input?.sourceRequestIds);
    if (JSON.stringify(canonicalIds) !== JSON.stringify(suppliedIds)) {
      throw new Error("source_request_ids must exactly match the selected interactions in chronological order");
    }
    const interactions = this.#dialogue(canonicalIds);
    const scenes = interactions.flatMap((interaction, interactionIndex) => [
      {
        sceneNumber: (interactionIndex * 2) + 1,
        durationSeconds: estimatedDialogueSeconds(interaction.request),
        sourceRequestIds: [interaction.requestId],
        renderSceneType: "request",
        visualPrompt: "Show the supplied video-projected user request as the next message in one continuous AI chat.",
        voiceover: interaction.request,
        onScreenText: [interaction.request],
        cameraMotion: null,
        audioNotes: null,
        transition: null,
      },
      {
        sceneNumber: (interactionIndex * 2) + 2,
        durationSeconds: estimatedDialogueSeconds(interaction.response),
        sourceRequestIds: [interaction.requestId],
        renderSceneType: "response",
        visualPrompt: "Show the exact Chapeaux Fous response immediately after the user request.",
        voiceover: interaction.response,
        onScreenText: [interaction.response],
        cameraMotion: null,
        audioNotes: null,
        transition: null,
      },
    ]);
    const durationSeconds = scenes.reduce((total, scene) => total + scene.durationSeconds, 0);
    const plan = {
      schemaVersion: 1,
      title: requiredText(input.title, "Video script title", 200),
      concept: requiredText(input.description ?? input.concept, "Video description", 3_000),
      audience: "Viewers watching a real interaction between a user and an AI agent.",
      durationSeconds,
      aspectRatio: "2:3",
      visualStyle: "One polished, continuous 1080x1620 Chapeaux Fous chat containing only the supplied video-projected dialogue.",
      sourceRequestIds: canonicalIds,
      generatorPrompt: "",
      scenes,
      continuityNotes: ["Keep the messages in chronological order as one continuous conversation."],
      negativeConstraints: ["Show no intermediate activity, reasoning, tools, trace, tutorial, intro, outro, summary, restored technical reference codes, or invented dialogue."],
    };
    plan.generatorPrompt = canonicalGeneratorPrompt(plan, interactions);
    const scriptText = scriptMarkdown(plan, interactions);
    const serialized = JSON.stringify(plan);
    if (serialized.length > 500_000 || scriptText.length > 500_000) {
      throw new Error("The generated video script exceeds the storage limit");
    }
    const database = this.store.requireReady();
    const existing = database.prepare(
      "SELECT video_script_id FROM video_scripts WHERE created_by_event_id = ?",
    ).get(context.requestEventId);
    if (existing) {
      const script = this.get(existing.video_script_id);
      return { created: false, unchanged: true, script, renderQueued: false, render: script.render };
    }
    database.exec("START TRANSACTION");
    try {
      const result = database.prepare(`
        INSERT INTO video_scripts (
          title, status, schema_version, script_json, script_text, created_by_event_id
        ) VALUES (?, 'draft', 1, ?, ?, ?)
      `).run(plan.title, serialized, scriptText, context.requestEventId);
      const scriptId = Number(result.lastInsertRowid);
      const insertSource = database.prepare(`
        INSERT INTO video_script_sources (video_script_id, request_event_id, source_order)
        VALUES (?, ?, ?)
      `);
      selectedRows.forEach((row, index) => insertSource.run(scriptId, row.request_event_id, index + 1));
      this.ledger.append({
        type: "video_script.created", status: "complete", actorType: "tool",
        actorName: context.actorName ?? "video_script_create", channel: context.channel,
        turnId: context.requestId, operationId: context.callId,
        name: "AI-video script created", content: plan.title,
        payload: { videoScriptId: scriptId, sourceRequestIds: canonicalIds, schemaVersion: 1 },
        subjectType: "video_script", subjectId: String(scriptId),
      });
      const renderJobId = queueRender ? this.#insertRenderJob(scriptId, canonicalIds, context) : null;
      database.exec("COMMIT");
      const script = this.get(scriptId);
      return {
        created: true,
        unchanged: false,
        script,
        renderQueued: renderJobId !== null,
        render: script.render,
      };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  queueRender(scriptId, context = {}) {
    const id = positiveInteger(scriptId, "Video script ID");
    const script = this.get(id);
    if (!script) throw Object.assign(new Error("Video script not found"), { statusCode: 404 });
    if (script.plan.scenes.some(({ renderSceneType, voiceover }) => !renderSceneType || !voiceover)) {
      throw Object.assign(
        new Error("This script does not contain the built-in render scene and narration contract"),
        { statusCode: 409 },
      );
    }
    if (script.render && ["queued", "preparing", "rendering"].includes(script.render.status)) {
      return { queued: false, existing: true, script };
    }
    if (script.render?.status === "complete") {
      return { queued: false, existing: true, script };
    }
    const database = this.store.requireReady();
    database.exec("START TRANSACTION");
    try {
      this.#insertRenderJob(id, script.sources.map(({ requestId: sourceId }) => sourceId), {
        ...context,
        actorType: context.actorType ?? "user",
        actorName: context.actorName ?? "web",
      });
      database.exec("COMMIT");
      return { queued: true, existing: false, script: this.get(id) };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  recoverInterruptedRenderJobs() {
    return this.store.requireReady().prepare(`
      UPDATE video_jobs
      SET status = 'queued', started_at_utc = NULL, updated_at_utc = ?,
          error_text = 'Recovered after the prior render worker stopped'
      WHERE status IN ('preparing', 'rendering')
        AND video_script_id IS NOT NULL
        AND renderer = 'remotion'
        AND template = 'agent-ui-story'
      RETURNING video_job_id
    `).all(new Date().toISOString()).map(({ video_job_id: id }) => Number(id));
  }

  claimNextRenderJob() {
    const database = this.store.requireReady();
    const now = new Date().toISOString();
    database.exec("START TRANSACTION");
    try {
      const row = database.prepare(`
        UPDATE video_jobs
        SET status = 'preparing', started_at_utc = COALESCE(started_at_utc, ?),
            updated_at_utc = ?, error_text = NULL
        WHERE video_job_id = (
          SELECT video_job_id FROM video_jobs
          WHERE status = 'queued'
            AND video_script_id IS NOT NULL
            AND renderer = 'remotion'
            AND template = 'agent-ui-story'
          ORDER BY video_job_id LIMIT 1
        ) AND status = 'queued'
        RETURNING *
      `).get(now, now);
      database.exec("COMMIT");
      return row ? { ...publicRender(row), videoScriptId: Number(row.video_script_id) } : null;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  markRenderRunning(jobId) {
    const id = positiveInteger(jobId, "Video job ID");
    const now = new Date().toISOString();
    const row = this.store.requireReady().prepare(`
      UPDATE video_jobs SET status = 'rendering', updated_at_utc = ?
      WHERE video_job_id = ? AND status = 'preparing' RETURNING *
    `).get(now, id);
    if (!row) throw new Error("Video job is no longer preparing");
    return publicRender(row);
  }

  completeRender(jobId, outputFileId, details = {}) {
    const id = positiveInteger(jobId, "Video job ID");
    const fileId = positiveInteger(outputFileId, "Rendered file ID");
    const now = new Date().toISOString();
    const row = this.store.requireReady().prepare(`
      UPDATE video_jobs
      SET status = 'complete', output_file_id = ?, error_text = NULL,
          completed_at_utc = ?, updated_at_utc = ?
      WHERE video_job_id = ? AND status = 'rendering' RETURNING *
    `).get(fileId, now, now, id);
    if (!row) throw new Error("Video job is no longer rendering");
    this.ledger.append({
      type: "video.render.completed", phase: "end", status: "complete", actorType: "service",
      actorName: "Remotion", name: "Scripted interaction video rendered",
      payload: { videoJobId: id, videoScriptId: Number(row.video_script_id), fileId, ...details },
      primaryFileId: fileId, subjectType: "video_job", subjectId: String(id),
    });
    return publicRender(row);
  }

  linkContent(scriptId, contentId, context = {}) {
    const id = positiveInteger(scriptId, "Video script ID");
    const linkedContentId = positiveInteger(contentId, "Content ID");
    const current = this.get(id);
    if (!current) throw Object.assign(new Error("Video script not found"), { statusCode: 404 });
    if (current.render?.status !== "complete" || !current.render.outputFileId) {
      throw Object.assign(new Error("The MP4 must finish rendering before it can be added to content"), { statusCode: 409 });
    }
    if (current.render.contentId === linkedContentId) {
      return { linked: false, unchanged: true, script: current };
    }
    if (current.render.contentId !== null) {
      throw Object.assign(new Error("This video is already linked to a content item"), { statusCode: 409 });
    }
    const database = this.store.requireReady();
    const now = new Date().toISOString();
    database.exec("START TRANSACTION");
    try {
      const row = database.prepare(`
        UPDATE video_jobs SET content_id = ?, updated_at_utc = ?
        WHERE video_job_id = ? AND video_script_id = ?
          AND status = 'complete' AND output_file_id IS NOT NULL AND content_id IS NULL
        RETURNING *
      `).get(linkedContentId, now, current.render.id, id);
      if (!row) throw Object.assign(
        new Error("This video changed before it could be linked to content. Refresh and try again."),
        { statusCode: 409 },
      );
      this.ledger.append({
        type: "video.content.linked", status: "complete",
        actorType: context.actorType ?? "user", actorName: context.actorName ?? "web",
        channel: context.channel ?? "web", turnId: context.requestId ?? null,
        name: "Rendered video linked to content",
        payload: {
          videoScriptId: id, videoJobId: Number(row.video_job_id),
          contentId: linkedContentId, fileId: Number(row.output_file_id),
        },
        primaryFileId: Number(row.output_file_id),
        subjectType: "video_job", subjectId: String(row.video_job_id),
      });
      database.exec("COMMIT");
      return { linked: true, unchanged: false, script: this.get(id) };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  failRender(jobId, error) {
    const id = positiveInteger(jobId, "Video job ID");
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();
    const row = this.store.requireReady().prepare(`
      UPDATE video_jobs
      SET status = 'error', error_text = ?, completed_at_utc = ?, updated_at_utc = ?
      WHERE video_job_id = ? AND status IN ('preparing', 'rendering') RETURNING *
    `).get(message.slice(0, 20_000), now, now, id);
    if (row) this.ledger.append({
      type: "video.render.error", phase: "error", status: "error", actorType: "service",
      actorName: "Remotion", name: "Scripted interaction video failed", error: message,
      payload: { videoJobId: id, videoScriptId: Number(row.video_script_id) },
      subjectType: "video_job", subjectId: String(id),
    });
    return publicRender(row);
  }

  archive(scriptId, expectedVersion, context = {}) {
    const id = positiveInteger(scriptId, "Video script ID");
    const version = positiveInteger(expectedVersion, "Expected video script version");
    const database = this.store.requireReady();
    const current = this.get(id);
    if (!current) throw Object.assign(new Error("Video script not found"), { statusCode: 404 });
    if (current.status === "archived") return { archived: false, alreadyArchived: true, script: current };
    const now = new Date().toISOString();
    database.exec("START TRANSACTION");
    try {
      const row = database.prepare(`
        UPDATE video_scripts
        SET status = 'archived', archived_at_utc = ?, updated_at_utc = ?, version = version + 1
        WHERE video_script_id = ? AND version = ?
        RETURNING video_script_id
      `).get(now, now, id, version);
      if (!row) throw Object.assign(
        new Error("This video script changed after it was read. Refresh and try again."),
        { statusCode: 409 },
      );
      this.ledger.append({
        type: "video_script.archived", status: "complete",
        actorType: context.actorType ?? "user", actorName: context.actorName ?? "web",
        channel: context.channel ?? "web", turnId: context.requestId ?? null,
        name: "AI-video script archived", content: current.title,
        payload: { videoScriptId: id }, subjectType: "video_script", subjectId: String(id),
      });
      database.exec("COMMIT");
      return { archived: true, alreadyArchived: false, script: this.get(id) };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
