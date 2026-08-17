export function normalizedContactName(value) {
  return String(value ?? "").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function duplicateMethodKey(method) {
  if (method?.kind === "email") return String(method.value ?? "").trim().toLocaleLowerCase();
  if (method?.kind === "phone") return String(method.value ?? "").replace(/\D/g, "");
  return null;
}

function keysForContact(contact) {
  const name = normalizedContactName(contact.displayName);
  const keys = name.length >= 3 ? [`name:${name}`] : [];
  for (const method of contact.methods ?? []) {
    const value = duplicateMethodKey(method);
    if (value) keys.push(`${method.kind}:${value}`);
  }
  return [...new Set(keys)];
}

function contactMethodKeys(contact) {
  return new Set((contact.methods ?? []).flatMap((method) => {
    const value = duplicateMethodKey(method);
    return value ? [`${method.kind}:${value}`] : [];
  }));
}

export function clearDuplicateGroup(contacts) {
  if (!Array.isArray(contacts) || contacts.length < 2) return { eligible: false, reason: "fewer than two contacts" };
  if (contacts.length > 21) return { eligible: false, reason: "group exceeds merge size limit" };
  const names = new Set(contacts.map(({ displayName }) => normalizedContactName(displayName)));
  if (names.size !== 1 || ![...names][0] || [...names][0].length < 3) {
    return { eligible: false, reason: "display names are not the same" };
  }
  const kinds = new Set(contacts.map(({ kind }) => kind));
  if (kinds.size !== 1) return { eligible: false, reason: "contact kinds differ" };
  const sources = contacts.map(({ source }) => String(source ?? "").trim());
  if (sources.some((source) => !source) || new Set(sources).size !== contacts.length) {
    return { eligible: false, reason: "contacts are not from distinct named sources" };
  }
  const birthdays = new Set(contacts.map(({ birthDate }) => birthDate).filter(Boolean));
  if (birthdays.size > 1) return { eligible: false, reason: "birthdays conflict" };

  const keysById = new Map(contacts.map((contact) => [contact.id, contactMethodKeys(contact)]));
  if ([...keysById.values()].some((keys) => keys.size === 0)) {
    return { eligible: false, reason: "a contact has no exact email or phone evidence" };
  }
  const visited = new Set([contacts[0].id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const contact of contacts) {
      if (visited.has(contact.id)) continue;
      const connected = contacts.some((candidate) => (
        visited.has(candidate.id)
        && [...keysById.get(contact.id)].some((key) => keysById.get(candidate.id).has(key))
      ));
      if (connected) {
        visited.add(contact.id);
        changed = true;
      }
    }
  }
  if (visited.size !== contacts.length) {
    return { eligible: false, reason: "exact email or phone evidence does not connect every contact" };
  }
  return { eligible: true, reason: "same name across distinct sources with connected exact email or phone evidence" };
}

export function selectDuplicateKeeper(contacts, preferredSource = null) {
  const selectedSource = String(preferredSource ?? "").trim();
  const score = (contact) => (
    (selectedSource && contact.source === selectedSource ? 1_000_000 : 0)
    + (contact.isSelf ? 100_000 : 0)
    + [contact.givenName, contact.familyName, contact.organizationName].filter(Boolean).length * 100
    + (contact.birthDate ? 100 : 0)
    + Math.min(String(contact.notes ?? "").length, 2000)
    + (contact.methods?.length ?? 0) * 25
    + (contact.tags?.length ?? 0) * 10
  );
  return [...contacts].sort((left, right) => score(right) - score(left) || left.id - right.id)[0];
}

export function findContactDuplicateGroups(contacts) {
  const active = contacts.filter(({ status }) => status === "active");
  const parent = new Map(active.map(({ id }) => [id, id]));
  const find = (selectedId) => {
    let id = selectedId;
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== id) {
      const next = parent.get(id);
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const union = (left, right) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  const owners = new Map();
  for (const contact of active) {
    for (const key of keysForContact(contact)) {
      if (owners.has(key)) union(contact.id, owners.get(key));
      else owners.set(key, contact.id);
    }
  }
  const grouped = new Map();
  for (const contact of active) {
    const root = find(contact.id);
    const group = grouped.get(root) ?? [];
    group.push(contact);
    grouped.set(root, group);
  }
  return [...grouped.values()].filter((group) => group.length > 1).map((group) => {
    const evidence = new Set();
    const counts = new Map();
    for (const contact of group) {
      for (const key of keysForContact(contact)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      if (count > 1) evidence.add(key.startsWith("name:") ? "same name" : `same ${key.split(":", 1)[0]}`);
    }
    return { contactIds: group.map(({ id }) => id), evidence: [...evidence] };
  });
}
