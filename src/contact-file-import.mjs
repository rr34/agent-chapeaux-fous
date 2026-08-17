import { createHash } from "node:crypto";
import path from "node:path";

const maximumContacts = 10_000;
const maximumColumns = 500;

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"' && value === "") quoted = true;
    else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  if (quoted) throw new Error("CSV attachment has an unterminated quoted field");
  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function textValue(value) {
  const selected = String(value ?? "").trim();
  return selected || null;
}

function joinedName(...values) {
  return values.map(textValue).filter(Boolean).join(" ") || null;
}

function splitTags(value, separator) {
  const selected = textValue(value);
  if (!selected) return [];
  return (separator ? selected.split(separator) : [selected]).map((tag) => tag.trim()).filter(Boolean);
}

function uniqueStrings(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stableRowHash(headers, row) {
  const canonical = headers.map((header, index) => [header, row[index] ?? ""]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function normalizedCsvBirthDate(value) {
  const selected = textValue(value);
  if (!selected) return null;
  if (/^\d{8}$/.test(selected)) return `${selected.slice(0, 4)}-${selected.slice(4, 6)}-${selected.slice(6)}`;
  const dated = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(selected);
  if (dated) return `${dated[3]}-${dated[1].padStart(2, "0")}-${dated[2].padStart(2, "0")}`;
  const partial = /^(\d{1,2})\/(\d{1,2})$/.exec(selected);
  if (partial) return `--${partial[1].padStart(2, "0")}-${partial[2].padStart(2, "0")}`;
  return selected;
}

function csvContacts(text, mapping) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("CSV attachment must contain a header and at least one contact row");
  const headers = rows[0].map((header) => String(header).trim());
  if (headers.length > maximumColumns) throw new Error(`CSV attachment exceeds ${maximumColumns} columns`);
  if (headers.some((header) => !header)) throw new Error("CSV attachment contains a blank header");
  if (new Set(headers).size !== headers.length) throw new Error("CSV attachment contains duplicate headers");
  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const referencedColumns = [
    mapping.external_id_column,
    mapping.display_name_column,
    mapping.given_name_column,
    mapping.family_name_column,
    mapping.organization_name_column,
    mapping.birth_date_column,
    ...mapping.notes_columns,
    ...mapping.tag_columns,
    ...mapping.methods.map(({ column }) => column),
  ].filter(Boolean);
  const missing = [...new Set(referencedColumns)].filter((column) => !headerIndex.has(column));
  if (missing.length) throw new Error(`CSV mapping references missing columns: ${missing.join(", ")}`);
  const get = (row, column) => column ? textValue(row[headerIndex.get(column)]) : null;
  const entries = [];
  const hashOccurrences = new Map();
  let blankRows = 0;
  for (const [dataIndex, row] of rows.slice(1).entries()) {
    if (row.every((cell) => !textValue(cell))) {
      blankRows += 1;
      continue;
    }
    if (entries.length >= maximumContacts) throw new Error(`Contact file exceeds ${maximumContacts} contacts`);
    const methods = [];
    const methodKeys = new Set();
    for (const method of mapping.methods) {
      const value = get(row, method.column);
      if (!value) continue;
      const key = `${method.method_kind}\u0000${value.toLocaleLowerCase()}`;
      if (methodKeys.has(key)) continue;
      methodKeys.add(key);
      methods.push({
        method_kind: method.method_kind,
        label: method.label,
        value,
        is_primary: method.is_primary,
        can_receive: method.can_receive,
      });
    }
    const notes = mapping.notes_columns.map((column) => get(row, column)).filter(Boolean);
    const tags = uniqueStrings([
      ...mapping.default_tags,
      ...mapping.tag_columns.flatMap((column) => splitTags(get(row, column), mapping.tag_separator)),
    ]);
    const givenName = get(row, mapping.given_name_column);
    const familyName = get(row, mapping.family_name_column);
    const organizationName = get(row, mapping.organization_name_column);
    const displayName = get(row, mapping.display_name_column)
      ?? joinedName(givenName, familyName)
      ?? organizationName
      ?? methods[0]?.value
      ?? `Contact ${dataIndex + 1}`;
    const sourceId = get(row, mapping.external_id_column);
    const rowHash = stableRowHash(headers, row);
    const hashOccurrence = (hashOccurrences.get(rowHash) ?? 0) + 1;
    hashOccurrences.set(rowHash, hashOccurrence);
    const generatedId = mapping.external_id_strategy === "row_number"
      ? `${mapping.external_id_prefix}${dataIndex + 1}`
      : `${mapping.external_id_prefix}${rowHash}${hashOccurrence === 1 ? "" : `-${hashOccurrence}`}`;
    entries.push({
      external_id: sourceId ?? generatedId,
      contact_kind: mapping.default_contact_kind,
      display_name: displayName,
      given_name: givenName,
      family_name: familyName,
      organization_name: organizationName,
      status: mapping.default_status,
      birth_date: normalizedCsvBirthDate(get(row, mapping.birth_date_column)),
      notes: notes.join("\n") || null,
      methods,
      tags,
    });
  }
  if (entries.length === 0) throw new Error("CSV attachment contains no nonblank contact rows");
  return { entries, headers, blankRows };
}

function unescapedVcardValue(value) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function splitEscaped(value, separator) {
  const result = [];
  let selected = "";
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      selected += `\\${character}`;
      escaped = false;
    } else if (character === "\\") escaped = true;
    else if (character === separator) {
      result.push(unescapedVcardValue(selected));
      selected = "";
    } else selected += character;
  }
  if (escaped) selected += "\\";
  result.push(unescapedVcardValue(selected));
  return result;
}

function vcardProperties(block) {
  return block.slice(1, -1).flatMap((line) => {
    const colon = line.indexOf(":");
    if (colon < 1) return [];
    const descriptor = line.slice(0, colon).split(";");
    const name = descriptor.shift().toUpperCase().split(".").at(-1);
    const parameters = new Map();
    for (const parameter of descriptor) {
      const equals = parameter.indexOf("=");
      if (equals === -1) parameters.set("TYPE", [...(parameters.get("TYPE") ?? []), parameter]);
      else {
        const key = parameter.slice(0, equals).toUpperCase();
        parameters.set(key, parameter.slice(equals + 1).split(","));
      }
    }
    return [{ name, parameters, value: line.slice(colon + 1) }];
  });
}

function vcardLabel(property) {
  return uniqueStrings(property.parameters.get("TYPE") ?? []).join(", ") || null;
}

function normalizedVcardBirthDate(value) {
  const selected = unescapedVcardValue(value);
  if (/^\d{8}$/.test(selected)) return `${selected.slice(0, 4)}-${selected.slice(4, 6)}-${selected.slice(6)}`;
  if (/^--\d{4}$/.test(selected)) return `--${selected.slice(2, 4)}-${selected.slice(4)}`;
  return selected || null;
}

function vcardContacts(text, defaultTags) {
  const physicalLines = text.split(/\r\n|\n|\r/);
  const lines = [];
  for (const line of physicalLines) {
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (line.toUpperCase() === "BEGIN:VCARD") current = [line];
    else if (current) {
      current.push(line);
      if (line.toUpperCase() === "END:VCARD") {
        blocks.push(current);
        current = null;
      }
    }
  }
  if (current) throw new Error("vCard attachment contains an unterminated VCARD block");
  if (blocks.length === 0) throw new Error("vCard attachment contains no VCARD blocks");
  if (blocks.length > maximumContacts) throw new Error(`Contact file exceeds ${maximumContacts} contacts`);
  const entries = blocks.map((block, index) => {
    const properties = vcardProperties(block);
    const first = (name) => properties.find((property) => property.name === name);
    const all = (name) => properties.filter((property) => property.name === name);
    const structuredName = first("N") ? splitEscaped(first("N").value, ";") : [];
    const familyName = textValue(structuredName[0]);
    const givenName = textValue(structuredName[1]);
    const organizationName = first("ORG")
      ? splitEscaped(first("ORG").value, ";").filter(Boolean).join(" / ") || null
      : null;
    const methods = [];
    const methodKeys = new Set();
    const addMethods = (propertyName, methodKind, { canReceive = false, structured = false } = {}) => {
      for (const property of all(propertyName)) {
        const value = structured
          ? splitEscaped(property.value, ";").filter(Boolean).join(", ")
          : unescapedVcardValue(property.value).replace(/^mailto:/i, "").replace(/^tel:/i, "");
        if (!value) continue;
        const key = `${methodKind}\u0000${value.toLocaleLowerCase()}`;
        if (methodKeys.has(key)) continue;
        methodKeys.add(key);
        const types = (property.parameters.get("TYPE") ?? []).map((type) => type.toLowerCase());
        methods.push({
          method_kind: methodKind,
          label: vcardLabel(property),
          value,
          is_primary: property.parameters.has("PREF") || types.includes("pref"),
          can_receive: canReceive,
        });
      }
    };
    addMethods("EMAIL", "email", { canReceive: true });
    addMethods("TEL", "phone", { canReceive: true });
    addMethods("ADR", "postal_address", { structured: true });
    addMethods("URL", "url");
    addMethods("IMPP", "handle", { canReceive: true });
    const notes = all("NOTE").map(({ value }) => unescapedVcardValue(value)).filter(Boolean);
    const tags = uniqueStrings([
      ...defaultTags,
      ...all("CATEGORIES").flatMap(({ value }) => splitEscaped(value, ",")).filter(Boolean),
    ]);
    const fullName = first("FN") ? unescapedVcardValue(first("FN").value) : null;
    const uid = first("UID") ? unescapedVcardValue(first("UID").value) : null;
    const kind = first("KIND") ? unescapedVcardValue(first("KIND").value).toLowerCase() : null;
    return {
      external_id: uid || createHash("sha256").update(block.join("\r\n")).digest("hex"),
      contact_kind: kind === "org" || kind === "organization" || (!givenName && !familyName && organizationName)
        ? "organization"
        : "person",
      display_name: fullName ?? joinedName(givenName, familyName) ?? organizationName ?? methods[0]?.value ?? `Contact ${index + 1}`,
      given_name: givenName,
      family_name: familyName,
      organization_name: organizationName,
      status: "active",
      birth_date: first("BDAY") ? normalizedVcardBirthDate(first("BDAY").value) : null,
      notes: notes.join("\n") || null,
      methods,
      tags,
    };
  });
  return { entries, headers: null, blankRows: 0 };
}

export function parseContactAttachment(attachment, { format = "auto", csvMapping = null, defaultTags = [] } = {}) {
  const extension = path.extname(String(attachment?.filename ?? "")).toLowerCase();
  const selectedFormat = format === "auto" ? (extension === ".vcf" ? "vcard" : "csv") : format;
  if (selectedFormat === "csv") {
    if (!csvMapping) throw new Error("CSV contact import requires csv_mapping");
    return {
      format: selectedFormat,
      ...csvContacts(String(attachment?.text ?? ""), { ...csvMapping, default_tags: defaultTags }),
    };
  }
  if (selectedFormat === "vcard") {
    return { format: selectedFormat, ...vcardContacts(String(attachment?.text ?? ""), defaultTags) };
  }
  throw new Error("Contact file format must be auto, csv, or vcard");
}
