import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, who = "owner") {
  await page.goto("/admin/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(`${who}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("the dashboard answers how the shop is doing and what needs doing, and is accessible", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { level: 1, name: "Hey owner, sales are up 18.4%" })).toBeVisible();

  const revenue = page.getByRole("region", { name: "Revenue" });
  await expect(revenue.getByText("₦48.6M")).toBeVisible();
  await expect(revenue.getByText("Revenue up 18.4% on the previous 30 days")).toBeAttached();
  await expect(revenue.getByRole("img")).toHaveAttribute("aria-label", /^Revenue ₦48\.6M, up 18\.4% on the previous 30 days; peak /);

  await expect(page.getByText("Avg. order value", { exact: true })).toBeVisible();
  await expect(page.getByText("₦210,400")).toBeVisible();
  await expect(page.getByText("2.4%", { exact: true })).toBeVisible();
  await expect(page.getByText("Orders up 12.1%")).toBeAttached();

  const actions = page.getByRole("region", { name: "Orders to action" });
  await expect(actions.getByRole("link", { name: /3\s*To pack/ })).toHaveAttribute("href", "/admin/orders?status=pack");
  await expect(page.getByRole("region", { name: "Live campaigns" }).getByText("BOGO · Bob wigs")).toBeVisible();
  const funnel = page.getByRole("region", { name: "Where shoppers drop off" });
  await expect(funnel.getByText("9,640")).toBeVisible();
  await expect(funnel.getByText(/Biggest drop is/)).toContainText("viewed product → added to bag");
  const best = page.getByRole("region", { name: "Best sellers" });
  await expect(best.getByText("Low · 6 left")).toBeVisible();
  const customers = page.getByRole("region", { name: "Customers" });
  await expect(customers.getByText("142")).toBeVisible();
  await expect(customers.getByText("Lagos")).toBeVisible();
  await expect(customers.getByText(/4 reviews are waiting/)).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("the range lives in the address, and the chart can be read as a table", async ({ page, isMobile }) => {
  await signIn(page);
  await page.getByRole("button", { name: "7d", exact: true }).click();
  await expect(page).toHaveURL(/range=7d/);
  await expect(page.getByRole("button", { name: "7d", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByRole("button", { name: "7d", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Revenue" }).getByRole("img")).toHaveAttribute("aria-label", /previous 7 days/);

  await page.getByRole("button", { name: "View as table" }).click();
  const table = page.getByRole("table", { name: /Revenue by day/ });
  await expect(table).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(8); // header + 7 days
  await page.getByRole("button", { name: "View as chart" }).click();
  await expect(page.getByRole("table")).toHaveCount(0);

  if (!isMobile) {
    const box = (await page.getByRole("region", { name: "Revenue" }).locator("svg").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByText(/Before: ₦/)).toBeVisible();
  }
});

test("a custom range that had no sales shows the empty states instead of blanks", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Custom" }).click();
  await page.getByLabel("From", { exact: true }).fill("2026-01-05");
  await page.getByLabel("To", { exact: true }).fill("2026-01-04");
  await page.getByRole("button", { name: "Show these days" }).click();
  await expect(page.getByText(/the start first/)).toBeVisible();
  await page.getByLabel("To", { exact: true }).fill("2026-01-20");
  await page.getByRole("button", { name: "Show these days" }).click();
  await expect(page).toHaveURL(/range=custom&from=2026-01-05&to=2026-01-20/);
  await expect(page.getByText("No sales yet in this period.")).toBeVisible();
  await expect(page.getByText("Your best sellers will show here.")).toBeVisible();
  await expect(page.getByText("No visits recorded in this period yet.")).toBeVisible();
  await expect(page.getByText("Nothing is running right now.")).toBeVisible();
  await expect(page.getByText("No buyers in this period yet.")).toBeVisible();
  await expect(page.getByText("No data yet")).toBeVisible();
});

test("a role without analytics sees only what is waiting on it", async ({ page }) => {
  await page.goto("/admin/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill("support@example.com");
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hello, support" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Revenue" })).toHaveCount(0);
});
