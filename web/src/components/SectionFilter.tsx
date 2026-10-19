import type { ReactNode } from "react";

export function SectionFilter({
  query, onChange, onSearch, searching = false, count, noun = "result",
  label = "Filter this section", controls,
}: {
  query: string;
  onChange: (query: string) => void;
  onSearch: () => void;
  searching?: boolean;
  count: number;
  noun?: string;
  label?: string;
  controls?: ReactNode;
}) {
  return <form className="section-filter surface" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
    <label className="section-filter-field">
      <span>{label}</span>
      <input
        type="search"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Type words in any order…"
        autoComplete="off"
        maxLength={200}
      />
    </label>
    <button className="button section-filter-search" type="submit" disabled={searching}>
      {searching ? "Searching…" : "Search"}
    </button>
    {controls && <div className="section-filter-controls">{controls}</div>}
    <span className="section-filter-count" aria-live="polite">{count} {count === 1 ? noun : `${noun}s`}</span>
  </form>;
}
