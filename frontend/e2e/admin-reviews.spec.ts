import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, who = "owner", next = "/admin/reviews") {
  await page.goto("/admin/login?next=" + encodeURIComponent(next));
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(`${who}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(next.replace("?", "\\?")));
}

// The reviews are one shared fixture, so these run one at a time, on desktop, from a fresh copy.
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ request, isMobile }) => {
  test.skip(isMobile, "the shared fixture reviews are moderated from the desktop profile only");
  await request.post("http://localhost:4010/api/v1/__test/reset-reviews");
});

const cards = (page: Page) => page.getByRole("article");

test("the queue shows what is waiting, with flags in words, the store rating, and is accessible", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Reviews & questions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Waiting 4" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Published 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hidden 1" })).toBeVisible();
  await expect(cards(page)).toHaveCount(4);

  const pixie = cards(page).filter({ hasText: "Pixie Curl Bob" });
  await expect(pixie.getByText("Check: contains a phone number")).toBeVisible();
  await expect(pixie.getByRole("img", { name: "4 out of 5 stars" })).toBeVisible();
  await expect(pixie.getByText("Bought 1B · order #JH-1022")).toBeVisible();
  await expect(cards(page).filter({ hasText: "Kinky Curly" }).getByText("Check: low rating about delivery, consider replying")).toBeVisible();

  const rating = page.getByRole("complementary", { name: "Store rating" });
  await expect(rating.getByText("4.8")).toBeVisible();
  await expect(rating.getByText("from 2,140 reviews")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("approving moves the card out for five seconds of Undo, then the review goes live", async ({ page }) => {
  await signIn(page);
  const first = cards(page).first();
  await first.getByRole("button", { name: /^Approve/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Approved" })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(cards(page)).toHaveCount(4);

  await cards(page).first().getByRole("button", { name: /^Approve/ }).click();
  await expect(page.getByRole("button", { name: "Waiting 3" })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByRole("button", { name: "Published 2" })).toBeVisible();
  await expect(cards(page)).toHaveCount(3);
});

test("hiding, the Published and Hidden tabs, and the keyboard shortcuts", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Shortcuts" }).click();
  await expect(page.getByText(/J next/)).toBeVisible();
  await page.keyboard.press("j");
  await page.keyboard.press("h");
  await expect(page.getByRole("status").filter({ hasText: "Hidden." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hidden 2" })).toBeVisible({ timeout: 12_000 });

  await page.getByRole("button", { name: /^Published/ }).click();
  await expect(page).toHaveURL(/status=published/);
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first().getByRole("button", { name: /^Approve/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Hidden/ }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).first().getByRole("button", { name: /^Hide/ })).toHaveCount(0);
});

test("an empty queue says everything is done", async ({ page }) => {
  await signIn(page);
  for (let i = 0; i < 4; i++) await cards(page).first().getByRole("button", { name: /^Hide/ }).click();
  await expect(page.getByText("All caught up")).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText("New reviews will show up here for approval.")).toBeVisible();
});
