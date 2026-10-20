import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Adds the preselected Bone Straight wig (₦180,000), retrying the tap until the page has hydrated. */
async function addWig(page: Page) {
  await page.goto("/p/bone-straight-frontal");
  const add = page.getByRole("button", { name: /Add to bag/ });
  await expect(async () => {
    await add.click();
    await expect(page.getByRole("status").filter({ hasText: "Added to your bag" })).toBeVisible({ timeout: 500 });
  }).toPass();
}

test("an empty bag points back to the shop", async ({ page }) => {
  await page.goto("/bag");
  await expect(page.getByRole("heading", { name: "Your bag is empty" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Shop wigs" })).toBeVisible();
});

test("the bag prices the server's way: quantity, codes and removal with undo", async ({ page }) => {
  await addWig(page);
  await page.goto("/bag");
  await expect(page.getByRole("heading", { level: 1, name: /My bag/ })).toBeVisible();
  const summary = page.getByRole("region", { name: "Order summary" });
  await expect(summary.getByText("₦180,000").first()).toBeVisible();

  // Quantity: the line changes at once, the total follows the server.
  await page.getByRole("button", { name: /Increase quantity of Bone Straight/ }).click();
  await expect(summary.getByText("₦360,000").first()).toBeVisible();

  // A code the server accepts is shown as a saving; one it refuses explains itself and can be removed.
  await page.getByLabel("Promotion code").fill("save10");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("You’re saving ₦36,000")).toBeVisible();
  await page.getByLabel("Promotion code").fill("nope");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("That code isn't valid.")).toBeVisible();
  await page.getByRole("button", { name: "Remove code NOPE" }).click();
  await expect(page.getByText("That code isn't valid.")).toHaveCount(0);

  // Numbers are deliberately dimmed while a new price loads, so check the settled page.
  await expect(summary).toHaveAttribute("aria-busy", "false");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // Removing offers an undo, which puts the line back with its quantity.
  await page.getByRole("button", { name: /Remove Bone Straight/ }).click();
  await expect(page.getByRole("heading", { name: "Your bag is empty" })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("group", { name: /Quantity of Bone Straight/ }).getByRole("status")).toHaveText("2");
});

test("the bag survives a reload", async ({ page }) => {
  await addWig(page);
  await page.goto("/bag");
  await page.reload();
  await expect(page.getByRole("article", { name: "Bone Straight Frontal Wig" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Checkout" })).toBeVisible();
});
