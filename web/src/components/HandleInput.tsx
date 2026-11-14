import type { InputHTMLAttributes } from "react";

type HandleInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  value: string;
  onValueChange: (value: string) => void;
};

export function HandleInput({ value, onValueChange, ...inputProps }: HandleInputProps) {
  return <span className="handle-input">
    <span className="handle-input-prefix" aria-hidden="true">@</span>
    <input
      {...inputProps}
      value={value}
      autoCapitalize="none"
      spellCheck={false}
      onChange={(event) => onValueChange(event.target.value.replace(/@/gu, ""))}
    />
  </span>;
}
