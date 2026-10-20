import type { ElementType, ReactNode } from "react";
import type { FullObjectCardAction, FullObjectCardData } from "./FullObjectCard";

export interface ObjectCardModel extends FullObjectCardData {
  id: number | string;
  links?: Array<{ label: string; href: string }>;
}

export interface ObjectCardProps {
  object: ObjectCardModel;
  mode?: "full" | "compact";
  defaultExpanded?: boolean;
  controls?: ReactNode;
  focus?: boolean;
  className?: string;
  as?: ElementType;
  details?: ReactNode;
  detailsInContent?: boolean;
  stackEdges?: boolean;
  compactDetails?: ReactNode;
  topEdge?: ReactNode;
  bottomEdge?: ReactNode;
  leading?: ReactNode;
  actions?: FullObjectCardAction[];
  onEdit?: () => void;
  onToggleComplete?: () => void;
  onDownload?: () => void;
  busy?: boolean;
}

export function attributeValue(object: ObjectCardModel, label: string) {
  return object.attributes?.find((attribute) => attribute.label === label)?.value;
}
