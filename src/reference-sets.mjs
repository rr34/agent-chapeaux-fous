import { createHash } from "node:crypto";
import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { flatObjectReferences, normalizeObjectReferenceGroups } from "./object-references.mjs";

export const referenceSetProtocol = "agent-slayer.reference-set";
export const referenceSetVersion = 1;

const schema = JSON.parse(fs.readFileSync(
  new URL("../config/protocol-schemas/reference-set.v1.schema.json", import.meta.url), "utf8",
));
const validateSchema = new Ajv2020({ allErrors: true }).compile(schema);

function stableSetRef(kind, value) {
  const digest = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
  return `agent-slayer://reference-sets/${kind}/${digest}`;
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function edgeKey(edge) {
  return `${edge.fromRef}\u0000${edge.toRef}`;
}

export function validateReferenceSet(value, { label = "reference set" } = {}) {
  if (!validateSchema(value)) {
    const problem = validateSchema.errors?.[0];
    throw new Error(`${label} is invalid: ${problem?.instancePath || "/"} ${problem?.message}`);
  }
  if (value.kind === "relationship_set") {
    const keys = value.edges.map(edgeKey);
    if (new Set(keys).size !== keys.length) {
      throw new Error(`${label} contains a duplicate directed relationship`);
    }
  }
  return value;
}

export function mergeReferenceSets(sets = []) {
  const byRef = new Map();
  for (const candidate of sets) {
    if (!candidate) continue;
    const value = validateReferenceSet(structuredClone(candidate));
    const existing = byRef.get(value.ref);
    if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new Error(`Reference set ${value.ref} has conflicting definitions`);
    }
    byRef.set(value.ref, value);
  }
  return [...byRef.values()];
}

export function objectReferenceSets(groups = []) {
  return normalizeObjectReferenceGroups(groups).flatMap((group) => {
    const memberRefs = sortedUnique(group.objects.map(({ ref }) => ref));
    if (memberRefs.length < 2 || !(group.sourceEventSeqs ?? []).length) return [];
    const identity = {
      kind: "object_set",
      display: group.mention,
      type: group.type,
      source: group.source,
      memberRefs,
      sourceEventSeqs: sortedUnique(group.sourceEventSeqs),
    };
    return [{
      protocol: referenceSetProtocol,
      version: referenceSetVersion,
      kind: "object_set",
      ref: stableSetRef("objects", identity),
      display: group.mention,
      memberRefs,
      sourceEventSeqs: sortedUnique(group.sourceEventSeqs),
    }];
  });
}

export function compactReferenceSets(sets = []) {
  return mergeReferenceSets(sets).map((set) => {
    const { protocol, version, sourceEventSeqs, ...compact } = set;
    return { ...compact, sourceEventSeqs };
  });
}

function localSetPrefix(requestId, kind) {
  return `agent-slayer://requests/${encodeURIComponent(requestId)}/${kind}/`;
}

export function orientationReferenceSetProblem(core, {
  requestId, availableSets = [], availableObjectReferences = [],
} = {}) {
  const objects = new Map(flatObjectReferences(availableObjectReferences)
    .map((object) => [object.ref, object]));
  const sets = new Map(mergeReferenceSets(availableSets).map((set) => [set.ref, set]));
  const localSets = [
    ...(core.objectSets ?? []).map((set) => ({ ...set, kind: "object_set" })),
    ...(core.relationshipSets ?? []).map((set) => ({ ...set, kind: "relationship_set" })),
  ];
  for (const set of localSets) {
    const expectedPrefix = localSetPrefix(
      requestId,
      set.kind === "object_set" ? "object-sets" : "relationship-sets",
    );
    if (!set.ref.startsWith(expectedPrefix) || set.ref.length === expectedPrefix.length) {
      return `${set.kind} ref must be request-local under ${expectedPrefix}`;
    }
    if (sets.has(set.ref)) return `Reference set ${set.ref} is defined more than once`;
    const endpointRefs = set.kind === "object_set"
      ? set.memberRefs
      : set.edges.flatMap(({ fromRef, toRef }) => [fromRef, toRef]);
    const unknown = endpointRefs.find((ref) => !objects.has(ref));
    if (unknown) return `${set.ref} contains unavailable object reference ${unknown}`;
    if (set.kind === "relationship_set") {
      const keys = set.edges.map(edgeKey);
      if (new Set(keys).size !== keys.length) {
        return `${set.ref} contains a duplicate directed relationship`;
      }
    }
    sets.set(set.ref, set);
  }
  for (const action of core.actions ?? []) {
    for (const ref of [...(action.targetSetRefs ?? []), ...(action.relationshipSetRefs ?? [])]) {
      const set = sets.get(ref);
      if (!set) return `Action references unavailable set ${ref}`;
      if (action.targetSetRefs?.includes(ref) && set.kind !== "object_set") {
        return `Action targetSetRefs contains non-object set ${ref}`;
      }
      if (action.relationshipSetRefs?.includes(ref) && set.kind !== "relationship_set") {
        return `Action relationshipSetRefs contains non-relationship set ${ref}`;
      }
    }
  }
  return null;
}

export function selectedReferenceSets(core, {
  requestId, requestEventSeq, availableSets = [], availableObjectReferences = [],
} = {}) {
  const problem = orientationReferenceSetProblem(core, {
    requestId, availableSets, availableObjectReferences,
  });
  if (problem) throw new Error(problem);
  const objects = new Map(flatObjectReferences(availableObjectReferences)
    .map((object) => [object.ref, object]));
  const local = [
    ...(core.objectSets ?? []).map((set) => ({ ...set, kind: "object_set" })),
    ...(core.relationshipSets ?? []).map((set) => ({ ...set, kind: "relationship_set" })),
  ].map((set) => {
    const refs = set.kind === "object_set"
      ? set.memberRefs
      : set.edges.flatMap(({ fromRef, toRef }) => [fromRef, toRef]);
    const sourceEventSeqs = sortedUnique([
      ...(Number.isSafeInteger(requestEventSeq) ? [requestEventSeq] : []),
      ...refs.flatMap((ref) => objects.get(ref)?.sourceEventSeqs ?? []),
    ]);
    return validateReferenceSet({
      protocol: referenceSetProtocol,
      version: referenceSetVersion,
      ...set,
      sourceEventSeqs,
    });
  });
  const all = new Map(mergeReferenceSets([...availableSets, ...local]).map((set) => [set.ref, set]));
  const selectedRefs = new Set((core.actions ?? []).flatMap((action) => [
    ...(action.targetSetRefs ?? []), ...(action.relationshipSetRefs ?? []),
  ]));
  return mergeReferenceSets([...selectedRefs].map((ref) => all.get(ref)));
}

export function referenceSetObjectRefs(sets = []) {
  return sortedUnique(mergeReferenceSets(sets).flatMap((set) => (
    set.kind === "object_set"
      ? set.memberRefs
      : set.edges.flatMap(({ fromRef, toRef }) => [fromRef, toRef])
  )));
}

export function recordedReferenceSets({
  requestId, objectSets = [], relationshipSets = [], availableObjectReferences = [],
} = {}) {
  const objects = new Map(flatObjectReferences(availableObjectReferences)
    .map((object) => [object.ref, object]));
  const definitions = [
    ...objectSets.map((set) => ({
      kind: "object_set",
      display: set.display,
      memberRefs: set.memberRefs,
    })),
    ...relationshipSets.map((set) => ({
      kind: "relationship_set",
      display: set.display,
      relationshipType: set.relationshipType,
      edges: set.edges,
    })),
  ];
  if (!definitions.length) throw new Error("At least one object or relationship set is required");
  return mergeReferenceSets(definitions.map((set) => {
    const refs = set.kind === "object_set"
      ? set.memberRefs
      : set.edges.flatMap(({ fromRef, toRef }) => [fromRef, toRef]);
    const unknown = refs.find((ref) => !objects.has(ref));
    if (unknown) throw new Error(`Reference set contains unverified object reference ${unknown}`);
    if (set.kind === "relationship_set") {
      const keys = set.edges.map(edgeKey);
      if (new Set(keys).size !== keys.length) {
        throw new Error("Reference set contains a duplicate directed relationship");
      }
    }
    const identity = set.kind === "object_set"
      ? { kind: set.kind, display: set.display, memberRefs: sortedUnique(set.memberRefs) }
      : { kind: set.kind, display: set.display, relationshipType: set.relationshipType, edges: set.edges };
    const suffix = createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24);
    const sourceEventSeqs = sortedUnique(refs.flatMap((ref) => objects.get(ref).sourceEventSeqs ?? []));
    return validateReferenceSet({
      protocol: referenceSetProtocol,
      version: referenceSetVersion,
      ...set,
      ...(set.kind === "object_set" ? { memberRefs: sortedUnique(set.memberRefs) } : {}),
      ref: `${localSetPrefix(
        requestId,
        set.kind === "object_set" ? "object-sets" : "relationship-sets",
      )}${suffix}`,
      sourceEventSeqs,
    });
  }));
}
