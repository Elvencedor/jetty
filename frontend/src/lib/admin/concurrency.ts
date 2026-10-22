import { isApiError } from "@/lib/api/client";

/** What an admin should read after a failed save. Specific where the API is, plain where it is not. */
export function adminErrorMessage(err: unknown): string {
  if (!isApiError(err)) return "Something went wrong. Please try again.";
  switch (err.status) {
    case 0:
      return "We couldn't reach the server. Check your connection and try again.";
    case 401:
      return "Your session has ended. Sign in again to continue.";
    case 403:
      return "You don't have permission to do that.";
    case 412:
      // The record changed since it was read (its ETag no longer matches).
      return "Someone else changed this. Reload to see their version.";
    case 428:
      return "This record needs to be reloaded before it can be saved.";
    case 429:
      return `Too many requests. Try again in ${err.retryAfterSeconds ?? 60} seconds.`;
    default:
      return err.status >= 500 ? "The server had a problem. Please try again." : err.message;
  }
}

/** A save refused because the record moved on: show the message with a Reload action, not a retry. */
export const isStaleRecord = (err: unknown) => isApiError(err) && (err.status === 412 || err.status === 428);
