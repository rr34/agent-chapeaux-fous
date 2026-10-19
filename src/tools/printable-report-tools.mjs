import { toolMetadataWithDescription } from "../tool-description.mjs";

const columnSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    label: {
      type: "string", minLength: 1, maxLength: 120,
      description: "Human-facing column label. Labels must be unique within the section.",
    },
    align: {
      type: "string", enum: ["left", "center", "right"],
      description: "Printed alignment for this column.",
    },
  },
  required: ["label", "align"],
};

const rowSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    cells: {
      type: "array", minItems: 1, maxItems: 8,
      items: { type: "string", maxLength: 5_000 },
      description: "Cell text in the exact order of the section columns. The owning function requires exactly one cell per column.",
    },
    note: {
      type: ["string", "null"], maxLength: 2_000,
      description: "Optional secondary text printed with this row, or null.",
    },
    source_refs: {
      type: "array", maxItems: 20, uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 1_000 },
      description: "Stable references for exact first-class objects supporting this row. Every supplied reference must have a verified binding in this execution. Use an empty array for user-provided or agent-composed rows without object provenance.",
    },
  },
  required: ["cells", "note", "source_refs"],
};

const sectionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    heading: {
      type: ["string", "null"], maxLength: 200,
      description: "Optional section heading, or null.",
    },
    description: {
      type: ["string", "null"], maxLength: 2_000,
      description: "Optional explanatory section text, or null.",
    },
    presentation: {
      type: "string", enum: ["table", "list", "checklist"],
      description: "Physical presentation. Tables repeat column headings; lists show the first cell as the primary line and remaining columns as labeled metadata; checklists add an empty checkbox.",
    },
    columns: {
      type: "array", minItems: 1, maxItems: 8, items: columnSchema,
      description: "One through eight ordered columns shared by every row in this section.",
    },
    rows: {
      type: "array", maxItems: 500, items: rowSchema,
      description: "Zero through five hundred rows. Across all sections, the report may contain at most one thousand rows.",
    },
  },
  required: ["heading", "description", "presentation", "columns", "rows"],
};

const fileSchema = {
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
  required: [
    "fileId", "ref", "title", "originalFilename", "mimeType", "byteSize",
    "sourceEventSeqs", "downloadUrl",
  ],
};

export function registerPrintableReportTools(registry, service) {
  registry = registry.withCapability?.("printable-report") ?? registry;
  registry.register({
    name: "printable_report_generate",
    title: "Generate printable report",
    metadata: toolMetadataWithDescription(null, {
      summary: "Render and durably store one bounded printable PDF from already gathered report rows, with optional verified first-class object provenance.",
      actionClasses: ["CREATE"],
      effectClassifications: ["MUTATING"],
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description: "Generate and durably store one general printable PDF from an explicit, bounded report model of at most 500,000 total characters. Supply the final title, physical layout, and one or more table, list, or checklist sections after the owning domain tools have returned the requested information. This function does not search, query, infer, refresh, or mutate source-domain records. It renders text exactly as supplied through application-owned templates; it never accepts arbitrary HTML, CSS, scripts, remote URLs, or images. A row may cite stable first-class object references only when their complete verified bindings are present in the current execution; those references are used for provenance and never authorize another action. Rows without object provenance are allowed and are counted as unsourced, including user-provided text and agent-composed suggestions. On success, status is complete, the item and provenance counts describe the rendered snapshot, pageCount proves a readable nonempty PDF, and file is the stored first-class PDF binding with its download path. Rendering, validation, provenance, or storage failure returns an error and no successful generation result.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: {
          type: "string", minLength: 1, maxLength: 200,
          description: "Human-facing document title and stored file title.",
        },
        subtitle: {
          type: ["string", "null"], maxLength: 400,
          description: "Optional subtitle printed below the title, or null.",
        },
        description: {
          type: ["string", "null"], maxLength: 2_000,
          description: "Optional introductory text that explains scope, filters, omissions, or uncertainty, or null.",
        },
        paper_size: {
          type: "string", enum: ["letter", "a4"],
          description: "Physical paper size.",
        },
        orientation: {
          type: "string", enum: ["portrait", "landscape"],
          description: "Physical page orientation. Use landscape for wide tables when helpful.",
        },
        show_source_appendix: {
          type: "boolean",
          description: "Whether to append human-facing names and stable references for the verified source objects cited by rows.",
        },
        sections: {
          type: "array", minItems: 1, maxItems: 20, items: sectionSchema,
          description: "One through twenty ordered printable sections.",
        },
      },
      required: [
        "title", "subtitle", "description", "paper_size", "orientation",
        "show_source_appendix", "sections",
      ],
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string", const: "complete",
          description: "Complete means a readable nonempty PDF was rendered and registered as a durable native file.",
        },
        paperSize: { type: "string", enum: ["letter", "a4"] },
        orientation: { type: "string", enum: ["portrait", "landscape"] },
        sectionCount: { type: "integer", minimum: 1, maximum: 20 },
        rowCount: { type: "integer", minimum: 0, maximum: 1_000 },
        sourcedRowCount: {
          type: "integer", minimum: 0, maximum: 1_000,
          description: "Rows citing at least one verified first-class object binding.",
        },
        unsourcedRowCount: {
          type: "integer", minimum: 0, maximum: 1_000,
          description: "Rows without first-class object provenance; this may include user-provided or agent-composed content.",
        },
        sourceObjectCount: {
          type: "integer", minimum: 0, maximum: 2_000,
          description: "Distinct verified first-class objects cited across all rows.",
        },
        contentSourceEventSeqs: {
          type: "array", uniqueItems: true,
          items: { type: "integer", minimum: 1 },
          description: "Durable source-event evidence carried by the exact object bindings used in report rows.",
        },
        pageCount: {
          type: "integer", minimum: 1,
          description: "Number of pages parsed from the rendered PDF before storage was reported complete.",
        },
        file: fileSchema,
      },
      required: [
        "status", "paperSize", "orientation", "sectionCount", "rowCount",
        "sourcedRowCount", "unsourcedRowCount", "sourceObjectCount",
        "contentSourceEventSeqs", "pageCount", "file",
      ],
    },
    async execute(input, context = {}) {
      const result = await service.generate(input, {
        ...context,
        actorType: "tool",
        actorName: "printable_report_generate",
      });
      return {
        status: "complete",
        paperSize: result.model.paperSize,
        orientation: result.model.orientation,
        sectionCount: result.model.sectionCount,
        rowCount: result.model.rowCount,
        sourcedRowCount: result.model.sourcedRowCount,
        unsourcedRowCount: result.model.unsourcedRowCount,
        sourceObjectCount: result.model.sourceObjectCount,
        contentSourceEventSeqs: result.model.sourceEventSeqs,
        pageCount: result.pageCount,
        file: result.file,
      };
    },
  });
}
