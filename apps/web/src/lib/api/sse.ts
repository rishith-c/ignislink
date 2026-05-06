"use client";

// Server-Sent Events client for live detection updates.
//
// Agent 2's backend exposes GET /stream/detections that bridges Kafka's
// `detections.created` topic. We open an EventSource and surface connection
// state ("connecting" | "open" | "fallback" | "closed") so the console can
// render the LIVE pulse pill in the right colour.
//
// If the backend is unreachable, the EventSource will keep retrying on its
// own — but we also set a hard timeout so we transition to "fallback" mode
// quickly enough to not block the UX. The console-page polls /detections
// every 30s as a fallback path independent of this stream.

import { useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "./client";

export type SseStatus = "connecting" | "open" | "fallback" | "closed";

export interface SseDetectionEvent {
  // The backend may send full detection objects or just IDs; we keep this
  // permissive so the console can append-or-merge as it sees fit.
  type: "detection.created" | "detection.updated" | "detection.resolved" | "ping";
  detection?: Record<string, unknown> & { id?: string; incident_id?: string };
  detection_id?: string;
}

export interface UseDetectionsStreamOptions {
  baseUrl?: string;
  onEvent?: (event: SseDetectionEvent) => void;
  // After how many ms without an "open" event do we report fallback so the
  // UI can show the amber pill. Defaults to 4s.
  fallbackAfterMs?: number;
  // Allow disabling SSE entirely (e.g. during SSR).
  enabled?: boolean;
}

/**
 * useDetectionsStream — subscribe to /stream/detections SSE.
 * Returns the current connection status and the last event received.
 */
export function useDetectionsStream(options: UseDetectionsStreamOptions = {}): {
  status: SseStatus;
  lastEvent: SseDetectionEvent | null;
} {
  const [status, setStatus] = useState<SseStatus>("connecting");
  const [lastEvent, setLastEvent] = useState<SseDetectionEvent | null>(null);
  const onEventRef = useRef(options.onEvent);
  onEventRef.current = options.onEvent;

  const enabled = options.enabled !== false;
  const baseUrl = options.baseUrl ?? getApiBaseUrl();
  const fallbackAfterMs = options.fallbackAfterMs ?? 4_000;

  useEffect(() => {
    if (!enabled) {
      setStatus("closed");
      return;
    }
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      setStatus("fallback");
      return;
    }

    let closed = false;
    const url = `${baseUrl.replace(/\/$/, "")}/stream/detections`;
    const source = new EventSource(url, { withCredentials: false });

    const fallbackTimer = setTimeout(() => {
      if (!closed && source.readyState !== EventSource.OPEN) {
        setStatus("fallback");
      }
    }, fallbackAfterMs);

    source.onopen = () => {
      setStatus("open");
    };

    source.onerror = () => {
      // EventSource auto-retries; CONNECTING means it's trying again.
      if (source.readyState === EventSource.CLOSED) {
        setStatus("closed");
      } else if (source.readyState === EventSource.CONNECTING) {
        // Don't flap to "fallback" on a transient blip — only if the initial
        // connection never came up (handled by fallbackTimer).
        if (status !== "open") setStatus("fallback");
      }
    };

    source.onmessage = (event: MessageEvent<string>) => {
      let parsed: SseDetectionEvent | null = null;
      try {
        parsed = JSON.parse(event.data) as SseDetectionEvent;
      } catch {
        return;
      }
      if (!parsed || parsed.type === "ping") return;
      setLastEvent(parsed);
      onEventRef.current?.(parsed);
    };

    return () => {
      closed = true;
      clearTimeout(fallbackTimer);
      source.close();
      setStatus("closed");
    };
    // We intentionally only re-init when baseUrl/enabled change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, enabled, fallbackAfterMs]);

  return { status, lastEvent };
}
