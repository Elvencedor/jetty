import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("the placeholder home renders with the brand fonts and tokens, and is accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/wigs you will love/i);

  // Tokens are wired in: the primary button is the brand pink, not a browser default.
  const button = page.getByRole("link", { name: "Shop wigs" });
  await expect(button).toHaveCSS("background-color", "rgb(214, 31, 105)");
  await expect(button).toHaveCSS("border-radius", "9999px");

  // The heading uses the display font (Bricolage Grotesque), body copy the body font (Figtree).
  await expect(page.getByRole("heading", { level: 1 })).toHaveCSS("font-family", /Bricolage/);
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
