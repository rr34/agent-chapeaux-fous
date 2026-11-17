function compactMapping(mapping) {
  return {
    fromRole: mapping.fromRole,
    toRole: mapping.toRole,
    shape: mapping.shape,
    coverage: mapping.coverage,
    preserveMemberBoundaries: mapping.preserveMemberBoundaries,
  };
}

function compactRole(role) {
  return {
    role: role.role,
    multiplicity: role.multiplicity,
    ...(role.containerRole ? { containerRole: role.containerRole } : {}),
    ...(role.sameCountAs ? { sameCountAs: role.sameCountAs } : {}),
  };
}

function compactRequestedAction(action) {
  return {
    actionId: action.actionId,
    instruction: action.instruction,
    semanticRoles: (action.semanticRoles ?? []).map(compactRole),
    mappings: (action.mappings ?? []).map(compactMapping),
  };
}

function compactObjectReferences(receipts) {
  const objects = new Map();
  for (const receipt of receipts) {
    if (!receipt?.ok) continue;
    for (const group of receipt.objectReferences ?? []) {
      for (const object of group.objects ?? []) {
        if (!object?.ref) continue;
        objects.set(object.ref, {
          type: group.type,
          ref: object.ref,
          ...(object.display ? { display: object.display } : {}),
        });
      }
    }
  }
  return [...objects.values()];
}

function compactObservedReceipt(receipt) {
  const objectReferenceCount = (receipt.objectReferences ?? []).reduce(
    (count, group) => count + (group.objects ?? []).length,
    0,
  );
  return {
    ...(Number.isSafeInteger(receipt.receiptEventSeq)
      ? { receiptEventSeq: receipt.receiptEventSeq }
      : {}),
    tool: receipt.tool,
    ok: receipt.ok === true,
    ...(objectReferenceCount ? { objectReferenceCount } : {}),
    ...((receipt.intentOutcomeRefs ?? []).length
      ? { intentOutcomeRefs: [...receipt.intentOutcomeRefs] }
      : {}),
    ...((receipt.intentCreateEffects ?? []).length ? {
      createEffects: receipt.intentCreateEffects.map(({ objectType, count, batch }) => ({
        objectType, count, batch,
      })),
    } : {}),
    ...(receipt.ok === false && receipt.error
      ? { error: String(receipt.error).slice(0, 500) }
      : {}),
  };
}

function uniqueCauses(causes) {
  const seen = new Set();
  return causes.filter((cause) => {
    const key = JSON.stringify([
      cause.code, cause.message, cause.tool ?? null, cause.receiptEventSeq ?? null,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compactFinding(finding) {
  return {
    code: finding.code ?? "UNCLASSIFIED_FINDING",
    message: finding.message ?? finding.summary ?? String(finding),
    status: finding.status ?? "active",
  };
}

export function createIntentState({ requestId, core }) {
  return {
    version: 1,
    requestId,
    requested: {
      objective: core.objective,
      mode: core.mode,
      actions: (core.actions ?? []).map(compactRequestedAction),
      constraints: [...(core.constraints ?? [])],
    },
    observed: {
      stage: "orientation",
      receipts: [],
    },
    current: {
      status: "not_observed",
      objectReferences: [],
    },
    remaining: {
      status: core.mode === "act" && (core.actions ?? []).length ? "pending_execution" : "pending_response",
      items: (core.actions ?? []).map(({ actionId, instruction }) => ({ actionId, instruction })),
    },
    cause: [],
  };
}

export function observeIntentState(state, { stage, receipts = [], findings = [] }) {
  const observedReceipts = receipts.map(compactObservedReceipt);
  const causes = uniqueCauses([
    ...state.cause,
    ...receipts.filter(({ ok }) => ok === false).map((receipt) => ({
      code: receipt.toolFailure?.code ?? "TOOL_CALL_FAILED",
      message: receipt.error ? String(receipt.error).slice(0, 500) : `${receipt.tool} failed`,
      status: "active",
      ...(receipt.tool ? { tool: receipt.tool } : {}),
      ...(Number.isSafeInteger(receipt.receiptEventSeq)
        ? { receiptEventSeq: receipt.receiptEventSeq }
        : {}),
    })),
    ...findings.map(compactFinding),
  ]);
  const objectReferences = compactObjectReferences(receipts);
  const lastReceiptEventSeq = receipts.reduce((maximum, receipt) => (
    Number.isSafeInteger(receipt.receiptEventSeq)
      ? Math.max(maximum, receipt.receiptEventSeq)
      : maximum
  ), 0);
  return {
    ...state,
    observed: {
      stage,
      receipts: observedReceipts,
    },
    current: {
      status: observedReceipts.length ? "evidenced_pending_reconciliation" : "not_observed",
      ...(lastReceiptEventSeq ? { asOfReceiptEventSeq: lastReceiptEventSeq } : {}),
      objectReferences,
    },
    remaining: {
      status: "pending_reconciliation",
      items: findings.map(compactFinding),
    },
    cause: causes,
  };
}

export function reconcileIntentState(state, {
  stage,
  outcome,
  remaining = [],
  causes = [],
}) {
  const complete = outcome === "complete";
  return {
    ...state,
    observed: { ...state.observed, stage },
    current: {
      ...state.current,
      status: complete ? "evidenced_complete" : "evidenced_incomplete",
    },
    remaining: {
      status: outcome,
      items: complete ? [] : remaining.map((item) => (
        typeof item === "string" ? { description: item } : item
      )),
    },
    cause: uniqueCauses([
      ...state.cause.map((cause) => (
        complete ? { ...cause, status: "resolved" } : cause
      )),
      ...causes.map(compactFinding),
    ]),
  };
}

