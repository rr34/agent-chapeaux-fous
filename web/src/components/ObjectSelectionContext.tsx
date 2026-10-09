import { createContext, type ReactNode, useContext } from "react";
import type { SelectedObjectCandidate } from "../types";

interface ObjectSelectionValue {
  selections: SelectedObjectCandidate[];
  toggleSelection: (identity: SelectedObjectCandidate) => void;
}

const ObjectSelectionContext = createContext<ObjectSelectionValue | null>(null);

export function ObjectSelectionProvider({ selections, toggleSelection, children }: ObjectSelectionValue & { children: ReactNode }) {
  return <ObjectSelectionContext.Provider value={{ selections, toggleSelection }}>
    {children}
  </ObjectSelectionContext.Provider>;
}

export function useObjectSelection() {
  return useContext(ObjectSelectionContext);
}
