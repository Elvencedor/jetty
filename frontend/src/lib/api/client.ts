import { useAdminSession, useCustomerSession } from "@/lib/stores/session";
import { useSessionHints } from "@/lib/stores/session-hint";
import type { SessionStatus } from "@/lib/stores/session";
import type { AdminSessionResponse, SessionResponse } from "./types";

/**
 * The only place that talks HTTP to the hapi API. It handles the contract's error envelope, the in-memory bearer
 * token (read from the Zustand session stores), a single refresh-and-retry on 401, and the headers the API relies
 * on (`Idempotency-Key`, `If-Match`, `ETag`, `Retry-After`).
 */

export type ApiErrorBody = { error: { code: string; message: string; requestId: string; details?: unknown[] } };

/** Thrown for any failed request, including network failures (`status` 0, code `NETWORK_ERROR`). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly details: unknown[] | undefined;
  /** Seconds to wait before retrying, from the `Retry-After` header of a 429. */
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, body: ApiErrorBody["error"], retryAfterSeconds?: number) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.requestId = body.requestId;
    this.details = body.details;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** A failure that retrying the identical request could fix (server trouble, rate limit, lost connection). */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export const isApiError = (err: unknown): err is ApiError => err instanceof ApiError;

export function apiBaseUrl(): string {
  const url = (typeof window === "undefined" ? process.env.API_BASE_URL : undefined) ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!url) {
    throw new Error("API base URL is not configured. Set API_BASE_URL (server) and NEXT_PUBLIC_API_BASE_URL (browser).");
  }
  return url.replace(/\/+$/, "");
}

export const apiUrl = (path: string) => `${apiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;

export type AuthKind = "customer" | "admin";
type QueryValue = string | number | boolean | undefined | null | (string | number)[];

export type RequestOptions = Omit<RequestInit, "body"> & {
  /** Serialised as JSON. */
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Attach this realm's bearer token, refreshing it (once) when it is missing or rejected. */
  auth?: AuthKind;
  /** With `auth`: send the token when there is one, but carry on as a guest when there is not (quotes). */
  authOptional?: boolean;
  /** Required by the contract for checkout, payment and refund operations. */
  idempotencyKey?: string;
  /** The `ETag` last read for this record; admin edits need it (412 if stale, 428 if missing). */
  ifMatch?: string;
};

export type ApiResult<T> = { data: T; status: number; headers: Headers; etag: string | null };

export function withQuery(path: string, query?: Record<string, QueryValue>): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, String(v)));
    else params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}${path.includes("?") ? "&" : "?"}${qs}` : path;
}

/** What reaches `fetch`: the request options without the authentication ones, which `apiRequest` has handled. */
type SendOptions = Omit<RequestOptions, "auth" | "authOptional">;

async function send<T>(path: string, options: SendOptions, token: string | null): Promise<ApiResult<T>> {
  const { body, query, idempotencyKey, ifMatch, headers, ...init } = options;
  let response: Response;
  try {
    response = await fetch(apiUrl(withQuery(path, query)), {
      // Cookies (refresh token, guest checkout token) must travel to the API's own origin from the browser.
      ...(typeof window === "undefined" ? {} : { credentials: "include" as const }),
      ...init,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...(ifMatch ? { "If-Match": ifMatch } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (cause) {
    // Compared by name: DOMException is a different class in different JS realms (browser, jsdom, Node).
    if (typeof cause === "object" && cause !== null && (cause as { name?: string }).name === "AbortError") throw cause;
    throw new ApiError(0, { code: "NETWORK_ERROR", message: "We could not reach the server. Check your connection and try again.", requestId: "unknown" });
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // Not JSON (a proxy error page, say): handled below as a generic failure.
    }
  }

  if (!response.ok) {
    const envelope = (payload as ApiErrorBody | null)?.error;
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new ApiError(
      response.status,
      envelope ?? { code: "REQUEST_FAILED", message: response.statusText || "The request failed.", requestId: response.headers.get("x-request-id") ?? "unknown" },
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
  }
  if (text && payload === null) {
    throw new ApiError(response.status, { code: "REQUEST_FAILED", message: "The server sent an unreadable response.", requestId: response.headers.get("x-request-id") ?? "unknown" });
  }
  return { data: payload as T, status: response.status, headers: response.headers, etag: response.headers.get("etag") };
}

// ---------------------------------------------------------------- authenticated requests

type Realm = { refreshPath: string; hasHint: () => boolean; status: () => SessionStatus; token: () => string | null; start: (res: SessionResponse | AdminSessionResponse) => void; clear: () => void };

const REALMS: Record<AuthKind, Realm> = {
  customer: {
    refreshPath: "/auth/refresh",
    hasHint: () => useSessionHints.getState().customer,
    status: () => useCustomerSession.getState().status,
    token: () => useCustomerSession.getState().accessToken,
    start: (res) => {
      const { customer } = res as SessionResponse;
      useCustomerSession.getState().setSession({ accessToken: res.accessToken, expiresIn: res.expiresIn, user: customer });
    },
    clear: () => useCustomerSession.getState().clear(),
  },
  admin: {
    refreshPath: "/admin/auth/refresh",
    hasHint: () => useSessionHints.getState().admin,
    status: () => useAdminSession.getState().status,
    token: () => useAdminSession.getState().accessToken,
    start: (res) => {
      const { admin } = res as AdminSessionResponse;
      useAdminSession.getState().setSession({ accessToken: res.accessToken, expiresIn: res.expiresIn, user: admin });
    },
    clear: () => useAdminSession.getState().clear(),
  },
};

const refreshing: Partial<Record<AuthKind, Promise<string | null>>> = {};

/**
 * Exchanges the HttpOnly refresh cookie for a new access token. Calls are shared, so a page that fires several
 * requests at once refreshes only once. Resolves to null when there is no valid session (the store is then
 * marked anonymous); a network failure leaves the session as it was so a flaky connection does not sign anyone out.
 */
export function refreshAccessToken(kind: AuthKind): Promise<string | null> {
  const realm = REALMS[kind];
  refreshing[kind] ??= (async () => {
    try {
      const { data } = await send<SessionResponse | AdminSessionResponse>(realm.refreshPath, { method: "POST" }, null);
      realm.start(data);
      return data.accessToken;
    } catch (err) {
      if (isApiError(err) && err.status !== 0 && err.status < 500) realm.clear();
      return null;
    } finally {
      delete refreshing[kind];
    }
  })();
  return refreshing[kind]!;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const { auth: kind, authOptional, ...request } = options;
  if (!kind) return send<T>(path, request, null);

  const realm = REALMS[kind];
  let token = realm.token();
  // Before the first refresh has finished there is no token yet: wait for it rather than failing, but only if this
  // browser has ever been signed in (otherwise the refresh is certain to be rejected, so do not ask).
  if (!token && realm.status() === "unknown" && realm.hasHint()) token = await refreshAccessToken(kind);
  if (!token && authOptional) return send<T>(path, request, null);
  if (!token) throw new ApiError(401, { code: "UNAUTHENTICATED", message: "Authentication is required.", requestId: "unknown" });

  try {
    return await send<T>(path, request, token);
  } catch (err) {
    if (!isApiError(err) || err.status !== 401) throw err;
    // The token expired or was revoked. Try the refresh cookie once; if that fails too, the session is over.
    const fresh = await refreshAccessToken(kind);
    if (!fresh) throw err;
    return send<T>(path, request, fresh);
  }
}

/** Like `apiRequest` but returns just the body. */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await apiRequest<T>(path, options)).data;
}
