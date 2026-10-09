import { NetworkIcon } from "./ObjectCardIcons";

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

export function ObjectCardSelectionCheckbox({ label, checked, onChange, disabled = false }: {
  label: string;
  checked: boolean;
  onChange?: () => void;
  disabled?: boolean;
}) {
  return <label className="object-selection-control" title={label}>
    <input
      className="object-selection-checkbox"
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled || !onChange}
      aria-label={label}
    />
  </label>;
}
