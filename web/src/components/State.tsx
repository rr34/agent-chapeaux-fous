import type { ReactNode } from "react";

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="state-card"><span className="spinner" />{label}…</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state-card state-card--empty">{children}</div>;
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="state-card state-card--error" role="alert">
      <strong>Something went sideways.</strong>
      <span>{error instanceof Error ? error.message : String(error)}</span>
      {retry && <button className="button button--quiet" onClick={retry}>Try again</button>}
    </div>
  );
}
