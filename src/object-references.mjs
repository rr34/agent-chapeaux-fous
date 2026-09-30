import { objectDescriptionMetadataKey } from "./object-description.mjs";
import { firstClassObjectBindingProblem } from "./first-class-object-binding.mjs";
import {
  nativeFirstClassObjectTypes, nativeObjectTypeForSearchType,
} from "./native-object-types.mjs";

const maximumObjectsPerBinding = 500;
const maximumTraversalNodes = 20_000;
const defaultObjectBindingRole = "subject";

function compactScalar(value, maximum = 300) {
  if (!["string", "number", "boolean"].includes(typeof value)) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maximum) : null;
}

function objectRole(value) {
  const role = compactScalar(value, 160);
  return role && /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/u.test(role)
    ? role
    : defaultObjectBindingRole;
}

function recordObjectRole(record) {
  if (!Object.hasOwn(record ?? {}, "objectRole")) return defaultObjectBindingRole;
  const role = compactScalar(record.objectRole, 160);
  return role && /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/u.test(role) ? role : null;
}

function nativeId(value) {
  if (Number.isSafeInteger(value)) return value;
  if (typeof value !== "string") return null;
  return compactScalar(value, 500);
}

function canonicalId(value, type = null) {
  if (type?.idKind === "integer") {
    if (Number.isSafeInteger(value) && value > 0) return value;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  if (type?.idKind === "string") {
    return typeof value === "string" ? compactScalar(value, 500) : null;
  }
  return nativeId(value);
}

function firstDisplay(record, fields) {
  for (const field of fields) {
    const value = compactScalar(record?.[field]);
    if (value) return value;
  }
  return null;
}

function firstId(record, fields, type) {
  for (const field of fields) {
    const id = canonicalId(record?.[field], type);
    if (id != null) return id;
  }
  return null;
}

function firstReference(record, fields) {
  for (const field of fields) {
    const reference = compactScalar(record?.[field], 1_000);
    if (reference) return reference;
  }
  return null;
}

function walkRecords(value, visit, state = { remaining: maximumTraversalNodes }, depth = 0) {
  if (value == null || depth > 8 || state.remaining <= 0) return;
  state.remaining -= 1;
  if (Array.isArray(value)) {
    for (const item of value) walkRecords(item, visit, state, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  visit(value);
  for (const child of Object.values(value)) walkRecords(child, visit, state, depth + 1);
}

function remoteObjectTypes(toolDefinition, toolDefinitions) {
  const source = toolDefinition?.source;
  if (typeof source !== "string" || !source.startsWith("mcp:")) return [];
  const direct = toolDefinition?.metadata?.[objectDescriptionMetadataKey]?.types ?? [];
  if (direct.length) return direct.map((type) => ({ ...type, source, requireObjectType: false }));
  const seen = new Set();
  const result = [];
  for (const tool of toolDefinitions ?? [toolDefinition]) {
    if (tool?.source !== source) continue;
    for (const type of tool.metadata?.[objectDescriptionMetadataKey]?.types ?? []) {
      if (seen.has(type.id)) continue;
      seen.add(type.id);
      result.push({ ...type, source, requireObjectType: true });
    }
  }
  return result;
}

function remoteIdentity(record, type) {
  return type.identity?.field ? nativeId(record?.[type.identity.field]) : null;
}

function remoteReferences(toolDefinition, toolDefinitions, result, sourceEventSeq) {
  const groups = [];
  for (const type of remoteObjectTypes(toolDefinition, toolDefinitions)) {
    const byRole = new Map();
    walkRecords(result, (record) => {
      if (type.requireObjectType && record?.objectType !== type.id) return;
      const reference = compactScalar(record?.[type.reference.field], 1_000);
      const display = compactScalar(record?.[type.display.field], 500);
      if (!reference || !display) return;
      const id = remoteIdentity(record, type);
      const role = recordObjectRole(record);
      if (!role) return;
      const byRef = byRole.get(role) ?? new Map();
      if (id != null && !byRef.has(reference)) byRef.set(reference, { id, ref: reference, display });
      byRole.set(role, byRef);
    });
    for (const [role, byRef] of byRole) {
      const objects = [...byRef.values()].slice(0, maximumObjectsPerBinding);
      if (objects.length) groups.push({
        mention: `${type.title} returned by ${toolDefinition.name}`,
        role,
        type: type.id,
        source: type.source,
        objects,
        sourceEventSeqs: sourceEventSeq == null ? [] : [sourceEventSeq],
      });
    }
  }
  return groups;
}

function nativeReferences(toolDefinition, result, sourceEventSeq) {
  if (toolDefinition?.source !== "local") return [];
  const byType = new Map(nativeFirstClassObjectTypes.map((type) => [type.id, new Map()]));
  const add = (type, record, object) => {
    const role = recordObjectRole(record);
    if (!role) return;
    const byRole = byType.get(type.id);
    const byRef = byRole.get(role) ?? new Map();
    if (!byRef.has(object.ref)) byRef.set(object.ref, object);
    byRole.set(role, byRef);
  };
  walkRecords(result, (record) => {
    const searchType = nativeObjectTypeForSearchType(record?.type);
    if (searchType) {
      const id = canonicalId(record.id, searchType);
      const display = compactScalar(record.display ?? record.title, 500);
      if (id != null && display) {
        const ref = `${searchType.refPrefix}${encodeURIComponent(String(id))}`;
        add(searchType, record, { id, ref, display });
      }
    }
    for (const type of nativeFirstClassObjectTypes) {
      const id = firstId(record, type.idFields, type);
      const display = firstDisplay(record, type.displayFields);
      if (id == null || !display) continue;
      const ref = firstReference(record, type.refFields)
        ?? `${type.refPrefix}${encodeURIComponent(String(id))}`;
      add(type, record, { id, ref, display });
    }
  });
  const groups = [];
  for (const type of nativeFirstClassObjectTypes) {
    for (const [role, byRef] of byType.get(type.id)) {
      const objects = [...byRef.values()].slice(0, maximumObjectsPerBinding);
      if (objects.length) groups.push({
        mention: `${type.title} returned by ${toolDefinition.name}`,
        role,
        type: type.id,
        source: type.source,
        objects,
        sourceEventSeqs: sourceEventSeq == null ? [] : [sourceEventSeq],
      });
    }
  }
  return groups;
}

export function objectReferenceGroupsFromToolResult({
  toolDefinition, toolDefinitions = [], result, sourceEventSeq = null,
}) {
  if (!toolDefinition || result == null) return [];
  const remote = remoteReferences(toolDefinition, toolDefinitions, result, sourceEventSeq);
  return normalizeObjectReferenceGroups(
    remote.length ? remote : nativeReferences(toolDefinition, result, sourceEventSeq),
  );
}

export function objectReferenceProtectedFields(toolDefinition, toolDefinitions = []) {
  const sameSource = [toolDefinition, ...toolDefinitions].filter((candidate, index, values) => (
    candidate?.source === toolDefinition?.source && values.indexOf(candidate) === index
  ));
  const described = sameSource.flatMap((candidate) => (
    candidate?.metadata?.[objectDescriptionMetadataKey]?.types ?? []
  ));
  const native = toolDefinition?.source === "local" ? nativeFirstClassObjectTypes : [];
  return [...new Set(["objectRole", ...[...described, ...native]
    .flatMap((type) => [
      type.identity?.field, type.reference?.field, type.display?.field,
      ...(type.idFields ?? []), ...(type.refFields ?? []), ...(type.displayFields ?? []),
    ])
    .filter(Boolean)])];
}

function normalizedObject(value, type = null) {
  const id = canonicalId(value?.id, type);
  const ref = compactScalar(value?.ref, 1_000);
  const display = compactScalar(value?.display, 500);
  return id == null || !ref || !display ? null : { id, ref, display };
}

export function normalizeObjectReferenceGroups(groups, { maximumObjects = 2_000 } = {}) {
  const output = [];
  let remaining = maximumObjects;
  for (const group of groups ?? []) {
    if (remaining <= 0) break;
    const type = compactScalar(group?.type, 120);
    const source = compactScalar(group?.source, 200);
    const mention = compactScalar(group?.mention, 500);
    const role = objectRole(group?.role);
    if (!type || !source || !mention || !Array.isArray(group?.objects)) continue;
    const byRef = new Map();
    const nativeType = nativeFirstClassObjectTypes.find((candidate) => candidate.id === type) ?? null;
    for (const value of group.objects) {
      const object = normalizedObject(value, nativeType);
      if (!object || byRef.has(object.ref)) continue;
      byRef.set(object.ref, object);
      if (byRef.size >= Math.min(remaining, maximumObjectsPerBinding)) break;
    }
    const objects = [...byRef.values()];
    if (!objects.length) continue;
    const sourceEventSeqs = [...new Set((group.sourceEventSeqs ?? [])
      .filter((value) => Number.isSafeInteger(value) && value > 0))].slice(0, 40);
    const binding = { mention, role, type, source, objects, sourceEventSeqs };
    if (firstClassObjectBindingProblem(binding)) continue;
    output.push(binding);
    remaining -= objects.length;
  }
  return output;
}

export function mergeObjectReferenceGroups(groups) {
  const merged = new Map();
  for (const group of normalizeObjectReferenceGroups(groups)) {
    const key = `${group.role}\n${group.type}\n${group.source}`;
    const current = merged.get(key) ?? {
      mention: group.mention, role: group.role, type: group.type, source: group.source,
      objects: new Map(), sourceEventSeqs: new Set(),
    };
    for (const object of group.objects) current.objects.set(object.ref, object);
    for (const seq of group.sourceEventSeqs) current.sourceEventSeqs.add(seq);
    merged.set(key, current);
  }
  return normalizeObjectReferenceGroups([...merged.values()].map((group) => ({
    mention: group.mention,
    role: group.role,
    type: group.type,
    source: group.source,
    objects: [...group.objects.values()].slice(0, maximumObjectsPerBinding),
    sourceEventSeqs: [...group.sourceEventSeqs].sort((left, right) => left - right),
  })));
}

export function flatObjectReferences(groups) {
  return normalizeObjectReferenceGroups(groups).flatMap((group) => group.objects.map((object) => ({
    role: group.role, type: group.type, source: group.source,
    ...object, sourceEventSeqs: group.sourceEventSeqs,
  })));
}

export function compactObjectReferenceContext(groups) {
  return normalizeObjectReferenceGroups(groups).map((group) => ({
    mention: group.mention,
    role: group.role,
    type: group.type,
    source: group.source,
    objects: group.objects.map(({ id, ref, display }) => ({ id, ref, display })),
    sourceEventSeqs: group.sourceEventSeqs,
  }));
}

export function objectReferenceSelectionFindings(selectedGroups, availableGroups, allowedRoles = null) {
  const available = new Map(flatObjectReferences(availableGroups).map((object) => [object.ref, object]));
  const roles = allowedRoles === null ? null : new Set(allowedRoles);
  const seen = new Set();
  const findings = [];
  for (const [groupIndex, group] of (selectedGroups ?? []).entries()) {
    const role = objectRole(group?.role);
    if (roles && !roles.has(role)) {
      findings.push({
        code: "object_reference_role_not_available",
        path: `brief.objectReferences[${groupIndex}].role`,
        message: `${role} is not an object role published by a selected tool`,
      });
    }
    const expectedEventSeqs = new Set();
    for (const [objectIndex, object] of (group.objects ?? []).entries()) {
      const path = `brief.objectReferences[${groupIndex}].objects[${objectIndex}]`;
      const expected = available.get(object.ref);
      if (!expected) {
        findings.push({ code: "object_reference_not_available", path, message: `${object.ref} is not an exact verified object reference supplied to orientation` });
        continue;
      }
      for (const seq of expected?.sourceEventSeqs ?? []) expectedEventSeqs.add(seq);
      const selectionKey = `${role}\n${object.ref}`;
      if (seen.has(selectionKey)) {
        findings.push({ code: "duplicate_object_reference", path, message: `${object.ref} is selected more than once for role ${role}` });
      }
      seen.add(selectionKey);
      if (group.type !== expected.type || group.source !== expected.source
        || object.id !== expected.id || object.display !== expected.display) {
        findings.push({ code: "object_reference_mismatch", path, message: `${object.ref} must retain its exact type, source, ID, and display name` });
      }
    }
    const suppliedEventSeqs = [...new Set(group.sourceEventSeqs ?? [])].sort((left, right) => left - right);
    const exactEventSeqs = [...expectedEventSeqs].sort((left, right) => left - right);
    if (JSON.stringify(suppliedEventSeqs) !== JSON.stringify(exactEventSeqs)) {
      findings.push({
        code: "object_reference_evidence_mismatch",
        path: `brief.objectReferences[${groupIndex}].sourceEventSeqs`,
        message: `${group.type} must retain the exact source event numbers for its selected objects`,
      });
    }
  }
  return findings;
}
