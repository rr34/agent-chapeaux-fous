import type { ElementType, ReactNode } from "react";
import { useState } from "react";
import { ExpandIcon } from "./ObjectCardIcons";
import type { ObjectCardModel } from "./types";

export function CompactObjectCard({ object, controls, full, as: Root = "article" }: {
  object: ObjectCardModel;
  controls?: ReactNode;
  full: ReactNode;
  as?: ElementType;
}) {
  const [expanded, setExpanded] = useState(false);
  const ExpandedRoot = Root === "li" ? "li" : "div";
  if (expanded) return <ExpandedRoot className="compact-object-expanded">
    {full}
    <button className="compact-object-collapse" type="button" onClick={() => setExpanded(false)} title={`Collapse ${object.display}`} aria-label={`Collapse ${object.display}`}>
      <ExpandIcon expanded />
    </button>
  </ExpandedRoot>;
  return <Root className="compact-object-card" data-object-type={object.type}>
    <div className="compact-object-identity">
      <span>{object.label}</span>
      <strong>{object.display}</strong>
    </div>
    <div className="compact-object-controls">
      <button className="compact-object-expand" type="button" onClick={() => setExpanded(true)} title={`Expand ${object.display}`} aria-label={`Expand ${object.display}`}>
        <ExpandIcon />
      </button>
      {controls}
    </div>
  </Root>;
}
