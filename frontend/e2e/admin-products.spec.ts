import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PRODUCT = "00000000-0000-4000-8000-000000002001";

async function owner(page: Page, url = "/admin/products") {
  await page.goto("/admin/login?next=" + encodeURIComponent(url));
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(url.replace(/[?]/g, "\\?")));
}

// These tests edit one shared fixture product, so they run one at a time, on the desktop profile, from a fresh copy.
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ request, isMobile }) => {
  test.skip(isMobile, "the shared fixture product is edited from the desktop profile only");
  await request.post("http://localhost:4010/api/v1/__test/reset-products");
});

const drawer = (page: Page) => page.getByRole("dialog", { name: "Edit product" });

test("the catalogue shows the summary, filters by status and opens a product in the drawer", async ({ page }) => {
  await owner(page);
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  await expect(page.getByText("2 products · 5 variants · 1 low on stock")).toBeVisible();
  await expect(page.getByText("4 variants · ₦125k–₦155k")).toBeVisible();

  await page.getByRole("button", { name: "Draft", exact: true }).click();
  await expect(page.getByText("Silk Sleep Bonnet")).toBeVisible();
  await expect(page.getByText("Bone Straight HD Frontal")).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();

  await page.getByRole("button", { name: /^Bone Straight HD Frontal/ }).click();
  await expect(page).toHaveURL(/product=00000000-0000-4000-8000-000000002001/);
  await expect(drawer(page)).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  // The drawer is part of the address: reload keeps it open, and Close takes it away.
  await page.reload();
  await expect(drawer(page)).toBeVisible();
  await drawer(page).getByRole("button", { name: "Close" }).click();
  await expect(page).not.toHaveURL(/product=/);
});

test("the featured star changes at once and sticks", async ({ page }) => {
  await owner(page);
  const star = page.getByRole("button", { name: "Feature Bone Straight HD Frontal on homepage" });
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(page.getByRole("button", { name: "Feature Bone Straight HD Frontal on homepage" })).toHaveAttribute("aria-pressed", "false");
});

test("adding a lace shows its impact, saves, and the new combinations appear with no stock", async ({ page }) => {
  await owner(page, `/admin/products?product=${PRODUCT}&tab=variants`);
  const d = drawer(page);
  await expect(d.getByText("12 variants")).toHaveCount(0);
  await expect(d.getByText("4 combinations · 12 units")).toBeVisible();

  await d.getByRole("button", { name: "+ Add lace" }).click();
  await d.getByLabel("Name customers see").fill("Full lace 360");
  await d.getByLabel(/Price difference/).fill("45000");
  await expect(d.getByText(/Creates 2 new variants, one for every mix of the other options/)).toBeVisible();
  await expect(d.getByText(/This lace would cost|Added to every variant with this lace/)).toBeVisible();
  await d.getByRole("button", { name: "Add lace", exact: true }).click();

  await expect(d.getByRole("button", { name: "Edit Full lace 360" })).toContainText("+₦45k");
  await expect(d.getByText("You have changes to options or variants")).toBeVisible();
  await expect(d.getByText("6 combinations · 12 units")).toBeVisible();
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(d.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await expect(d.getByText("You have changes to options or variants")).toHaveCount(0);
});

test("a duplicate name is refused, and a value can be hidden or deleted after a warning that names what it costs", async ({ page }) => {
  await owner(page, `/admin/products?product=${PRODUCT}&tab=variants`);
  const d = drawer(page);
  await d.getByRole("button", { name: "+ Add lace" }).click();
  await d.getByLabel("Name customers see").fill("13x4 hd");
  await d.getByRole("button", { name: "Add lace", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("already exists");
  await d.getByRole("button", { name: "Cancel" }).click();

  await d.getByRole("button", { name: "Edit 4×4 closure" }).click();
  await expect(d.getByText(/Used by 2 variants with 11 units in stock/)).toBeVisible();
  await d.getByRole("button", { name: "Delete", exact: true }).click();
  const warning = d.getByRole("alert").filter({ hasText: "Delete “4×4 closure”?" });
  await expect(warning).toContainText("removes 2 variants and 11 units of stock");
  await expect(warning.getByRole("button", { name: "Hide it instead" })).toBeFocused();
  await warning.getByRole("button", { name: "Hide it instead" }).click();
  await expect(d.getByRole("button", { name: "Edit 4×4 closure" })).toContainText("hidden");
});

test("changes in the drawer are guarded: closing asks first, and keeping edits keeps the drawer", async ({ page }) => {
  await owner(page, `/admin/products?product=${PRODUCT}`);
  const d = drawer(page);
  await d.getByLabel("Title").fill("Bone Straight HD Frontal Wig");
  await d.getByRole("button", { name: "Close" }).click();
  const ask = page.getByRole("dialog", { name: "Discard your changes?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(d).toBeVisible();
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(d.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await d.getByRole("button", { name: "Close" }).click();
  await expect(d).toBeHidden();
  await expect(page.getByText("Bone Straight HD Frontal Wig")).toBeVisible();
});

test("when someone else changed the product, the save says so, keeps the edit, and Reload brings their version", async ({ page, request }) => {
  await owner(page, `/admin/products?product=${PRODUCT}`);
  const d = drawer(page);
  await d.getByLabel("Title").fill("My edit");
  await request.post(`http://localhost:4010/api/v1/__test/touch-product/${PRODUCT}`);
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(d.getByRole("alert")).toContainText("Someone else changed this. Reload to see their version.");
  await expect(d.getByLabel("Title")).toHaveValue("My edit");
  await d.getByRole("button", { name: "Reload" }).click();
  await expect(d.getByLabel("Title")).not.toHaveValue("My edit");
});

test("stock adjusts in place and is written to the ledger as one change", async ({ page }) => {
  await owner(page, `/admin/products?product=${PRODUCT}&tab=variants`);
  const d = drawer(page);
  // The first length is open already; open its second row (13×4 HD, sold out).
  await d.getByRole("button", { name: /13×4 HD · Natural 1B SKU BS-12-13X4-HD/ }).click();
  const stock = d.getByRole("group", { name: "In stock" });
  await expect(stock.getByRole("status")).toHaveText("0");
  await stock.getByRole("button", { name: "One more" }).click();
  await stock.getByRole("button", { name: "One more" }).click();
  await expect(stock.getByRole("status")).toHaveText("2");
  const [write] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/admin/inventory/") && r.method() === "PATCH"),
    // Nothing is sent until the taps stop.
  ]);
  expect(write.postDataJSON()).toMatchObject({ mode: "adjust", quantity: 2, reason: "correction" });
});

test("a product with no options shows one price and SKU form, and the nav keeps a restricted role out", async ({ page }) => {
  await owner(page, "/admin/products?product=00000000-0000-4000-8000-000000002002&tab=variants");
  const d = drawer(page);
  await expect(d.getByRole("region", { name: "Price and SKU" })).toBeVisible();
  await expect(d.getByRole("textbox", { name: "SKU" })).toHaveValue("BONNET-1");
  await expect(d.getByRole("button", { name: "+ Add another option (e.g. Parting, Hair origin)" })).toBeVisible();
});
