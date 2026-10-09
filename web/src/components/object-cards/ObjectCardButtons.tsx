import { NetworkIcon, ReferenceIcon } from "./ObjectCardIcons";

export function ObjectCardNetworkButton({ label, onClick, disabled = false }: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return <button
    className="object-network-button"
    type="button"
    onClick={onClick}
    disabled={disabled || !onClick}
    title={label}
    aria-label={label}
  ><NetworkIcon /></button>;
}

export function ObjectCardReferenceButton({ label, onClick, disabled = false }: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return <button
    className="agent-reference-button"
    type="button"
    onClick={onClick}
    disabled={disabled || !onClick}
    title={label}
    aria-label={label}
  ><ReferenceIcon /></button>;
}
