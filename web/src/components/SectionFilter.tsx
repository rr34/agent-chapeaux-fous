export function SectionFilter({ query, onChange, count, noun = "result", label = "Filter this section" }: {
  query: string;
  onChange: (query: string) => void;
  count: number;
  noun?: string;
  label?: string;
}) {
  return <div className="section-filter surface">
    <label className="section-filter-field">
      <span>{label}</span>
      <input
        type="search"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Type words in any order…"
        autoComplete="off"
      />
    </label>
    <span className="section-filter-count" aria-live="polite">{count} {count === 1 ? noun : `${noun}s`}</span>
  </div>;
}
