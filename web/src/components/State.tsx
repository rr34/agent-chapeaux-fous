import type { ReactNode } from "react";
import { useState } from "react";

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="state-card"><span className="spinner" />{label}…</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state-card state-card--empty">{children}</div>;
}

export function ErrorState({ error, retry, dismiss }: {
  error: unknown; retry?: () => void; dismiss?: () => void;
}) {
  const [copyLabel, setCopyLabel] = useState("Copy error");
  const message = error instanceof Error ? error.message : String(error);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopyLabel("Copied");
    } catch {
      setCopyLabel("Select the text to copy");
    }
  };
  return (
    <div className="state-card state-card--error" role="alert">
      <strong>Something went sideways.</strong>
      <pre tabIndex={0}>{message}</pre>
      <div className="state-card-actions">
        <button className="button button--quiet" onClick={() => void copy()}>{copyLabel}</button>
        {retry && <button className="button button--quiet" onClick={retry}>Try again</button>}
        {dismiss && <button className="button button--quiet" onClick={dismiss}>Dismiss</button>}
      </div>
    </div>
  );
}
