import type { ElementType, ReactNode } from "react";

export interface FullObjectCardData {
  type: string;
  label: string;
  display: string;
  body?: string | null;
  attributes?: Array<{ label: string; value: string }>;
  badges?: string[];
}

export interface FullObjectCardAction {
  key: string;
  label: string;
  title?: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  external?: boolean;
}

export function FullObjectCard({
  object, as: Root = "article", className = "", focus = false,
  topEdge, bottomEdge, leading, controls, actions = [], details, detailsInContent = false, stackEdges = false,
}: {
  object: FullObjectCardData;
  as?: ElementType;
  className?: string;
  focus?: boolean;
  topEdge?: ReactNode;
  bottomEdge?: ReactNode;
  leading?: ReactNode;
  controls?: ReactNode;
  actions?: FullObjectCardAction[];
  details?: ReactNode;
  detailsInContent?: boolean;
  stackEdges?: boolean;
}) {
  const attributes = (object.attributes || []).filter(({ value }) => String(value).trim());
  const detailContent = details && <div className="first-class-object-details">{details}</div>;
  return <Root
    className={`first-class-object-card first-class-object-card--full${topEdge ? " has-top-edge" : ""}${bottomEdge ? " has-bottom-edge" : ""}${focus ? " is-focus" : ""}${className ? ` ${className}` : ""}`}
    data-object-type={object.type}
  >
    {stackEdges && (topEdge || bottomEdge) && <div className="first-class-object-edges">
      {topEdge && <div className="first-class-object-top-edge">{topEdge}</div>}
      {bottomEdge && <div className="first-class-object-bottom-edge">{bottomEdge}</div>}
    </div>}
    {!stackEdges && topEdge && <div className="first-class-object-top-edge">{topEdge}</div>}
    {leading && <div className="first-class-object-leading">{leading}</div>}
    <div className="first-class-object-content">
      <span className="first-class-object-label">{object.label}</span>
      <strong className="first-class-object-title">{object.display}</strong>
      {object.body && object.body !== object.display && <p className="first-class-object-body">{object.body}</p>}
      {Boolean(object.badges?.length) && <div className="first-class-object-badges">
        {object.badges!.map((badge) => <span className="pill" key={badge}>{badge}</span>)}
      </div>}
      {attributes.length > 0 && <dl className="first-class-object-attributes">{attributes.map(({ label, value }) => <div key={`${label}-${value}`}>
        <dt>{label}</dt><dd>{value}</dd>
      </div>)}</dl>}
      {detailsInContent && detailContent}
    </div>
    {!detailsInContent && detailContent}
    {(controls || actions.length > 0) && <div className="first-class-object-actions">
      {controls}
      {actions.map((action) => action.href
        ? <a
          className={`first-class-object-action${action.danger ? " first-class-object-action--danger" : ""}`}
          href={action.href}
          key={action.key}
          title={action.title}
          target={action.external ? "_blank" : undefined}
          rel={action.external ? "noreferrer" : undefined}
        >{action.label}</a>
        : <button
          className={`first-class-object-action${action.danger ? " first-class-object-action--danger" : ""}`}
          type="button"
          key={action.key}
          title={action.title}
          disabled={action.disabled}
          onClick={action.onClick}
        >{action.label}</button>)}
    </div>}
    {!stackEdges && bottomEdge && <div className="first-class-object-bottom-edge">{bottomEdge}</div>}
  </Root>;
}
