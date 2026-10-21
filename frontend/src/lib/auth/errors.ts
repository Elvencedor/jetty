import { isApiError } from "@/lib/api/client";

/** Plain-language text for an auth failure. The API deliberately says little (to avoid revealing who has an account); so do we. */
export function authErrorMessage(err: unknown, context: "password" | "code" | "register" | "reset" | "request"): string {
  if (!isApiError(err)) return "Something went wrong. Please try again.";
  switch (err.code) {
    case "INVALID_CREDENTIALS":
      return "That email or password isn't right.";
    case "INVALID_CODE":
      return context === "reset" ? "That code isn't right or has expired. Request a new one." : "That code isn't right or has expired.";
    case "ACCOUNT_EXISTS":
      return "An account with those details already exists. Try signing in.";
    case "RATE_LIMITED":
      return `Too many attempts. Try again in ${err.retryAfterSeconds ?? 60} seconds.`;
    case "VALIDATION_FAILED":
      return "Please check the details you entered.";
    case "AUTH_UNAVAILABLE":
      return "Sign-in is unavailable right now. Please try again shortly.";
    default:
      return err.retryable ? "We couldn't reach the server. Check your connection and try again." : context === "request" ? "We couldn't send a code. Please try again." : err.message;
  }
}
