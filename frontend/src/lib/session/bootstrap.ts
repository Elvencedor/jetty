import { refreshAccessToken, type AuthKind } from "@/lib/api/client";
import { useAdminSession, useCustomerSession } from "@/lib/stores/session";
import { useSessionHints } from "@/lib/stores/session-hint";

const stores = { customer: useCustomerSession, admin: useAdminSession } as const;

/** Refresh this long before the access token expires, so requests never meet an expired token. */
export const REFRESH_LEAD_MS = 60_000;
/** After a refresh that failed without being rejected (lost connection), try again after this long. */
export const RETRY_MS = 30_000;

/**
 * Looks after one realm's session for as long as the tab is open: restores it from the refresh cookie on start,
 * and renews the access token shortly before it expires, whether the session came from the cookie or from the
 * customer signing in a moment ago. Returns a function that stops it.
 */
export function startSession(kind: AuthKind): () => void {
  const store = stores[kind];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let scheduledFor: number | null = null;

  const later = (delay: number) => {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(renew, Math.max(delay, 1000));
  };

  async function renew() {
    const before = store.getState().expiresAt;
    await refreshAccessToken(kind);
    if (stopped) return;
    // A rejection marks the store anonymous. Still unknown (first restore) or still holding the same token (a
    // renewal) means the server was unreachable, so try again soon instead of waiting for the token to lapse.
    // A successful renewal needs nothing here: the subscription below has already scheduled the next one.
    const { status, expiresAt } = store.getState();
    if (status === "unknown" || (status === "authenticated" && expiresAt === before)) later(RETRY_MS);
  }

  const unsubscribe = store.subscribe((state) => {
    // Remember whether this browser has been signed in, so first-time visitors skip a refresh that cannot succeed.
    if (state.status === "authenticated") useSessionHints.getState().set(kind, true);
    else if (state.status === "anonymous") useSessionHints.getState().set(kind, false);
    // Every new token (restored, refreshed or just signed in) schedules the next renewal.
    if (state.status === "authenticated" && state.expiresAt !== scheduledFor) {
      scheduledFor = state.expiresAt;
      later(state.expiresAt! - Date.now() - REFRESH_LEAD_MS);
    }
  });

  // A sleeping tab may miss its timer; renew as soon as it wakes if the token is about to lapse or has.
  const onVisible = () => {
    const { expiresAt, status } = store.getState();
    if (document.visibilityState === "visible" && status === "authenticated" && expiresAt && expiresAt - Date.now() < REFRESH_LEAD_MS) void renew();
  };
  document.addEventListener("visibilitychange", onVisible);

  if (useSessionHints.getState()[kind]) void renew();
  else if (store.getState().status === "unknown") store.getState().clear();

  return () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisible);
  };
}
