import type { ElementType, ReactNode } from "react";
import { useState } from "react";
import { ExpandIcon } from "./ObjectCardIcons";
import type { ObjectCardModel } from "./types";

export function CompactObjectCard({ object, controls, compactDetails, leading, full, className = "", as: Root = "article" }: {
  object: ObjectCardModel;
  controls?: ReactNode;
  compactDetails?: ReactNode;
  leading?: ReactNode;
  full: ReactNode;
  className?: string;
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
  return <Root className={`compact-object-card${leading ? " has-leading" : ""}${className ? ` ${className}` : ""}`} data-object-type={object.type}>
    {leading && <div className="compact-object-leading">{leading}</div>}
    <div className="compact-object-identity">
      <span>{object.label}</span>
      <strong>{object.display}</strong>
      {compactDetails && <div className="compact-object-details">{compactDetails}</div>}
    </div>
    <div className="compact-object-controls">
      <button className="compact-object-expand" type="button" onClick={() => setExpanded(true)} title={`Expand ${object.display}`} aria-label={`Expand ${object.display}`}>
        <ExpandIcon />
      </button>
      {controls}
    </div>
  </Root>;
}
