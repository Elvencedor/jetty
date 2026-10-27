import { expect, test } from "@playwright/test";

test("every page carries the security headers, with the content policy in report-only mode", async ({ request }) => {
  for (const path of ["/", "/admin/login"]) {
    const res = await request.get(path);
    const h = res.headers();
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(h["content-security-policy-report-only"], path).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy-report-only"], path).toContain("https://js.paystack.co");
    expect(h["content-security-policy"], "not enforcing yet").toBeUndefined();
  }
});
