import { CompactObjectCard } from "./CompactObjectCard";
import { FullObjectCard } from "./FullObjectCard";
import type { ObjectCardProps } from "./types";

export function SimpleObjectCard(props: ObjectCardProps) {
  const { object, mode = "full", defaultExpanded, controls, focus, className, details, compactDetails, leading, actions = [], as } = props;
  if (mode === "compact") return <CompactObjectCard
    object={object}
    defaultExpanded={defaultExpanded}
    controls={controls}
    compactDetails={compactDetails}
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
    leading={leading}
    controls={controls}
    actions={actions}
    details={details}
  />;
}
