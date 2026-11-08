import { createContext, type ReactNode, useContext } from "react";
import type { SelectedObjectCandidate } from "../types";

interface ObjectSelectionValue {
  selections: SelectedObjectCandidate[];
  toggleSelection: (identity: SelectedObjectCandidate) => void;
  changeSelections: (identities: SelectedObjectCandidate[], selected: boolean) => void;
}

export function objectSelectionKey({ ref, occurrenceStartsAtUtc }: Pick<
  SelectedObjectCandidate, "ref" | "occurrenceStartsAtUtc"
>) {
  return occurrenceStartsAtUtc ? `${ref}\noccurrence:${occurrenceStartsAtUtc}` : ref;
}

const ObjectSelectionContext = createContext<ObjectSelectionValue | null>(null);

export function ObjectSelectionProvider({ selections, toggleSelection, changeSelections, children }: ObjectSelectionValue & { children: ReactNode }) {
  return <ObjectSelectionContext.Provider value={{ selections, toggleSelection, changeSelections }}>
    {children}
  </ObjectSelectionContext.Provider>;
}

export function useObjectSelection() {
  return useContext(ObjectSelectionContext);
}
