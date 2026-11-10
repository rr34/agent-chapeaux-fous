import { AsyncLocalStorage } from "node:async_hooks";

const personStorage = new AsyncLocalStorage();
let defaultPersonId = 1;

function positivePersonId(value, label = "person_id") {
  const personId = Number(value);
  if (!Number.isSafeInteger(personId) || personId < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return personId;
}

export function configureDefaultPersonId(value) {
  defaultPersonId = positivePersonId(value, "Default person_id");
  return defaultPersonId;
}

export function currentPersonId() {
  return personStorage.getStore()?.personId ?? defaultPersonId;
}

export function runWithPerson(personId, callback) {
  return personStorage.run({ personId: positivePersonId(personId) }, callback);
}

export function enterPersonContext(personId) {
  personStorage.enterWith({ personId: positivePersonId(personId) });
  return personId;
}
