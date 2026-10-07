import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { RequestRecord } from "./types";

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

type RequestFeed = {
  cursor: number;
  requestIds: string[];
  requests: RequestRecord[];
};

export function useRequestFeed(limit = 25, refreshMs = 3000) {
  const [data, setData] = useState<{ requests: RequestRecord[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const cursor = useRef(0);
  const initialized = useRef(false);
  const requestIds = useRef<string[]>([]);
  const requestsById = useRef(new Map<string, RequestRecord>());
  const inFlight = useRef<Promise<void> | null>(null);

  const reload = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const request = (async () => {
      try {
        setError(null);
        const feed = await api<RequestFeed>(
          `/api/requests?limit=${limit}&afterEventSeq=${cursor.current}`,
        );
        for (const item of feed.requests) requestsById.current.set(item.requestId, item);
        const retained = new Set(feed.requestIds);
        for (const requestId of requestsById.current.keys()) {
          if (!retained.has(requestId)) requestsById.current.delete(requestId);
        }
        const nextRequests = feed.requestIds.flatMap((requestId) => {
          const item = requestsById.current.get(requestId);
          return item ? [item] : [];
        });
        const orderChanged = feed.requestIds.length !== requestIds.current.length
          || feed.requestIds.some((requestId, index) => requestId !== requestIds.current[index]);
        requestIds.current = feed.requestIds;
        cursor.current = feed.cursor;
        if (!initialized.current || feed.requests.length > 0 || orderChanged) {
          initialized.current = true;
          setData({ requests: nextRequests });
        }
      } catch (caught) {
        setError(caught);
      } finally {
        setLoading(false);
      }
    })();
    inFlight.current = request;
    void request.finally(() => {
      if (inFlight.current === request) inFlight.current = null;
    });
    return request;
  }, [limit]);

  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;
    const tick = async () => {
      if (document.visibilityState === "visible") await reload();
      if (!stopped) timer = window.setTimeout(tick, refreshMs);
    };
    const becameVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    void reload().finally(() => {
      if (!stopped) timer = window.setTimeout(tick, refreshMs);
    });
    document.addEventListener("visibilitychange", becameVisible);
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", becameVisible);
    };
  }, [refreshMs, reload]);

  return { data, error, loading, reload };
}

export function localToday(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone,
  }).format(new Date());
}
