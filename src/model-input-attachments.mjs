const modelInputAttachmentsKey = Symbol("modelInputAttachments");

export function attachModelInputAttachments(value, attachments) {
  if (!value || typeof value !== "object" || !Array.isArray(attachments) || attachments.length === 0) {
    return value;
  }
  Object.defineProperty(value, modelInputAttachmentsKey, {
    value: Object.freeze(attachments.map((attachment) => Object.freeze({ ...attachment }))),
    enumerable: false,
  });
  return value;
}

export function modelInputAttachments(value) {
  return value && typeof value === "object" ? value[modelInputAttachmentsKey] ?? [] : [];
}
