function normalizedContactName(value) {
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
