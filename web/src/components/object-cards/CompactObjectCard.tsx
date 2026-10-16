import type { ElementType, ReactNode } from "react";
import { useState } from "react";
import { ExpandIcon } from "./ObjectCardIcons";
import type { ObjectCardModel } from "./types";

export function CompactObjectCard({ object, defaultExpanded = false, controls, compactDetails, topEdge, bottomEdge, leading, full, className = "", as: Root = "article" }: {
  object: ObjectCardModel;
  defaultExpanded?: boolean;
  controls?: ReactNode;
  compactDetails?: ReactNode;
  topEdge?: ReactNode;
  bottomEdge?: ReactNode;
  leading?: ReactNode;
  full: ReactNode;
  className?: string;
  as?: ElementType;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const ExpandedRoot = Root === "li" ? "li" : "div";
  if (expanded) return <ExpandedRoot className="compact-object-expanded">
    {full}
    <button className="compact-object-collapse" type="button" onClick={() => setExpanded(false)} title={`Collapse ${object.display}`} aria-label={`Collapse ${object.display}`}>
      <ExpandIcon expanded />
    </button>
  </ExpandedRoot>;
  return <Root className={`compact-object-card${topEdge ? " has-top-edge" : ""}${bottomEdge ? " has-bottom-edge" : ""}${leading ? " has-leading" : ""}${className ? ` ${className}` : ""}`} data-object-type={object.type}>
    {topEdge && <div className="compact-object-top-edge">{topEdge}</div>}
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
    {bottomEdge && <div className="compact-object-bottom-edge">{bottomEdge}</div>}
  </Root>;
}
