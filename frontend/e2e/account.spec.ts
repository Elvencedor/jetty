import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-1";

async function open(page: Page, url: string) {
  await page.goto(url);
  // Typing or submitting before the page is interactive would be lost.
  await page.waitForLoadState("networkidle");
}

async function signIn(page: Page, url = "/account/sign-in") {
  await open(page, url);
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
}

test("a customer signs in with email and password, and stays signed in after a reload", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { level: 1, name: "Me" })).toBeVisible();
  await expect(page.getByText("ada@example.com")).toBeVisible();

  // Only the refresh cookie remembers them: the access token lives in memory.
  await page.reload();
  await expect(page.getByText("ada@example.com")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/account");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
});

test("a wrong password is refused with a message that does not say which part was wrong", async ({ page }) => {
  await open(page, "/account/sign-in");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page.getByText("That email or password isn't right.")).toBeVisible();
  await expect(page.getByLabel("Password")).toHaveValue("");
});

test("registration checks the fields, explains a taken email, and signs the new customer in", async ({ page }) => {
  await open(page, "/account/sign-in?mode=register");
  await page.getByRole("button", { name: "Create account" }).last().click();
  await expect(page.getByText("Enter a valid email")).toBeVisible();

  await page.getByLabel("Email").fill("taken@example.com");
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).last().click();
  await expect(page.getByText("Use at least 10 characters")).toBeVisible();

  await page.getByLabel("Password").fill("a-long-enough-password");
  await page.getByRole("button", { name: "Create account" }).last().click();
  await expect(page.getByText(/already exists/)).toBeVisible();

  await page.getByLabel("Email").fill("new@example.com");
  await page.getByRole("button", { name: "Create account" }).last().click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText("new@example.com")).toBeVisible();
});

test("protected pages send a guest to sign in and bring them back; unsafe return links are ignored", async ({ page }) => {
  await page.goto("/account/orders");
  await expect(page).toHaveURL(/\/account\/sign-in\?next=%2Faccount%2Forders/);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page).toHaveURL(/\/account\/orders$/);
  await expect(page.getByRole("heading", { level: 1, name: "My orders" })).toBeVisible();
  await page.context().clearCookies();

  await signIn(page, "/account/sign-in?next=//evil.example");
  await expect(page).toHaveURL(/localhost:\d+\/account$/);
});

test("a signed-in customer sees an order, follows its progress and writes a review", async ({ page }) => {
  await signIn(page, "/account/sign-in?next=/account/orders");
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

test("resetting a password takes an emailed code and says everyone is signed out", async ({ page }) => {
  await open(page, "/account/reset-password");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText(/If there's an account/)).toBeVisible();
  await page.getByLabel("Code").fill("123456");
  await page.getByLabel("New password").fill("a-brand-new-password");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Your password has been changed.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});
