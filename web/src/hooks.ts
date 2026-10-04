import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export function useApi<T>(url: string | null, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const reload = useCallback(async () => {
    if (!url) return;
    try {
      setError(null);
      setData(await api<T>(url));
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    void reload();
    if (!refreshMs) return;
    const timer = window.setInterval(() => void reload(), refreshMs);
    return () => window.clearInterval(timer);
  }, [reload, refreshMs]);
  return { data, error, loading, reload, setData };
}

export function localToday(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone,
  }).format(new Date());
}
