const weekdayNames = {
  MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday",
  FR: "Friday", SA: "Saturday", SU: "Sunday",
};

function inputError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function calendarTime(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")}`;
}

function calendarDate(date, timeZone, { includeTime = false } = {}) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, weekday: "short", day: "2-digit", month: "short", year: "numeric",
  }).formatToParts(date);
  const part = (type) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  const label = `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")}`;
  return includeTime ? `${label} at ${calendarTime(date, timeZone)}` : label;
}

function formattedWhen(event) {
  const start = new Date(event.startsAtUtc);
  const end = event.endsAtUtc ? new Date(event.endsAtUtc) : null;
  const timeZone = event.timeZone || "UTC";
  if (!Number.isFinite(start.getTime()) || (end && !Number.isFinite(end.getTime()))) {
    throw inputError("The calendar event has an invalid date or time.", 409);
  }
  const startDate = calendarDate(start, timeZone);
  if (event.isAllDay) {
    const inclusiveEnd = end && end > start ? new Date(end.getTime() - 1) : null;
    const endDate = inclusiveEnd ? calendarDate(inclusiveEnd, timeZone) : null;
    return endDate && endDate !== startDate ? `${startDate} through ${endDate} (all day)` : `${startDate} (all day)`;
  }
  const startDateTime = calendarDate(start, timeZone, { includeTime: true });
  if (!end) return startDateTime;
  const endDate = calendarDate(end, timeZone);
  if (endDate === startDate) {
    return `${startDateTime}–${calendarTime(end, timeZone)}`;
  }
  return `${startDateTime} through ${calendarDate(end, timeZone, { includeTime: true })}`;
}

function recurrenceParts(rule) {
  return Object.fromEntries(String(rule || "").replace(/^RRULE:/i, "").split(";")
    .map((part) => part.split("=", 2)).filter(([name, value]) => name && value));
}

function joinedWords(values) {
  if (values.length < 2) return values[0] || "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function formattedRecurrence(rule) {
  if (!rule) return null;
  const parts = recurrenceParts(rule);
  const interval = Math.max(1, Number(parts.INTERVAL) || 1);
  const units = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" };
  const unit = units[parts.FREQ];
  if (!unit) return "Repeats according to the saved event schedule";
  let description = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
  if (parts.FREQ === "WEEKLY" && parts.BYDAY) {
    const days = parts.BYDAY.split(",").map((day) => weekdayNames[day]).filter(Boolean);
    if (days.length) description += ` on ${joinedWords(days)}`;
  }
  if (parts.COUNT) description += ` for ${parts.COUNT} occurrences`;
  const until = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL || "");
  if (until) {
    const date = new Date(`${until[1]}-${until[2]}-${until[3]}T12:00:00Z`);
    description += ` through ${calendarDate(date, "UTC")}`;
  }
  return description;
}

export function calendarInviteMessage(event) {
  if (!event || typeof event.title !== "string" || !event.title.trim()) {
    throw inputError("The calendar event is missing a title.", 409);
  }
  const lines = [
    "Hi,",
    "",
    `You're invited to ${event.title.trim()}.`,
    "",
    `When: ${formattedWhen(event)}`,
  ];
  const recurrence = formattedRecurrence(event.recurrenceRule);
  if (recurrence) lines.push(`Repeats: ${recurrence}`);
  if (event.location?.trim()) lines.push(`Where: ${event.location.trim()}`);
  if (event.description?.trim()) lines.push("", event.description.trim());
  lines.push("", "Please reply to let me know if you can make it.");
  return { subject: `Invitation: ${event.title.trim()}`, text: lines.join("\n") };
}

export function calendarInviteRecipient(contact) {
  if (!contact || contact.status !== "active") {
    throw inputError("Every invitation recipient must be an active contact.", 409);
  }
  const email = (contact.methods ?? [])
    .filter((method) => method.kind === "email" && method.canReceive && typeof method.value === "string")
    .toSorted((left, right) => Number(right.isPrimary) - Number(left.isPrimary))
    .find((method) => /^[^\s@]+@[^\s@]+$/.test(method.value.trim()));
  if (!email) throw inputError(`${contact.displayName} does not have a receivable email address.`, 409);
  return { name: contact.displayName, email: email.value.trim() };
}

export async function createCalendarInviteDraft({ organizer, createEmailDraft, ledger = null }, input, context = {}) {
  const eventId = Number(input?.calendarEventId);
  if (!Number.isSafeInteger(eventId) || eventId <= 0) throw inputError("calendarEventId is invalid.");
  if (!Array.isArray(input?.contactIds) || input.contactIds.length < 1 || input.contactIds.length > 50) {
    throw inputError("Choose between 1 and 50 invitation contacts.");
  }
  const contactIds = [...new Set(input.contactIds.map(Number))];
  if (contactIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw inputError("Every invitation contact ID must be a positive integer.");
  }
  const event = organizer.getCalendar(eventId);
  if (!event) throw inputError("Calendar event not found.", 404);
  if (event.status !== "active") throw inputError("Archived calendar events cannot be invited.", 409);

  const contacts = contactIds.map((id) => organizer.getContact(id));
  const missingIndex = contacts.findIndex((contact) => !contact);
  if (missingIndex >= 0) throw inputError(`Contact ${contactIds[missingIndex]} was not found.`, 404);
  const recipients = contacts.map(calendarInviteRecipient);
  const uniqueRecipients = [...new Map(recipients.map((recipient) => [recipient.email.toLowerCase(), recipient])).values()];
  const message = calendarInviteMessage(event);
  const result = await createEmailDraft({
    account_id: null,
    if_in_state: null,
    replace_draft_email_id: null,
    drafts_mailbox_id: null,
    identity_id: null,
    from: null,
    to: uniqueRecipients,
    cc: null,
    bcc: null,
    reply_to: null,
    subject: message.subject,
    text_body: message.text,
    html_body: null,
    in_reply_to_message_ids: null,
    reference_message_ids: null,
    attachments: [],
  });
  const draftEmailId = result?.created?.draft?.id;
  if (!draftEmailId) throw inputError("Fastmail did not return the created draft ID.", 502);
  ledger?.append({
    type: "calendar.invitation.draft.created",
    status: "draft",
    actorType: context.actorType || "user",
    actorName: context.actorName || "Nate",
    source: context.source || "web_client",
    channel: context.channel || "web",
    turnId: context.requestId || null,
    operationId: context.callId || null,
    name: "Calendar invitation draft created",
    content: event.title,
    payload: {
      calendarEventId: event.id,
      contactIds,
      recipients: uniqueRecipients,
      subject: message.subject,
      draftEmailId,
    },
    subjectType: "calendar_event",
    subjectId: String(event.id),
  });
  return {
    created: true,
    draftEmailId,
    calendarEventId: event.id,
    subject: message.subject,
    recipientCount: uniqueRecipients.length,
    recipients: uniqueRecipients,
  };
}
