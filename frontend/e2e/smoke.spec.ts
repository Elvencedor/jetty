import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the home renders with the brand fonts and tokens, and is accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/jetty/i);
  const hero = page.getByRole("link", { name: /Wigs you will love/ });
  await expect(hero).toBeVisible();

  // Tokens are wired in: the logo tile is the brand pink, and the hero card is too.
  await expect(page.locator('header a[href="/"] span').first()).toHaveCSS("background-color", "rgb(214, 31, 105)");
  await expect(hero.getByText("Wigs you will love")).toHaveCSS("font-family", /Bricolage/);
  await expect(page.locator("main p").first()).toHaveCSS("font-family", /Figtree/);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("the skip link is the first thing keyboard users reach and it lands on the main content", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard navigation is a desktop concern");
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("an unknown page shows the branded 404 and a way home", async ({ page }) => {
  const response = await page.goto("/definitely-not-a-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /couldn.t find that page/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to home" })).toBeVisible();
});

test("the developer gallery does not exist in production", async ({ page }) => {
  const response = await page.goto("/dev/ui");
  expect(response?.status()).toBe(404);
});
