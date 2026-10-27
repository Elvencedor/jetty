import { create } from "zustand";
import type { AdminIdentity, Customer } from "@/lib/api/types";

/**
 * `unknown` until the first refresh attempt finishes, so screens can show a skeleton instead of flashing a
 * signed-out state at someone who is signed in.
 */
export type SessionStatus = "unknown" | "authenticated" | "anonymous";

export type SessionState<User> = {
  status: SessionStatus;
  /** 15-minute bearer token. Memory only: it is never written to storage. */
  accessToken: string | null;
  /** Epoch milliseconds at which the token expires. */
  expiresAt: number | null;
  user: User | null;
  setSession: (session: { accessToken: string; expiresIn: number; user: User }) => void;
  setUser: (user: User) => void;
  clear: () => void;
};

function createSessionStore<User>() {
  return create<SessionState<User>>()((set) => ({
    status: "unknown",
    accessToken: null,
    expiresAt: null,
    user: null,
    setSession: ({ accessToken, expiresIn, user }) => set({ status: "authenticated", accessToken, expiresAt: Date.now() + expiresIn * 1000, user }),
    setUser: (user) => set({ user }),
    clear: () => set({ status: "anonymous", accessToken: null, expiresAt: null, user: null }),
  }));
}

/** Customer and admin sessions are independent and their tokens are not interchangeable. */
export const useCustomerSession = createSessionStore<Customer>();
export const useAdminSession = createSessionStore<AdminIdentity>();
