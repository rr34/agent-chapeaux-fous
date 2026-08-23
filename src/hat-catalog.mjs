import fs from "node:fs/promises";

const identifierPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const capabilityPattern = /^(?:[a-z0-9]+(?:-[a-z0-9]+)*|integration:[A-Za-z0-9_-]+)$/u;

function requiredText(value, label, maximumLength = 1000) {
  const selected = typeof value === "string" ? value.trim() : "";
  if (!selected) throw new Error(`${label} is required`);
  if (selected.length > maximumLength) throw new Error(`${label} is too long`);
  return selected;
}

function normalizedAlias(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/[\s-]+/gu, " ");
}

function escapedAlias(value) {
  return value
    .replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
    .replace(/[ -]+/gu, "[\\s-]+");
}

function uniqueAliases(hat) {
  const aliases = [hat.label, hat.id, ...(Array.isArray(hat.aliases) ? hat.aliases : [])]
    .map(normalizedAlias)
    .filter(Boolean);
  return [...new Set(aliases)];
}

export class HatCatalog {
  constructor(document) {
    if (!document || typeof document !== "object" || Array.isArray(document)) {
      throw new Error("Hat catalog must be a JSON object");
    }
    if (document.version !== 1) throw new Error("Hat catalog version must be 1");
    this.version = document.version;
    this.invocationTemplate = requiredText(document.invocationTemplate, "Hat invocation template", 500);
    const manual = document.manual;
    if (!manual || typeof manual !== "object" || Array.isArray(manual)) {
      throw new Error("Hat catalog manual is required");
    }
    this.manual = Object.freeze({
      title: requiredText(manual.title, "Hat manual title", 200),
      introduction: requiredText(manual.introduction, "Hat manual introduction", 2000),
      destinationRule: requiredText(manual.destinationRule, "Hat destination rule", 2000),
      multipleRule: requiredText(manual.multipleRule, "Hat multiple-hat rule", 2000),
    });
    if (!Array.isArray(document.hats) || document.hats.length === 0) {
      throw new Error("Hat catalog must contain at least one hat");
    }
    const ids = new Set();
    const aliases = new Map();
    this.hats = Object.freeze(document.hats.map((entry, index) => {
      const id = requiredText(entry?.id, `Hat ${index + 1} id`, 80);
      if (!identifierPattern.test(id)) throw new Error(`Hat id is invalid: ${id}`);
      if (ids.has(id)) throw new Error(`Duplicate hat id: ${id}`);
      ids.add(id);
      const capability = requiredText(entry.capability, `Hat ${id} capability`, 120);
      if (!capabilityPattern.test(capability)) throw new Error(`Hat ${id} capability is invalid`);
      const hat = {
        id,
        label: requiredText(entry.label, `Hat ${id} label`, 100),
        icon: requiredText(entry.icon ?? id, `Hat ${id} icon`, 80),
        aliases: Array.isArray(entry.aliases)
          ? entry.aliases.map((alias) => requiredText(alias, `Hat ${id} alias`, 100))
          : [],
        capability,
        description: requiredText(entry.description, `Hat ${id} description`, 2000),
        example: requiredText(entry.example, `Hat ${id} example`, 2000),
      };
      if (!identifierPattern.test(hat.icon)) throw new Error(`Hat ${id} icon is invalid`);
      for (const alias of uniqueAliases(hat)) {
        const existing = aliases.get(alias);
        if (existing && existing !== id) throw new Error(`Hat alias "${alias}" belongs to both ${existing} and ${id}`);
        aliases.set(alias, id);
      }
      return Object.freeze(hat);
    }));
    this.byId = new Map(this.hats.map((hat) => [hat.id, hat]));
    this.aliasToId = aliases;
    const alternatives = [...aliases.keys()].sort((left, right) => right.length - left.length).map(escapedAlias);
    this.aliasSource = `(?:${alternatives.join("|")})`;
    this.firstHatPattern = new RegExp(`\\bas\\s+my\\s+(${this.aliasSource})(?=$|[\\s,.!?;:])`, "giu");
  }

  explicitHats(text) {
    const source = String(text ?? "").normalize("NFKC");
    const matches = [];
    const seen = new Set();
    this.firstHatPattern.lastIndex = 0;
    for (let match = this.firstHatPattern.exec(source); match; match = this.firstHatPattern.exec(source)) {
      const append = (rawAlias, index) => {
        const id = this.aliasToId.get(normalizedAlias(rawAlias));
        if (!id || seen.has(id)) return;
        seen.add(id);
        matches.push({ ...this.byId.get(id), spokenAs: rawAlias, index });
      };
      append(match[1], match.index);
    }
    return matches.sort((left, right) => left.index - right.index);
  }

  publicManual(tools, capabilityForTool) {
    const grouped = new Map();
    for (const tool of tools) {
      const capability = capabilityForTool(tool);
      const entries = grouped.get(capability) ?? [];
      entries.push({ name: tool.name, description: tool.description ?? "" });
      grouped.set(capability, entries);
    }
    return {
      version: this.version,
      invocationTemplate: this.invocationTemplate,
      manual: this.manual,
      hats: this.hats.map((hat) => {
        const matchingTools = grouped.get(hat.capability) ?? [];
        return {
          ...hat,
          available: matchingTools.length > 0,
          toolCount: matchingTools.length,
          tools: matchingTools,
        };
      }),
    };
  }
}

export async function loadHatCatalog(filename) {
  let document;
  try {
    document = JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    throw new Error(`Could not load hat catalog ${filename}: ${error.message}`);
  }
  return new HatCatalog(document);
}
