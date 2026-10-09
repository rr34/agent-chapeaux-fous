export function ExpandIcon({ expanded = false }: { expanded?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24">
    {expanded
      ? <path d="M9 3v6H3M15 21v-6h6M3 9l6-6M21 15l-6 6" />
      : <path d="M9 3H3v6M15 21h6v-6M3 3l6 6M21 21l-6-6" />}
  </svg>;
}

export function NetworkIcon({ broken = false }: { broken?: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={broken ? "M7.2 8.2 5 6m12 12-2.2-2.2M8.6 15.7 5 18m10.4-9.7L19 6" : "M7.3 8.1 4.8 6.4m11.9 1.7 2.5-1.7M7.3 15.9l-2.5 1.7m11.9-1.7 2.5 1.7"} />
    {!broken && <path d="M8 12h8" />}
    <circle cx="4" cy="6" r="2" />
    <circle cx="20" cy="6" r="2" />
    <circle cx="4" cy="18" r="2" />
    <circle cx="20" cy="18" r="2" />
    {!broken && <circle cx="12" cy="12" r="2.2" />}
  </svg>;
}

export function ReferenceIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 19c0-4.4-3.6-8-8-8H4" />
    <path d="m9 6-5 5 5 5" />
  </svg>;
}
