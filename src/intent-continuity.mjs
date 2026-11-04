function outcomeRef(action, outcome) {
  return `${action.actionId}.${outcome.outcomeId}`;
}

export function intentOutcomes(core) {
  return (core?.actions ?? []).flatMap((action) => (
    (action.outcomes ?? action.outcomeObjects ?? []).map((outcome) => ({
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

function createResources(toolDefinition, { singletonOnly = false } = {}) {
  if (!toolDefinition) return [];
  return (toolDefinition.capability?.resources ?? []).flatMap((resource) => {
    const operation = resource.operations?.create;
    if (resource.kind !== "object" || operation?.available !== true
      || operation.tool !== toolDefinition.name
      || (singletonOnly && operation.batch !== "singleton")) return [];
    return [{ objectType: resource.id, count: 1, batch: operation.batch }];
  });
}

function mutationResourceTypes(toolDefinition) {
  if (!toolDefinition) return new Set();
  return new Set((toolDefinition.capability?.resources ?? []).flatMap((resource) => (
    Object.entries(resource.operations ?? {}).some(([operation, contract]) => (
      operation !== "read" && contract?.available === true && contract.tool === toolDefinition.name
    )) ? [resource.id] : []
  )));
}

function requestOutcomes(core) {
  return intentOutcomes(core)
    .filter(({ cardinality }) => cardinality?.basis === "request");
}

export function matchIntentOutcomes(
  core,
  objectReferenceGroups,
  toolDefinition = null,
  explicitOutcomeEvidenceGroups = null,
) {
  const observedByType = groupsByType(objectReferenceGroups);
  const outcomeEvidenceByType = explicitOutcomeEvidenceGroups === null
    ? null
    : groupsByType(explicitOutcomeEvidenceGroups);
  const bindableByType = outcomeEvidenceByType ?? observedByType;
  const outcomes = requestOutcomes(core);
  const bindings = [];

  for (const outcome of outcomes.filter(({ targetRefs }) => targetRefs.length > 0)) {
    for (const [objectType, observed] of bindableByType) {
      const objectRefs = outcome.targetRefs.filter((ref) => observed.has(ref));
      if (objectRefs.length > 0) {
        bindings.push({
          outcomeRef: outcome.ref,
          objectType,
          ...(outcomeEvidenceByType ? { objectRefs } : {}),
        });
      }
    }
  }

  const unbound = outcomes.filter(({ targetRefs }) => targetRefs.length === 0);
  if (unbound.length === 1) {
    if (outcomeEvidenceByType) {
      const evidenceTypes = [...outcomeEvidenceByType.entries()]
        .filter(([, refs]) => refs.size > 0);
      if (evidenceTypes.length === 1) {
        const [[objectType, refs]] = evidenceTypes;
        bindings.push({
          outcomeRef: unbound[0].ref,
          objectType,
          objectRefs: [...refs],
        });
      }
    } else {
      const observedTypes = [...observedByType.keys()];
      const declaredMutationTypes = mutationResourceTypes(toolDefinition);
      const contractMatches = observedTypes.filter((objectType) => declaredMutationTypes.has(objectType));
      const authoritativeTypes = contractMatches.length === 1
        ? contractMatches
        : observedTypes.length === 1 ? observedTypes : [];
      if (authoritativeTypes.length === 1) {
        bindings.push({ outcomeRef: unbound[0].ref, objectType: authoritativeTypes[0] });
      }
    }
  }

  const uniqueBindings = [...new Map(bindings.map((binding) => (
    [`${binding.outcomeRef}\n${binding.objectType}`, binding]
  ))).values()];
  return {
    outcomeRefs: [...new Set(uniqueBindings.map(({ outcomeRef: ref }) => ref))],
    bindings: uniqueBindings,
  };
}

export function matchingIntentOutcomeRefs(core, objectReferenceGroups, toolDefinition = null) {
  return matchIntentOutcomes(core, objectReferenceGroups, toolDefinition).outcomeRefs;
}

export function intentCreateEffects(toolDefinition) {
  return createResources(toolDefinition, { singletonOnly: true });
}

function receiptOutcomeBindings(receipt) {
  if (receipt.intentOutcomeBindings?.length) return receipt.intentOutcomeBindings;
  const types = [...groupsByType(receipt.objectReferences).keys()];
  if (types.length !== 1) return [];
  return (receipt.intentOutcomeRefs ?? []).map((ref) => ({
    outcomeRef: ref,
    objectType: types[0],
  }));
}

export function intentPreflightProblems({ core, calls, toolDefinitions, receipts = [] }) {
  const outcomes = requestOutcomes(core)
    .filter(({ targetRefs }) => targetRefs.length === 0);
  if (outcomes.length === 0 || outcomes.some(({ cardinality }) => cardinality.maximum === null)) {
    return [];
  }

  const effectsByCall = new Map();
  const proposedByType = new Map();
  for (const call of calls ?? []) {
    const effects = createResources(toolDefinitions.get(call.tool), { singletonOnly: true });
    effectsByCall.set(call.callId, effects);
    for (const effect of effects) {
      proposedByType.set(effect.objectType, (proposedByType.get(effect.objectType) ?? 0) + effect.count);
    }
  }
  if (proposedByType.size !== 1) return [];

  const [[objectType, proposed]] = proposedByType;
  const outcomeRefs = new Set(outcomes.map(({ ref }) => ref));
  const maximum = outcomes.reduce((sum, outcome) => sum + outcome.cardinality.maximum, 0);
  let consumed = 0;
  for (const receipt of receipts) {
    if (receipt?.ok !== true) continue;
    const bindings = receiptOutcomeBindings(receipt)
      .filter((binding) => binding.objectType === objectType && outcomeRefs.has(binding.outcomeRef));
    if (bindings.length === 0) continue;
    consumed += (receipt.intentCreateEffects ?? [])
      .filter((effect) => effect.objectType === objectType)
      .reduce((sum, effect) => sum + effect.count, 0);
  }
  const total = consumed + proposed;
  if (total <= maximum) return [];

  return (calls ?? []).flatMap((call) => {
    if (!(effectsByCall.get(call.callId) ?? []).some((effect) => effect.objectType === objectType)) {
      return [];
    }
    return [{
      callId: call.callId,
      code: "INTENT_OUTCOME_CREATE_OVERSHOOT",
      outcomeRefs: [...outcomeRefs],
      message: `The accepted semantic outcomes allow at most ${maximum} created object${maximum === 1 ? "" : "s"}, but this sibling call set would bring the ${objectType} create count to ${total}. Re-express the same accepted action without creating extra results.`,
    }];
  });
}

export function intentOutcomeFindings({ core, receipts, registry }) {
  const outcomes = requestOutcomes(core);
  if (outcomes.length === 0) return [];
  const outcomeByRef = new Map(outcomes.map((outcome) => [outcome.ref, outcome]));
  const observedByOutcome = new Map(outcomes.map(({ ref }) => [ref, new Set()]));
  const typesByOutcome = new Map(outcomes.map(({ ref }) => [ref, new Set()]));
  let unboundMutationEvidence = false;

  for (const receipt of receipts ?? []) {
    if (receipt?.ok !== true) continue;
    if (registry.get(receipt.tool)?.annotations?.readOnlyHint === true) continue;
    const grouped = groupsByType(receipt.objectReferences);
    const bindings = receiptOutcomeBindings(receipt)
      .filter(({ outcomeRef: ref }) => outcomeByRef.has(ref));
    if (bindings.length === 0 && grouped.size > 0) unboundMutationEvidence = true;
    for (const { outcomeRef: ref, objectType, objectRefs } of bindings) {
      typesByOutcome.get(ref).add(objectType);
      const observed = observedByOutcome.get(ref);
      const boundRefs = Array.isArray(objectRefs) ? objectRefs : grouped.get(objectType) ?? [];
      for (const objectRef of boundRefs) observed.add(objectRef);
    }
  }

  const unboundOutcomes = outcomes.filter(({ targetRefs }) => targetRefs.length === 0);
  const findings = [];
  if (unboundOutcomes.length > 1 && unboundMutationEvidence) {
    findings.push({
      code: "INTENT_OUTCOME_EVIDENCE_AMBIGUOUS",
      auditOnly: true,
      outcomeRefs: unboundOutcomes.map(({ ref }) => ref),
      message: "Successful mutation evidence contains created or changed objects, but several accepted semantic outcomes could correspond to them and execution produced no unambiguous outcome binding. Semantic audit must compare the exact actions, calls, results, and owning contracts.",
    });
  }

  for (const outcome of outcomes) {
    const boundObjectTypes = [...typesByOutcome.get(outcome.ref)];
    if (boundObjectTypes.length > 1) {
      findings.push({
        code: "INTENT_OUTCOME_REPRESENTATION_AMBIGUOUS",
        auditOnly: true,
        outcomeRefs: [outcome.ref],
        boundObjectTypes,
        message: `Execution bound ${outcome.ref} to several resource types (${boundObjectTypes.join(", ")}). Semantic audit must verify which receipts represent the requested result.`,
      });
      continue;
    }
    if (outcome.targetRefs.length === 0 && unboundOutcomes.length > 1) continue;
    const observed = observedByOutcome.get(outcome.ref)?.size ?? 0;
    const { minimum, maximum } = outcome.cardinality;
    const below = observed < minimum;
    const above = maximum !== null && observed > maximum;
    if (!below && !above) continue;
    const expected = maximum === minimum
      ? String(minimum)
      : `${minimum}..${maximum ?? "many"}`;
    const direction = below ? "fewer" : "more";
    findings.push({
      code: below
        ? "INTENT_OUTCOME_EVIDENCE_INCOMPLETE"
        : "INTENT_OUTCOME_EVIDENCE_EXCESS",
      auditOnly: true,
      ...(boundObjectTypes.length === 1 ? { objectType: boundObjectTypes[0] } : {}),
      boundObjectTypes,
      outcomeRefs: [outcome.ref],
      expected,
      observed,
      message: `The accepted semantic outcome names ${expected} requested result${expected === "1" ? "" : "s"} for ${outcome.ref}, while mechanically connected successful mutation results expose ${observed}. This is ${direction} correlated object evidence, not proof that the requested work failed; semantic audit must compare the exact bound calls, arguments, results, and owning contracts.`,
    });
  }
  return findings;
}
