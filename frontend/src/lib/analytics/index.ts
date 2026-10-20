import { apiFetch, apiUrl } from "@/lib/api/client";
import type { AnalyticsEventName, AnalyticsProperties } from "@/lib/api/types";
import { touchIdentity } from "./identity";

/**
 * Funnel events for the dashboard (view, add to bag, checkout start). Anonymous and first-party; purchases are
 * counted by the server from paid orders, never from the browser. Events are batched, sent in the background, and
 * dropped on failure: analytics must never slow down or break a page.
 */
type QueuedEvent = { name: AnalyticsEventName; anonymousId: string; sessionId: string; occurredAt: string; properties: AnalyticsProperties };

const BATCH_MAX = 20; // API limit per request
const FLUSH_AFTER_MS = 2000;
const QUEUE_LIMIT = 100;

let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

function enqueue(name: AnalyticsEventName, properties: AnalyticsProperties) {
  const { anonymousId, sessionId, isNewSession } = touchIdentity();
  const base = { anonymousId, sessionId, occurredAt: new Date().toISOString() };
  if (isNewSession && name !== "session_start") queue.push({ name: "session_start", properties: {}, ...base });
  queue.push({ name, properties, ...base });
  if (queue.length > QUEUE_LIMIT) queue = queue.slice(-QUEUE_LIMIT);
}

export function track(name: AnalyticsEventName, properties: AnalyticsProperties = {}): void {
  if (typeof window === "undefined") return;
  enqueue(name, properties);
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush({ unloading: true }));
    window.addEventListener("pagehide", () => flush({ unloading: true }));
  }
  if (queue.length >= BATCH_MAX) flush();
  else timer ??= setTimeout(() => flush(), FLUSH_AFTER_MS);
}

/** Sends what is queued. While the page is going away it uses `sendBeacon`, which survives the unload. */
export function flush({ unloading = false }: { unloading?: boolean } = {}): void {
  clearTimeout(timer);
  timer = undefined;
  while (queue.length > 0) {
    const events = queue.splice(0, BATCH_MAX);
    const body = { events };
    if (unloading && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(apiUrl("/analytics/events"), new Blob([JSON.stringify(body)], { type: "application/json" }));
    } else {
      void apiFetch("/analytics/events", { method: "POST", body, keepalive: true }).catch(() => undefined);
    }
  }
}

/** Test helper: forget everything queued without sending it. */
export function resetAnalyticsQueue(): void {
  clearTimeout(timer);
  timer = undefined;
  queue = [];
}
