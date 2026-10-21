import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("a shopper can browse the listing, filter it from the URL and search", async ({ page }) => {
  await page.goto("/shop");
  await expect(page.getByRole("heading", { level: 1, name: "All wigs" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /wigs$/ })).toHaveText("3 wigs");
  await expect(page.getByRole("link", { name: "Glueless Bob Wig" })).toBeVisible();

  // Filters live in the URL, so a reload keeps them.
  await page.goto("/shop?inStock=1");
  await expect(page.getByRole("status").filter({ hasText: /wigs?$/ })).toHaveText("2 wigs");
  await expect(page.getByRole("link", { name: "Deep Curly Closure Wig" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: /wigs?$/ })).toHaveText("2 wigs");
  await expect(page.getByRole("button", { name: "All filters · 1" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("the filter sheet applies a choice and shows how many wigs match", async ({ page }) => {
  await page.goto("/shop");
  await page.getByRole("button", { name: /^All filters/ }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: /In stock only/ }).or(sheet.getByRole("switch", { name: "In stock only" })).first().click();
  await expect(sheet.getByRole("button", { name: "Show 2 wigs" })).toBeVisible();
  await sheet.getByRole("button", { name: "Show 2 wigs" }).click();
  await expect(page).toHaveURL(/inStock=1/);
  await expect(sheet).toBeHidden();
});

test("search suggests products and opens a result", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("combobox", { name: "Search wigs" });
  await box.fill("bob");
  const option = page.getByRole("option", { name: "Glueless Bob Wig" });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page).toHaveURL(/\/p\/glueless-bob$/);
  await expect(page.getByRole("heading", { level: 1, name: "Glueless Bob Wig" })).toBeVisible();
});

test("a product page resolves variants, disables sold-out choices and adds to the bag", async ({ page }) => {
  await page.goto("/p/bone-straight-frontal");
  await expect(page.getByRole("heading", { level: 1, name: "Bone Straight Frontal Wig" })).toBeVisible();

  // The best seller is preselected, and the price comes from the server quote.
  await expect(page.getByRole("button", { name: /Add to bag · ₦180,000/ })).toBeEnabled();

  // 14 inch × Swiss lace is sold out, so that chip cannot be picked and says why.
  await page.getByRole("button", { name: /Lace/ }).click();
  await expect(page.getByRole("button", { name: "Swiss lace, sold out" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^HD lace/ })).toHaveAttribute("aria-pressed", "true");

  // Changing the length to one that has no Swiss lace at all keeps the choices that still make sense.
  await page.getByRole("button", { name: /Length/ }).click();
  await page.getByRole("button", { name: "20 inch" }).click();
  await expect(page.getByRole("button", { name: /Add to bag · ₦240,000/ })).toBeEnabled();

  await page.getByRole("button", { name: /Add to bag/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added to bag" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View bag" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("saving a wig keeps it on the saved page", async ({ page }) => {
  await page.goto("/shop");
  const heart = page.getByRole("button", { name: "Save Glueless Bob Wig" });
  // A tap before the page has hydrated does nothing, so keep tapping until it takes.
  await expect(async () => {
    await heart.click();
    await expect(heart).toHaveAttribute("aria-pressed", "true", { timeout: 500 });
  }).toPass();
  await page.goto("/saved");
  await expect(page.getByRole("link", { name: "Glueless Bob Wig" })).toBeVisible();
});

test("an unknown product shows the not-found page", async ({ page }) => {
  // The page streams, so the status is already 200 when the product turns out not to exist; Next marks it noindex.
  await page.goto("/p/not-a-real-wig");
  await expect(page.getByRole("heading", { name: /couldn.t find that page/i })).toBeVisible();
  await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
});

test("a category page lists its products and an unknown one is not found", async ({ page }) => {
  await page.goto("/shop/frontal");
  await expect(page.getByRole("heading", { level: 1, name: "Frontal wigs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bone Straight Frontal Wig" })).toBeVisible();
  await page.goto("/shop/new-arrivals");
  await expect(page.getByRole("heading", { level: 1, name: "New arrivals" })).toBeVisible();
  await page.goto("/shop/no-such-thing");
  await expect(page.getByRole("heading", { name: /couldn.t find that page/i })).toBeVisible();
});
