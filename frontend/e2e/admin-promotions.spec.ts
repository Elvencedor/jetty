import AxeBuilder from "@axe-core/playwright";
import { choose } from "./dropdown";
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, next: string, who = "owner") {
  await page.goto("/admin/login?next=" + encodeURIComponent(next));
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(`${who}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(next));
}

// The promotions are one shared fixture, so these run one at a time, on desktop, from a fresh copy.
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ request, isMobile }) => {
  test.skip(isMobile, "the shared fixture promotions are edited from the desktop profile only");
  await request.post("http://localhost:4010/api/v1/__test/reset-promotions");
});

const BOGO = "00000000-0000-4000-8000-000000000971";

test("the page shows what is running, a calendar, and switches promotions on and off", async ({ page }) => {
  await signIn(page, "/admin/promotions");
  await expect(page.getByRole("heading", { level: 1, name: "Promotions & storefront" })).toBeVisible();
  await expect(page.getByText("1 live · 1 scheduled · 1 ended · 1 not running")).toBeVisible();
  const calendar = page.getByRole("region", { name: "Campaign calendar" });
  await expect(calendar.getByText("BOGO · Bob wigs", { exact: true })).toBeVisible();
  await expect(calendar.getByRole("link", { name: /BOGO · Bob wigs, Live/ })).toBeVisible();

  const list = page.getByRole("region", { name: "All promotions" });
  await expect(list.getByText("74 uses")).toBeVisible();
  await list.getByRole("switch", { name: "Switch off BOGO · Bob wigs" }).click();
  await expect(list.getByRole("switch", { name: "Switch on BOGO · Bob wigs" })).toBeVisible();
  await expect(page.getByText("0 live")).toBeVisible();
  await expect(list.getByRole("switch", { name: /Summer sale/ })).toHaveCount(0);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("a promotion is built in four steps, read back in words, previewed, and scheduled", async ({ page }) => {
  await signIn(page, "/admin/promotions/new");
  const steps = page.getByRole("list", { name: "Steps" });
  await expect(steps.getByRole("button", { name: /1 Type/ })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { level: 2, name: "Type" })).toBeFocused();
  await expect(page.getByRole("radio", { name: /Percentage off/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Rule" })).toBeFocused();
  await page.getByLabel("Name", { exact: true }).fill("Flash sale: frontals");
  await page.getByLabel("Percent off").fill("95");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByText("Enter a percentage from 1 to 90")).toBeVisible();
  await expect(steps.getByRole("button", { name: /2 Rule/ })).toHaveAttribute("aria-current", "step");

  await page.getByLabel("Percent off").fill("15");
  await choose(page.getByLabel("Which products"), "chosen collections");
  await page.getByRole("button", { name: "Frontals" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Take 15% off products in Frontals." })).toBeVisible();
  const preview = page.getByRole("complementary", { name: "Preview" });
  await expect(preview.getByText("15% off on Frontals")).toBeVisible();
  await expect(preview.getByText("−₦22,500")).toBeVisible();

  await page.getByRole("button", { name: "With a code" }).click();
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.getByLabel("Code", { exact: true })).toHaveValue(/^[A-Z2-9]{8}$/);
  await page.getByLabel("Code", { exact: true }).fill("SPRING20");
  await expect(preview.getByText("15% off on Frontals with code SPRING20")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Minimum spend (₦)").fill("50,000");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("button", { name: "Start now" })).toBeVisible();
  await page.getByLabel(/^Starts/).fill("2099-01-05T00:00");
  await page.getByLabel(/^Ends/).fill("2099-01-04T00:00");
  await page.getByRole("button", { name: "Schedule promotion" }).click();
  await expect(page.getByText("The end has to be after the start")).toBeVisible();
  await page.getByLabel(/^Ends/).fill("2099-01-09T00:00");
  await page.getByRole("button", { name: "Schedule promotion" }).click();

  await expect(page).toHaveURL(/\/admin\/promotions$/);
  await expect(page.getByRole("status").filter({ hasText: "Flash sale: frontals scheduled for Jan 5, 00:00" })).toBeVisible();
  await expect(page.getByRole("region", { name: "All promotions" }).getByText("Flash sale: frontals")).toBeVisible();
});

test("a discount can be for chosen products and a free delivery for chosen zones, read back in words", async ({ page }) => {
  await signIn(page, "/admin/promotions/new");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Frontal week");
  await choose(page.getByLabel("Which products"), "chosen products");
  await page.getByRole("button", { name: "Add Bone Straight HD Frontal" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Take 10% off Bone Straight HD Frontal." })).toBeVisible();
  const except = page.getByText("Except some products");
  await except.click();
  await expect(page.getByRole("group", { name: "Products it never applies to" })).toBeVisible();
  await page.getByRole("complementary", { name: "Preview" }).getByText("10% off on Bone Straight HD Frontal").waitFor();

  // Free delivery has zones instead of products.
  await page.getByRole("button", { name: /1 Type/ }).click();
  await page.getByRole("radio", { name: /Free delivery/ }).click();
  await page.getByRole("button", { name: /2 Rule/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Delivery is free on the order." })).toBeVisible();
  await page.getByRole("button", { name: "Only some zones" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: /2 Rule/ }).click();
  await page.getByRole("button", { name: "Abuja" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Delivery is free to Abuja." })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Preview" }).getByText("Free delivery to Abuja")).toBeVisible();
});

test("a free gift is chosen product then variant, read back in words, and previewed as free", async ({ page }) => {
  await signIn(page, "/admin/promotions/new");
  await page.getByRole("radio", { name: /Free gift/ }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Free bonnet");
  await page.getByRole("button", { name: "Choose Bone Straight HD Frontal" }).click();
  await page.getByRole("button", { name: /^Give this/ }).first().click();
  await expect(page.getByText("The gift")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Give 1 free Bone Straight HD Frontal/ })).toBeVisible();
  await page.getByLabel("How many are given").fill("2");
  await expect(page.getByRole("status").filter({ hasText: /^Give 2 free Bone Straight/ })).toBeVisible();
  const preview = page.getByRole("complementary", { name: "Preview" });
  await expect(preview.getByText(/Free gift: Bone Straight HD Frontal/)).toBeVisible();
  await expect(preview.getByText("Free", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page).toHaveURL(/\/admin\/promotions$/);
  await expect(page.getByRole("region", { name: "All promotions" }).getByText("Free bonnet")).toBeVisible();
});

test("a live, redeemed promotion warns that edits apply at once, keeps its type, and saves changes", async ({ page }) => {
  await signIn(page, `/admin/promotions/${BOGO}`);
  await expect(page.getByRole("heading", { level: 1, name: "BOGO · Bob wigs" })).toBeVisible();
  await expect(page.getByText("Changes apply to new baskets immediately.")).toBeVisible();
  await page.getByRole("button", { name: /1 Type/ }).click();
  await expect(page.getByRole("radio", { name: /Percentage off/ })).toBeDisabled();
  await expect(page.getByText(/has been used, so its type can't change/)).toBeVisible();

  await page.getByRole("button", { name: /2 Rule/ }).click();
  await page.getByLabel("How many free").fill("2");
  await expect(page.getByRole("status").filter({ hasText: "Buy 1 from all products, get 2 free" })).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/admin\/promotions$/);
  await expect(page.getByRole("status").filter({ hasText: "Promotion saved" })).toBeVisible();
});
