import { toolMetadataWithDescription } from "../tool-description.mjs";

export function registerDailyPaperTools(registry, service) {
  registry = registry.withCapability?.("daily-paper") ?? registry;
  registry.register({
    name: "daily_paper_generate",
    title: "Generate daily paper",
    metadata: toolMetadataWithDescription(null, {
      summary: "Generate and store one printable daily PDF with a fixed 05:00–23:00 timeline, current forecast when available, calendar details, linked work, pinned to-do groups, and scheduled trackers. This creates a snapshot; it does not update source records.",
      actionClasses: ["CREATE"],
      effectClassifications: ["MUTATING"],
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description: "Generate and durably store one printable PDF for an exact local calendar date. Read the authoritative Monday-to-Sunday two-week calendar range, the selected day's events, to-dos linked to those events, every active to-do group pinned to the daily paper with all of its open tasks, and active journal trackers whose asking RRULE has a logging period containing that date. The first page plots timed events proportionally on a fixed 05:00–23:00 vertical scale and includes a compact Open-Meteo forecast aligned to that scale when the active default location resolves and the date is inside the forecast window. A details page preserves event notes, linked work, trackers, pinned groups, and handwriting space. Preserve empty pinned groups as writable checklist sections and deduplicate tasks by stable ID. Mark a tracker logged when an observation exists in its period. Exclude completed linked to-dos unless includeCompletedTodos is true; pinning does not include completed group history. Forecast failure or an unsupported forecast date omits or marks weather without blocking the document. On success, status is complete and file is the stored first-class PDF binding with its download path; the counts describe the included events, distinct printed to-dos, and trackers. The operation does not change calendar, to-do, or journal data. Validation, rendering, or storage failure returns an error and no successful generation result.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "Exact local calendar date to print, formatted YYYY-MM-DD.",
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
        date: { type: "string", description: "Exact local date represented by the daily timeline." },
        timeZone: { type: "string", description: "IANA time zone used to determine the local day." },
        paperSize: {
          type: "string", enum: ["letter", "a4"],
          description: "Physical page size used by the PDF renderer.",
        },
        eventCount: {
          type: "integer", minimum: 0,
          description: "Number of events included in the selected day's timeline.",
        },
        todoCount: {
          type: "integer", minimum: 0,
          description: "Number of distinct to-dos included from the selected day and pinned groups.",
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
        eventCount: result.model.todayEvents.length,
        todoCount: result.model.scheduledTodos.length + result.model.printableTodoGroups.reduce(
          (count, group) => count + group.todos.length, 0,
        ),
        trackerCount: result.model.scheduledTrackers.length,
        file: result.file,
      };
    },
  });
}
