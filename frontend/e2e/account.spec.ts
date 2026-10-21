import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, url: string) {
  await page.goto(url);
  // Typing or submitting before the page is interactive would be lost.
  await page.waitForLoadState("networkidle");
}

async function signInByCode(page: Page, url = "/account/sign-in") {
  await open(page, url);
  await page.getByLabel("Phone number").fill("0803 123 4567");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByText(/We texted a 6-digit code/)).toBeVisible();
  await page.getByLabel("Code").fill("123456");
}

test("a customer signs in with a texted code, and stays signed in after a reload", async ({ page }) => {
  await signInByCode(page);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { level: 1, name: "Me" })).toBeVisible();
  await expect(page.getByText("0803 123 4567")).toBeVisible();

  // Only the refresh cookie remembers them: the access token lives in memory.
  await page.reload();
  await expect(page.getByText("0803 123 4567")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/account");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
});

test("a wrong code is refused with a clear message", async ({ page }) => {
  await open(page, "/account/sign-in");
  await page.getByLabel("Phone number").fill("0803 123 4567");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Code").fill("000000");
  await expect(page.getByText("That code isn't right or has expired.")).toBeVisible();
  await expect(page.getByLabel("Code")).toHaveValue("");
});

test("password sign-in and registration explain what went wrong", async ({ page }) => {
  await open(page, "/account/sign-in");
  await page.getByRole("tab", { name: "Password" }).click();
  await page.getByLabel("Phone number or email").fill("0803 123 4567");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That phone, email or password isn't right.")).toBeVisible();

  await page.getByRole("tab", { name: "New here" }).click();
  await page.getByLabel("Phone number").fill("0803 111 0000");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 10 characters")).toBeVisible();
  await page.getByLabel("Password").fill("a-long-enough-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/already exists/)).toBeVisible();

  await page.getByLabel("Phone number").fill("0803 999 8888");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account$/);
});

test("protected pages send a guest to sign in and bring them back; unsafe return links are ignored", async ({ page }) => {
  await page.goto("/account/orders");
  await expect(page).toHaveURL(/\/account\/sign-in\?next=%2Faccount%2Forders/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Phone number").fill("0803 123 4567");
  await page.getByRole("button", { name: "Send me a code" }).click();
  await page.getByLabel("Code").fill("123456");
  await expect(page).toHaveURL(/\/account\/orders$/);
  await expect(page.getByRole("heading", { level: 1, name: "My orders" })).toBeVisible();
  await page.context().clearCookies();

  await signInByCode(page, "/account/sign-in?next=//evil.example");
  await expect(page).toHaveURL(/localhost:\d+\/account$/);
});

test("a signed-in customer sees an order, follows its progress and writes a review", async ({ page }) => {
  await signInByCode(page, "/account/sign-in?next=/account/orders");
  await expect(page).toHaveURL(/\/account\/orders$/);
  await page.getByRole("link", { name: /#JH-20001/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Order #JH-20001" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Order progress" })).toBeVisible();

  await page.getByRole("button", { name: "Write a review" }).click();
  await page.locator("label").filter({ hasText: "5 stars" }).click();
  await page.getByRole("button", { name: "Send review" }).click();
  await expect(page.getByText(/Your review will appear once we've checked it/)).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("resetting a password takes a code and signs the customer out everywhere", async ({ page }) => {
  await open(page, "/account/reset-password");
  await page.getByLabel("Phone number or email").fill("0803 123 4567");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText(/If there's an account/)).toBeVisible();
  await page.getByLabel("Code").fill("123456");
  await page.getByLabel("New password").fill("a-brand-new-password");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Your password has been changed.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});
