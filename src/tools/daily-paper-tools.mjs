import { toolMetadataWithDescription } from "../tool-description.mjs";

export function registerDailyPaperTools(registry, service) {
  registry = registry.withCapability?.("daily-paper") ?? registry;
  registry.register({
    name: "daily_paper_generate",
    title: "Generate weekly paper",
    metadata: toolMetadataWithDescription(null, {
      summary: "Generate and store one printable PDF with an event-only two-week calendar followed by current-week event-linked to-do cards and pinned to-do groups. This creates a snapshot; it does not update source records.",
      actionClasses: ["CREATE"],
      effectClassifications: ["MUTATING"],
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Generate and durably store one printable PDF headed for the Monday-to-Sunday week containing an exact local calendar date. Render an event-only calendar for that week followed by the next week. Beneath the calendar, render only full-width to-do cards: every distinct open to-do linked to an event in the headed week, plus every active pinned group and its remaining open tasks. Preserve empty pinned groups as writable checklist sections, deduplicate tasks by stable ID, and remove headed-week scheduled tasks from their pinned group lists. Exclude completed linked to-dos unless includeCompletedTodos is true; pinning does not include completed group history. The selected date identifies the headed week and does not create a separate daily-plan section. On success, status is complete and file is the stored first-class PDF binding with its download path; the counts describe both displayed weeks' event appearances, distinct printed to-dos, and trackers queried for compatibility. The operation does not change calendar, to-do, or journal data. Validation, rendering, or storage failure returns an error and no successful generation result.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "Exact local calendar date whose Monday-to-Sunday week will be printed, formatted YYYY-MM-DD.",
        },
        timeZone: {
          type: "string",
          minLength: 1,
          maxLength: 100,
          description: "IANA time zone defining the printed local day.",
        },
        paperSize: {
          type: "string",
          enum: ["letter", "a4"],
          description: "Physical paper size.",
        },
        includeCompletedTodos: {
          type: "boolean",
          description: "Whether completed to-dos linked to today’s events remain visible.",
        },
      },
      required: ["date", "timeZone", "paperSize", "includeCompletedTodos"],
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string", const: "complete",
          description: "Complete means the PDF was rendered and registered as a durable native file.",
        },
        date: { type: "string", description: "Exact local date used to select the printed week." },
        timeZone: { type: "string", description: "IANA time zone used to determine the local day." },
        paperSize: {
          type: "string", enum: ["letter", "a4"],
          description: "Physical page size used by the PDF renderer.",
        },
        eventCount: {
          type: "integer", minimum: 0,
          description: "Number of event appearances included across the printed week.",
        },
        todoCount: {
          type: "integer", minimum: 0,
          description: "Number of distinct to-dos included from the selected week and pinned groups.",
        },
        trackerCount: {
          type: "integer", minimum: 0,
          description: "Number of scheduled journal trackers included on the page.",
        },
        file: {
          type: "object",
          additionalProperties: false,
          description: "Durable first-class native file created for the printable PDF.",
          properties: {
            fileId: { type: "integer", minimum: 1, description: "Stable native file ID." },
            ref: { type: "string", description: "Stable Agent Slayer file reference." },
            title: { type: "string", description: "Human-facing document title." },
            originalFilename: { type: ["string", "null"], description: "Download filename." },
            mimeType: { type: ["string", "null"], description: "Stored media type; application/pdf for this tool." },
            byteSize: { type: ["integer", "null"], description: "Stored PDF size in bytes." },
            sourceEventSeqs: {
              type: "array",
              items: { type: "integer", minimum: 1 },
              description: "Durable generation activity evidence associated with the stored file.",
            },
            downloadUrl: { type: "string", description: "Authenticated application path for downloading the PDF." },
          },
          required: ["fileId", "ref", "title", "originalFilename", "mimeType", "byteSize", "sourceEventSeqs", "downloadUrl"],
        },
      },
      required: ["status", "date", "timeZone", "paperSize", "eventCount", "todoCount", "trackerCount", "file"],
    },
    async execute(input, context = {}) {
      const result = await service.generate(input, {
        ...context,
        actorType: "tool",
        actorName: "daily_paper_generate",
      });
      return {
        status: "complete",
        date: result.model.date,
        timeZone: result.model.timeZone,
        paperSize: result.model.paperSize,
        eventCount: result.model.printCalendarDays.reduce((count, day) => count + day.events.length, 0),
        todoCount: result.model.scheduledTodos.length + result.model.printableTodoGroups.reduce(
          (count, group) => count + group.todos.length, 0,
        ),
        trackerCount: result.model.scheduledTrackers.length,
        file: result.file,
      };
    },
  });
}
