import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { createQueryClient } from "./providers";

describe("server-state defaults", () => {
  const retry = createQueryClient().getDefaultOptions().queries!.retry as (failures: number, error: Error) => boolean;
  const failure = (status: number) => new ApiError(status, { code: "X", message: "x", requestId: "r" });

  it("retries a lost connection or server trouble, but only twice", () => {
    expect(retry(0, failure(0))).toBe(true);
    expect(retry(1, failure(503))).toBe(true);
    expect(retry(2, failure(503))).toBe(false);
  });

  it("never retries something the server definitively refused", () => {
    for (const status of [400, 401, 403, 404, 409, 422]) expect(retry(0, failure(status))).toBe(false);
  });

  it("retries an unknown error, which is more likely a glitch than a refusal", () => {
    expect(retry(0, new Error("boom"))).toBe(true);
  });
});
