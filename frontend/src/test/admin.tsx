import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { HttpResponse } from "msw";
import type { ReactElement } from "react";
import { useAdminSession } from "@/lib/stores/session";

/** Signs an admin in so the API client sends a token instead of trying to refresh one. */
export function signInAdmin(permissions: string[] = ["settings:read", "settings:write"]) {
  useAdminSession.getState().setSession({ accessToken: "admin-token", expiresIn: 900, user: { id: "a1", email: "owner@example.com", roles: ["owner"], permissions } });
}

export function renderAdmin(ui: ReactElement) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{ui}</QueryClientProvider>);
}

/** The refusal the API gives to an edit made against a version that is no longer current. */
export const staleResponse = (currentVersion?: number) =>
  HttpResponse.json({ error: { code: "PRECONDITION_FAILED", message: "This record changed since you loaded it. Reload and try again.", requestId: "r1", ...(currentVersion === undefined ? {} : { details: [{ currentVersion }] }) } }, { status: 412 });
