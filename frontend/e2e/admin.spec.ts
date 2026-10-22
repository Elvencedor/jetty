import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-1";

async function signIn(page: Page, email: string, url = "/admin/login") {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Admin" });

test("an owner signs in and sees every section, with badges for what waits on someone", async ({ page, isMobile }) => {
  await signIn(page, "owner@example.com");
  await expect(page).toHaveURL(/\/admin$/);
  if (isMobile) await page.getByRole("button", { name: "Menu", exact: true }).click();
  for (const label of ["Overview", "Orders", "Products", "Customers", "Promotions", "Storefront", "Reviews", "Settings"]) {
    await expect(nav(page).getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible();
  }
  // 3 to pack + 2 to dispatch + 1 awaiting transfer; 4 reviews waiting.
  await expect(nav(page).getByRole("link", { name: /^Orders/ })).toContainText("6");
  await expect(nav(page).getByRole("link", { name: /^Reviews/ })).toContainText("4");
  await expect(page.getByRole("heading", { level: 1, name: "Hello, owner" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("a role with fewer permissions sees fewer sections, and cannot open the others", async ({ page, isMobile }) => {
  await signIn(page, "support@example.com");
  await expect(page).toHaveURL(/\/admin$/);
  if (isMobile) await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(nav(page).getByRole("link")).toHaveText([/Overview/, /Orders/, /Customers/, /Reviews/]);
  await expect(nav(page).getByRole("link", { name: /Products/ })).toHaveCount(0);

  // Going straight to a section the role cannot use says so, rather than showing it.
  await page.goto("/admin/settings");
  await expect(page.getByText("You don't have access to this section")).toBeVisible();
  // A section it can use is there (its screen is still being built).
  await page.goto("/admin/customers");
  await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
  await expect(page.getByText("This screen is being built")).toBeVisible();
});

test("an unknown admin path is not found, and the admin is kept out of search engines", async ({ page, request }) => {
  await signIn(page, "owner@example.com");
  await page.goto("/admin/not-a-section");
  // The admin shows its skeleton until the session is confirmed; the not-found page follows.
  await expect(page.getByRole("heading", { name: /couldn.t find that page/i })).toBeVisible({ timeout: 15_000 });
  expect(await (await request.get("/robots.txt")).text()).toMatch(/Disallow: \/admin/);
  await page.goto("/admin");
  await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
});

test("signing in with a wrong password explains itself without saying which part was wrong", async ({ page }) => {
  await page.goto("/admin/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("nope");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("That email or password isn't right.")).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveValue("");
});

test("a visitor is sent to sign in and comes back to the page they asked for, but never to somewhere outside the admin", async ({ page, context }) => {
  await page.goto("/admin/customers");
  await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Fcustomers/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/customers$/);

  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());
  await signIn(page, "owner@example.com", "/admin/login?next=//evil.example");
  await expect(page).toHaveURL(/localhost:\d+\/admin$/);
});

test("the session survives a reload, and when the server ends it the admin is returned to sign in", async ({ page, context }) => {
  await signIn(page, "owner@example.com");
  await expect(page).toHaveURL(/\/admin$/);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Hello, owner" })).toBeVisible();

  // The server revokes this session (another admin disabled it, say). The next request that needs it fails with 401,
  // the refresh cookie is refused too, and the admin lands on the sign-in page.
  const sid = (await context.cookies()).find((c) => c.name === "jh_admin_refresh")!.value;
  await page.request.post(`http://localhost:4010/api/v1/__test/revoke-admin/${sid}`);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
  await expect(page).toHaveURL(/\/admin\/login\?next=/);
});

test("signing out returns to the sign-in page and keeps the next person out", async ({ page }) => {
  await signIn(page, "owner@example.com");
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByText("owner@example.com")).toBeVisible();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.goto("/admin/orders");
  await expect(page).toHaveURL(/\/admin\/login\?next=/);
});
