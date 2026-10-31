function outcomeRef(action, outcome) {
  return `${action.actionId}.${outcome.outcomeId}`;
}

export function intentOutcomes(core) {
  return (core?.actions ?? []).flatMap((action) => (
    (action.outcomeObjects ?? []).map((outcome) => ({
      ...outcome,
      actionId: action.actionId,
      ref: outcomeRef(action, outcome),
    }))
  ));
}

function groupsByType(groups) {
  const byType = new Map();
  for (const group of groups ?? []) {
    const refs = byType.get(group.type) ?? new Set();
    for (const object of group.objects ?? []) {
      if (object?.ref) refs.add(object.ref);
    }
    byType.set(group.type, refs);
  }
  return byType;
}

export function matchingIntentOutcomeRefs(core, objectReferenceGroups) {
  const observedByType = groupsByType(objectReferenceGroups);
  const outcomes = intentOutcomes(core);
  const unboundCounts = new Map();
  for (const outcome of outcomes) {
    if (outcome.targetRefs.length === 0) {
      unboundCounts.set(outcome.objectType, (unboundCounts.get(outcome.objectType) ?? 0) + 1);
    }
  }
  return outcomes.flatMap((outcome) => {
    const observed = observedByType.get(outcome.objectType) ?? new Set();
    if (outcome.targetRefs.length > 0) {
      return outcome.targetRefs.some((ref) => observed.has(ref)) ? [outcome.ref] : [];
    }
    return unboundCounts.get(outcome.objectType) === 1 && observed.size > 0 ? [outcome.ref] : [];
  });
}

function explicitBoundsByType(core) {
  const bounds = new Map();
  for (const outcome of intentOutcomes(core)) {
    if (outcome.cardinality?.basis !== "request") continue;
    const current = bounds.get(outcome.objectType) ?? {
      objectType: outcome.objectType,
      minimum: 0,
      maximum: 0,
      outcomeRefs: [],
    };
    current.minimum += outcome.cardinality.minimum;
    current.maximum = current.maximum === null || outcome.cardinality.maximum === null
      ? null
      : current.maximum + outcome.cardinality.maximum;
    current.outcomeRefs.push(outcome.ref);
    bounds.set(outcome.objectType, current);
  }
  return bounds;
}

function toolCreateEffects(toolDefinition) {
  if (!toolDefinition) return [];
  return (toolDefinition.capability?.resources ?? []).flatMap((resource) => {
    const operation = resource.operations?.create;
    if (resource.kind !== "object" || operation?.available !== true
      || operation.tool !== toolDefinition.name || operation.batch !== "singleton") return [];
    return [{ objectType: resource.id, count: 1 }];
  });
}

export function intentCreateEffects(toolDefinition) {
  return toolCreateEffects(toolDefinition);
}

export function intentPreflightProblems({ core, calls, toolDefinitions, receipts = [] }) {
  const bounds = explicitBoundsByType(core);
  if (bounds.size === 0) return [];
  const consumed = new Map();
  for (const receipt of receipts) {
    if (receipt?.ok !== true) continue;
    for (const effect of receipt.intentCreateEffects ?? []) {
      consumed.set(effect.objectType, (consumed.get(effect.objectType) ?? 0) + effect.count);
    }
  }
  const proposed = new Map();
  const effectsByCall = new Map();
  for (const call of calls ?? []) {
    const effects = toolCreateEffects(toolDefinitions.get(call.tool));
    effectsByCall.set(call.callId, effects);
    for (const effect of effects) {
      proposed.set(effect.objectType, (proposed.get(effect.objectType) ?? 0) + effect.count);
    }
  }
  const exceeded = new Map();
  for (const [objectType, count] of proposed) {
    const bound = bounds.get(objectType);
    if (!bound || bound.maximum === null) continue;
    const total = (consumed.get(objectType) ?? 0) + count;
    if (total > bound.maximum) exceeded.set(objectType, { ...bound, proposed: total });
  }
  if (exceeded.size === 0) return [];
  return (calls ?? []).flatMap((call) => {
    const conflict = (effectsByCall.get(call.callId) ?? [])
      .map(({ objectType }) => exceeded.get(objectType))
      .find(Boolean);
    if (!conflict) return [];
    return [{
      callId: call.callId,
      code: "INTENT_OUTCOME_CREATE_OVERSHOOT",
      outcomeRefs: conflict.outcomeRefs,
      message: `The accepted final state allows at most ${conflict.maximum} ${conflict.objectType} outcome object${conflict.maximum === 1 ? "" : "s"}, but this sibling call set would create ${conflict.proposed}. Re-express the same accepted action without creating extra first-class objects.`,
    }];
  });
}

export function intentOutcomeFindings({ core, receipts, registry }) {
  const outcomes = intentOutcomes(core)
    .filter(({ cardinality }) => cardinality?.basis === "request");
  if (outcomes.length === 0) return [];
  const outcomeByRef = new Map(outcomes.map((outcome) => [outcome.ref, outcome]));
  const observedByOutcome = new Map(outcomes.map(({ ref }) => [ref, new Set()]));
  const unboundCounts = new Map();
  for (const outcome of outcomes) {
    if (outcome.targetRefs.length === 0) {
      unboundCounts.set(outcome.objectType, (unboundCounts.get(outcome.objectType) ?? 0) + 1);
    }
  }
  const unconnectedTypes = new Set();
  for (const receipt of receipts ?? []) {
    if (receipt?.ok !== true) continue;
    if (registry.get(receipt.tool)?.annotations?.readOnlyHint === true) continue;
    const grouped = groupsByType(receipt.objectReferences);
    const connectedRefs = (receipt.intentOutcomeRefs ?? [])
      .filter((ref) => outcomeByRef.has(ref));
    for (const ref of connectedRefs) {
      const outcome = outcomeByRef.get(ref);
      const observed = observedByOutcome.get(ref);
      for (const objectRef of grouped.get(outcome.objectType) ?? []) observed.add(objectRef);
    }
    for (const type of grouped.keys()) {
      if (unboundCounts.get(type) > 1
        && !connectedRefs.some((ref) => outcomeByRef.get(ref).objectType === type)) {
        unconnectedTypes.add(type);
      }
    }
  }
  const findings = [...unconnectedTypes].map((objectType) => ({
    code: "INTENT_OUTCOME_EVIDENCE_AMBIGUOUS",
    auditOnly: true,
    objectType,
    outcomeRefs: outcomes.filter((outcome) => outcome.objectType === objectType)
      .map(({ ref }) => ref),
    message: `Successful mutation evidence contains ${objectType} objects, but several accepted outcome roles share that type and no exact target identity distinguishes them. Semantic audit must verify the final-state correspondence.`,
  }));
  for (const outcome of outcomes) {
    if (outcome.targetRefs.length === 0 && unboundCounts.get(outcome.objectType) > 1) continue;
    const observed = observedByOutcome.get(outcome.ref)?.size ?? 0;
    const { minimum, maximum } = outcome.cardinality;
    const below = observed < minimum;
    const above = maximum !== null && observed > maximum;
    if (!below && !above) continue;
    const expected = maximum === minimum
      ? String(minimum)
      : `${minimum}..${maximum ?? "many"}`;
    findings.push({
      code: "INTENT_OUTCOME_CARDINALITY_MISMATCH",
      auditOnly: false,
      objectType: outcome.objectType,
      outcomeRefs: [outcome.ref],
      expected,
      observed,
      message: `The accepted final state expects ${expected} ${outcome.objectType} object${expected === "1" ? "" : "s"} for ${outcome.ref}, but connected successful mutation receipts identify ${observed}.`,
      repairInstruction: "Satisfy the same accepted outcome identities without creating unrelated replacement objects or discarding requested composition.",
    });
  }
  return findings;
}
