import { CompactObjectCard } from "./CompactObjectCard";
import { FullObjectCard } from "./FullObjectCard";
import type { ObjectCardProps } from "./types";

export function SimpleObjectCard(props: ObjectCardProps) {
  const { object, mode = "full", defaultExpanded, controls, focus, className, details, compactDetails, topEdge, bottomEdge, leading, actions = [], as } = props;
  if (mode === "compact") return <CompactObjectCard
    object={object}
    defaultExpanded={defaultExpanded}
    controls={controls}
    compactDetails={compactDetails}
    topEdge={topEdge}
    bottomEdge={bottomEdge}
    leading={leading}
    className={className}
    as={as}
    full={<SimpleObjectCard {...props} as={as === "li" ? "article" : as} mode="full" />}
  />;
  return <FullObjectCard
    object={object}
    as={as}
    focus={focus}
    className={className}
    topEdge={topEdge}
    bottomEdge={bottomEdge}
    leading={leading}
    controls={controls}
    actions={actions}
    details={details}
  />;
}
