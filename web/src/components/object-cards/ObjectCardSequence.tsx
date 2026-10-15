import type { ObjectCardModel } from "./types";

export function prominentObjectSequence(object: ObjectCardModel) {
  const attribute = object.attributes?.find(({ label }) => label === "Sequence");
  const sequence = attribute?.value.trim().replace(/^#\s*/, "") || "";
  if (!sequence) return { object, marker: undefined };

  return {
    object: {
      ...object,
      attributes: object.attributes?.filter(({ label }) => label !== "Sequence"),
    },
    marker: <span
      className="object-card-sequence"
      aria-label={`Sequence ${sequence}`}
      title={`Sequence ${sequence}`}
    >{sequence}</span>,
  };
}
