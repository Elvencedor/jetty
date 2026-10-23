import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag: (...args: unknown[]) => revalidateTag(...args) }));

import { POST } from "./route";

const SECRET = "a-long-shared-secret-123";
const call = (body: unknown, secret?: string) =>
  POST(new Request("https://shop.test/api/revalidate", { method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-revalidate-secret": secret } : {}) }, body: JSON.stringify(body) }));

describe("POST /api/revalidate", () => {
  beforeEach(() => {
    revalidateTag.mockClear();
    process.env.REVALIDATE_SECRET = SECRET;
  });

  it("is closed without the shared secret, and when none is configured", async () => {
    expect((await call({ tags: ["settings"] })).status).toBe(403);
    expect((await call({ tags: ["settings"] }, "wrong-secret-of-same-ish-len")).status).toBe(403);
    delete process.env.REVALIDATE_SECRET;
    expect((await call({ tags: ["settings"] }, SECRET)).status).toBe(403);
    process.env.REVALIDATE_SECRET = "short";
    expect((await call({ tags: ["settings"] }, "short")).status).toBe(403);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("expires each named tag once, and ignores tags it does not know", async () => {
    const res = await call({ tags: ["settings", "home", "settings", "orders"] }, SECRET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revalidated: ["settings", "home"] });
    expect(revalidateTag.mock.calls).toEqual([["settings", { expire: 0 }], ["home", { expire: 0 }]]);
  });

  it("asks for at least one known tag", async () => {
    expect((await call({ tags: ["orders"] }, SECRET)).status).toBe(400);
    expect((await call({}, SECRET)).status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
