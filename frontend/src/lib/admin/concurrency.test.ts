import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { adminErrorMessage, isStaleRecord } from "./concurrency";

const fail = (status: number, message = "Refused", retryAfter?: number) => new ApiError(status, { code: "X", message, requestId: "r" }, retryAfter);

describe("adminErrorMessage", () => {
  it("tells an editor that a stale save lost to someone else, and what to do", () => {
    expect(adminErrorMessage(fail(412))).toBe("Someone else changed this. Reload to see their version.");
    expect(adminErrorMessage(fail(428))).toMatch(/reloaded/);
    expect(isStaleRecord(fail(412))).toBe(true);
    expect(isStaleRecord(fail(428))).toBe(true);
    expect(isStaleRecord(fail(409))).toBe(false);
  });
  it("explains permission, session, rate and connection problems", () => {
    expect(adminErrorMessage(fail(403))).toMatch(/permission/);
    expect(adminErrorMessage(fail(401))).toMatch(/Sign in again/);
    expect(adminErrorMessage(fail(429, "x", 30))).toMatch(/30 seconds/);
    expect(adminErrorMessage(fail(0))).toMatch(/connection/);
  });
  it("passes through the API's own message for rule violations, and hides server trouble", () => {
    expect(adminErrorMessage(fail(409, "That SKU is already used."))).toBe("That SKU is already used.");
    expect(adminErrorMessage(fail(500, "stack trace"))).toBe("The server had a problem. Please try again.");
    expect(adminErrorMessage(new Error("boom"))).toBe("Something went wrong. Please try again.");
  });
});
