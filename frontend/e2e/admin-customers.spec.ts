import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ADAEZE = "00000000-0000-4000-8000-000000000800";

async function signIn(page: Page, who: string, next: string) {
  await page.goto("/admin/login?next=" + encodeURIComponent(next));
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(`${who}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(next.replace("?", "\\?")));
}

const drawer = (page: Page) => page.getByRole("dialog", { name: "Customer profile" });

test("segment tiles show their counts and rules, filter the list, and the list is accessible", async ({ page }) => {
  await signIn(page, "owner", "/admin/customers");
  await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
  await expect(page.getByText("1,842 customers")).toBeVisible();
  const vip = page.getByRole("button", { name: /VIP/ });
  await expect(vip).toContainText("5 or more orders, or ₦1,000,000 spent");
  await expect(page.getByRole("button", { name: /Everyone/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("table", { name: "Customers" }).getByRole("button")).toHaveCount(4);

  await vip.click();
  await expect(page).toHaveURL(/segment=vip/);
  await expect(vip).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("table", { name: "Customers" }).getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Adaeze Okafor/ })).toBeVisible();
  await page.getByRole("button", { name: /Everyone/ }).click();

  await page.getByRole("searchbox", { name: "Search customers" }).fill("quiet@");
  await expect(page.getByRole("table", { name: "Customers" }).getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^quiet@example.com/ })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search customers" }).fill("zzz");
  await expect(page.getByText("No customers match")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search customers" }).fill("");

  const table = page.getByRole("table", { name: "Customers" });
  await expect(table.getByRole("row", { name: /Adaeze Okafor/ })).toContainText("₦612k");
  await expect(table.getByRole("row", { name: /Adaeze Okafor/ })).toContainText("VIP");
  await expect(table.getByRole("row", { name: /quiet@example.com/ })).toContainText("Never");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("the drawer shows the profile, contact and recent orders, which open in Orders", async ({ page }) => {
  await signIn(page, "owner", `/admin/customers?customer=${ADAEZE}`);
  const d = drawer(page);
  await expect(d.getByRole("heading", { name: "Adaeze Okafor" })).toBeVisible();
  await expect(d.getByText("Customer since Mar 2026 · Lekki, Lagos")).toBeVisible();
  await expect(d.getByText("Orders", { exact: true })).toBeVisible();
  await expect(d.getByText("Avg order")).toBeVisible();
  await expect(d.getByText("0803 000 0000 · adaeze@example.com")).toBeVisible();
  await expect(d.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/2348030000000");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await d.getByRole("link", { name: /#JH-10481/ }).click();
  await expect(page).toHaveURL(/\/admin\/orders\?order=/);
});

test("a customer who has not ordered is shown by their email and says so", async ({ page }) => {
  await signIn(page, "owner", "/admin/customers?customer=00000000-0000-4000-8000-000000000802");
  await expect(drawer(page).getByText("No orders yet.")).toBeVisible();
  await expect(drawer(page).getByRole("heading", { name: "quiet@example.com" })).toBeVisible();
});
