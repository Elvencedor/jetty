import { create } from "zustand";
import { persist } from "zustand/middleware";
import { browserStorage } from "@/lib/stores/persisted";

/** A visit ends after this long without activity; the next event starts a new session. */
export const SESSION_IDLE_MS = 30 * 60 * 1000;

type Identity = {
  /** Random, first-party, never linked to a person. Lets sessions be told apart across visits. */
  anonymousId: string | null;
  session: { id: string; lastActiveAt: number } | null;
};

/**
 * Anonymous visitor and session ids for funnel analytics. This store is only ever read in the browser, in response
 * to events, so it hydrates immediately instead of waiting for a mount.
 */
export const useAnalyticsIdentity = create<Identity>()(
  persist<Identity>(() => ({ anonymousId: null, session: null }), { name: "jh.analytics.v1", version: 1, storage: browserStorage("local") }),
);

const newId = () => globalThis.crypto.randomUUID();

/** Activity is recorded at most this often, so a burst of events does not rewrite storage each time. */
const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

/** Current ids, creating the visitor id and rolling the session over after inactivity. `isNewSession` is true once per visit. */
export function touchIdentity(now: number = Date.now()): { anonymousId: string; sessionId: string; isNewSession: boolean } {
  const state = useAnalyticsIdentity.getState();
  const anonymousId = state.anonymousId ?? newId();
  const expired = !state.session || now - state.session.lastActiveAt > SESSION_IDLE_MS;
  if (expired) {
    const session = { id: newId(), lastActiveAt: now };
    useAnalyticsIdentity.setState({ anonymousId, session });
    return { anonymousId, sessionId: session.id, isNewSession: true };
  }
  const session = state.session!;
  if (state.anonymousId === null || now - session.lastActiveAt >= ACTIVITY_WRITE_INTERVAL_MS) {
    useAnalyticsIdentity.setState({ anonymousId, session: { ...session, lastActiveAt: now } });
  }
  return { anonymousId, sessionId: session.id, isNewSession: false };
}
