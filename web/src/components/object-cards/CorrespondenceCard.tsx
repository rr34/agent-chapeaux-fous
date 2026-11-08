import type { ReactNode } from "react";
import { formatDisplayDate } from "../../date-format";
import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";

const media = new Set(["email", "sms", "mms", "rcs", "imessage", "whatsapp", "chat", "call", "voicemail", "other"]);
const directions = new Set(["inbound", "outbound"]);

function normalized(value: string | undefined) {
  return value?.trim().toLocaleLowerCase("en-US") || "";
}

function attribute(props: ObjectCardProps, label: string) {
  return props.object.attributes?.find((item) => item.label.toLocaleLowerCase("en-US") === label)?.value;
}

function cardQualifier(props: ObjectCardProps, label: "medium" | "direction") {
  const values = label === "medium" ? media : directions;
  const fromAttribute = normalized(attribute(props, label));
  if (values.has(fromAttribute)) return fromAttribute;
  return normalized(props.object.badges?.find((badge) => values.has(normalized(badge))));
}

function compactDate(props: ObjectCardProps) {
  const value = attribute(props, "when")?.trim();
  if (!value) return "";
  const formatted = formatDisplayDate(value, { fallback: "" }) || value;
  return formatted.replace(" at ", ", ");
}

function MediumIcon({ medium }: { medium: string }) {
  if (medium === "email") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>;
  if (medium === "mms") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-4.5A2 2 0 0 1 3 15V6a2 2 0 0 1 2-2Z" /><circle cx="9" cy="9" r="1.4" /><path d="m7 15 3-3 2.5 2 2.5-3 3 4" /></svg>;
  if (["sms", "rcs", "imessage", "whatsapp", "chat"].includes(medium)) return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-4.5A2 2 0 0 1 3 15V6a2 2 0 0 1 2-2Z" /><path d="M8 9h8M8 13h5" /></svg>;
  if (medium === "voicemail") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="12" r="4" /><circle cx="17" cy="12" r="4" /><path d="M7 16h10" /></svg>;
  if (medium === "call") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 3.5 10 8 7.8 10a15.5 15.5 0 0 0 6.2 6.2l2-2.2 4.5 2.8-.8 3a2 2 0 0 1-2 1.5A15.5 15.5 0 0 1 2.7 6.3a2 2 0 0 1 1.5-2Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="18" cy="12" r="1" /></svg>;
}

function DirectionIcon({ direction, missed }: { direction: string; missed: boolean }) {
  if (missed) return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 7 8 9 8-9M4 7v6M4 7h6" /></svg>;
  if (direction === "outbound") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19 19 5M10 5h9v9" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 5 5 19M14 19H5v-9" /></svg>;
}

function Indicators({ medium, direction, missed }: { medium: string; direction: string; missed: boolean }) {
  const directionLabel = missed ? "Missed call" : direction === "outbound" ? "Outbound" : "Inbound";
  return <div className="correspondence-card-indicators">
    <span className="correspondence-card-indicator" role="img" aria-label={medium || "Other correspondence"} title={medium || "Other correspondence"}>
      <MediumIcon medium={medium} />
    </span>
    <span className="correspondence-card-indicator" role="img" aria-label={directionLabel} title={directionLabel}>
      <DirectionIcon direction={direction} missed={missed} />
    </span>
  </div>;
}

export function CorrespondenceCard(props: ObjectCardProps) {
  const medium = cardQualifier(props, "medium");
  const direction = cardQualifier(props, "direction");
  const callDisposition = normalized(attribute(props, "call disposition"));
  const missed = medium === "call" && callDisposition === "missed";
  const genericDisplay = normalized(props.object.display) === `${medium} ${direction}`.trim();
  const hiddenQualifiers = new Set([medium, direction, callDisposition].filter(Boolean));
  const object = {
    ...props.object,
    attributes: props.object.attributes?.filter(({ label }) => !["medium", "direction", "call disposition"].includes(normalized(label))),
    badges: props.object.badges?.filter((badge) => !hiddenQualifiers.has(normalized(badge))),
  };
  const compactDetails: ReactNode = object.body || props.compactDetails
    ? <div className="correspondence-card-compact-details">
      {object.body && <span className="correspondence-card-preview">{object.body}</span>}
      {props.compactDetails}
    </div>
    : null;
  const indicators = <Indicators medium={medium} direction={direction} missed={missed} />;
  const when = compactDate(props);
  return <SimpleObjectCard
    {...props}
    object={object}
    className={`correspondence-card${genericDisplay ? " has-generic-display" : ""}${props.className ? ` ${props.className}` : ""}`}
    leading={props.leading ? <div className="correspondence-card-leading">{indicators}{props.leading}</div> : indicators}
    compactDetails={compactDetails}
    compactHeadingMeta={when}
  />;
}
