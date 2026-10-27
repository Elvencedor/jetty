import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, next: string, who = "owner") {
  await page.goto("/admin/login?next=" + encodeURIComponent(next));
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(`${who}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(next.replace(/[?]/g, "\\?")));
}

// Categories and collections are one shared fixture, so these run one at a time, on desktop, from a fresh copy.
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ request, isMobile }) => {
  test.skip(isMobile, "the shared fixture is edited from the desktop profile only");
  await request.post("http://localhost:4010/api/v1/__test/reset-taxonomy");
});

test("products link to categories and collections, which show a tree with counts and are accessible", async ({ page }) => {
  await signIn(page, "/admin/products");
  await page.getByRole("link", { name: "Categories & collections" }).click();
  await expect(page).toHaveURL(/\/admin\/products\/organise$/);
  const list = page.getByRole("region", { name: "Categories" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list.getByRole("listitem").nth(1)).toContainText("HD lace");
  await expect(list.getByRole("listitem").nth(1)).toContainText("5 products");
  await expect(list.getByRole("listitem").nth(0)).toContainText("12 products");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("a category is created under a parent, with its web address made from the name, and can be hidden", async ({ page }) => {
  await signIn(page, "/admin/products/organise");
  await page.getByRole("button", { name: "New category" }).click();
  const d = page.getByRole("dialog", { name: "New category" });
  await d.getByRole("button", { name: "Create category" }).click();
  await expect(d.getByText("Give it a name")).toBeVisible();
  await d.getByLabel("Name").fill("Glueless Wigs");
  await expect(d.getByLabel("Web address")).toHaveValue("glueless-wigs");
  await d.getByLabel("Sits under").selectOption({ label: "Frontal wigs" });
  await d.getByRole("button", { name: "Create category" }).click();
  await expect(d).toBeHidden();
  await expect(page.getByRole("region", { name: "Categories" }).getByRole("listitem").filter({ hasText: "Glueless Wigs" })).toBeVisible();

  await page.getByRole("button", { name: "Edit Hair care" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Hair care" });
  await edit.getByRole("switch", { name: "Show this category to shoppers" }).click();
  await edit.getByRole("button", { name: "Save category" }).click();
  await expect(page.getByRole("region", { name: "Categories" }).getByRole("listitem").filter({ hasText: "Hair care" }).getByText("Hidden")).toBeVisible();
});

test("a category cannot be moved under itself or its own sub-category", async ({ page }) => {
  await signIn(page, "/admin/products/organise");
  await page.getByRole("button", { name: "Edit Frontal wigs" }).click();
  const options = page.getByRole("dialog", { name: "Edit Frontal wigs" }).getByLabel("Sits under").locator("option");
  await expect(options).toHaveText(["Top level", "Hair care"]);
});

test("a collection gets products in an order, and its count follows", async ({ page }) => {
  await signIn(page, "/admin/products/organise?tab=collections");
  const list = page.getByRole("region", { name: "Collections" });
  await expect(list.getByRole("listitem").filter({ hasText: "Bob wigs" })).toContainText("1 product");
  await page.getByRole("button", { name: "Edit Frontals" }).click();
  const d = page.getByRole("dialog", { name: "Edit Frontals" });
  await d.getByRole("button", { name: "Add Bone Straight HD Frontal" }).click();
  await expect(d.getByRole("button", { name: "Added Bone Straight HD Frontal" })).toBeDisabled();
  await expect(d.getByRole("heading", { name: "Products (1)" })).toBeVisible();
  await d.getByLabel("Description").fill("Our best frontals");
  await d.getByRole("button", { name: "Save collection" }).click();
  await expect(d).toBeHidden();
  await expect(list.getByRole("listitem").filter({ hasText: "Frontals" })).toContainText("1 product");

  await page.getByRole("button", { name: "New collection" }).click();
  const n = page.getByRole("dialog", { name: "New collection" });
  await n.getByLabel("Name").fill("Summer edit");
  await n.getByRole("button", { name: "Create collection" }).click();
  await expect(list.getByRole("listitem").filter({ hasText: "Summer edit" })).toContainText("0 products");
});
