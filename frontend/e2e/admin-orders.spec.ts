import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const O = (n: number) => `00000000-0000-4000-8000-${String(3000 + n).padStart(12, "0")}`;

async function signIn(page: Page, url: string, who = "owner") {
  await page.goto("/admin/login?next=" + encodeURIComponent(url));
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(`${who}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(url.replace(/[?]/g, "\\?")));
}

// The orders are one shared fixture, so these run one at a time, on desktop, from a fresh copy.
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ request, isMobile }) => {
  test.skip(isMobile, "the shared fixture orders are edited from the desktop profile only");
  await request.post("http://localhost:4010/api/v1/__test/reset-orders");
});

const drawer = (page: Page) => page.getByRole("dialog", { name: "Order details" });

test("the list shows counts per status, filters by pill and search, and opens an order in the drawer", async ({ page }) => {
  await signIn(page, "/admin/orders");
  await expect(page.getByRole("heading", { level: 1, name: "Orders" })).toBeVisible();
  await expect(page.getByText("6 need action today")).toBeVisible();
  await expect(page.getByRole("button", { name: "All 5" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "To pack 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Awaiting payment 1" })).toBeVisible();

  await page.getByRole("button", { name: "To pack 2" }).click();
  await expect(page).toHaveURL(/status=pack/);
  await expect(page.getByRole("button", { name: "Open order JH-10481" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open order JH-10482" })).toHaveCount(0);
  await page.getByRole("button", { name: "All 5" }).click();

  await page.getByRole("searchbox", { name: "Search orders" }).fill("tolu");
  await expect(page.getByRole("button", { name: /^Open order/ })).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search orders" }).fill("");
  await page.getByLabel("Payment").selectOption("bank_transfer");
  await expect(page.getByRole("button", { name: /^Open order/ })).toHaveCount(1);
  await page.getByLabel("Payment").selectOption("");

  await page.getByRole("button", { name: "Open order JH-10481" }).click();
  await expect(page).toHaveURL(new RegExp(`order=${O(1)}`));
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByText("#JH-10481")).toBeVisible();
  await expect(drawer(page).getByText("3rd order · ₦612k lifetime")).toBeVisible();
  await expect(drawer(page).getByText("−₦10,000")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.reload();
  await expect(drawer(page)).toBeVisible();
  await drawer(page).getByRole("button", { name: "Close" }).click();
  await expect(page).not.toHaveURL(/order=/);
});

test("the next step moves an order along, and handing to a rider needs a rider first", async ({ page }) => {
  await signIn(page, `/admin/orders?order=${O(1)}`);
  const d = drawer(page);
  await d.getByRole("button", { name: "Mark as packed" }).click();
  await expect(d.getByText("Packed", { exact: true }).first()).toBeVisible();
  await expect(d.getByRole("status").filter({ hasText: "Packed. The customer has been told." })).toBeVisible();

  const hand = d.getByRole("button", { name: "Hand to rider" });
  await expect(hand).toBeDisabled();
  await expect(d.getByText("Choose a rider first")).toBeVisible();
  await d.getByLabel("Rider", { exact: true }).fill("Musa");
  await d.getByLabel("Rider phone").fill("0803 123 4567");
  await d.getByRole("button", { name: "Save rider" }).click();
  await expect(hand).toBeEnabled();
  await hand.click();
  await expect(d.getByText("Out for delivery").first()).toBeVisible();
  await d.getByRole("button", { name: "Mark as delivered" }).click();
  await expect(d.getByRole("button", { name: /Mark as|Hand to/ })).toHaveCount(0);
  await expect(d.getByText("Delivered").first()).toBeVisible();
});

test("a stale step is explained inline and the order is refreshed", async ({ page, request }) => {
  const login = await request.post("http://localhost:4010/api/v1/admin/auth/login", { data: { email: "owner@example.com", password: "correct-horse-1" } });
  const headers = { authorization: `Bearer ${(await login.json()).accessToken}` };
  await request.patch(`http://localhost:4010/api/v1/admin/orders/${O(5)}/delivery`, { data: { riderName: "Musa" }, headers });

  await signIn(page, `/admin/orders?order=${O(5)}`);
  const d = drawer(page);
  await expect(d.getByRole("button", { name: "Hand to rider" })).toBeEnabled();
  // Someone else hands it over while this drawer is open.
  await request.patch(`http://localhost:4010/api/v1/admin/orders/${O(5)}/status`, { data: { status: "out_for_delivery" }, headers });
  await d.getByRole("button", { name: "Hand to rider" }).click();
  await expect(d.getByRole("alert")).toContainText("cannot move to out for delivery");
  await expect(d.getByRole("button", { name: "Mark as delivered" })).toBeVisible();
});

test("a bank transfer is confirmed with evidence when the bank has nothing", async ({ page }) => {
  await signIn(page, `/admin/orders?order=${O(2)}`);
  await drawer(page).getByRole("button", { name: "Confirm transfer received" }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm transfer received" });
  await confirm.getByRole("button", { name: "Confirm transfer" }).click();
  await expect(confirm.getByRole("alert")).toContainText("hasn't reported this transfer");
  await confirm.getByLabel(/Evidence/).fill("GTBank statement shows 2,000 credit ref 4471");
  await confirm.getByRole("button", { name: "Confirm transfer" }).click();
  await expect(confirm).toBeHidden();
  await expect(drawer(page).getByRole("button", { name: "Mark as packed" })).toBeVisible();
  await expect(drawer(page).getByText("Payment received")).toBeVisible();
});

test("notes, partial refunds and cancelling work from the drawer", async ({ page }) => {
  await signIn(page, `/admin/orders?order=${O(1)}`);
  const d = drawer(page);
  await d.getByLabel("Internal note").fill("Customer asked to call first");
  await d.getByRole("button", { name: "Add", exact: true }).click();
  await expect(d.getByText("Customer asked to call first")).toBeVisible();

  await d.getByRole("button", { name: "Refund" }).click();
  const refund = page.getByRole("dialog", { name: "Refund order" });
  await refund.getByLabel("Part of it").check();
  await refund.getByLabel("Amount to refund").fill("999999999");
  await refund.getByLabel("Reason").fill("Damaged bonnet");
  await refund.getByRole("button", { name: "Refund", exact: true }).click();
  await expect(refund.getByText(/more than the/)).toBeVisible();
  await refund.getByLabel("Amount to refund").fill("5,000");
  await refund.getByRole("button", { name: "Refund", exact: true }).click();
  await expect(refund).toBeHidden();
  await expect(d.getByText("Partly refunded")).toBeVisible();

  await d.getByRole("button", { name: "Cancel order" }).click();
  const cancel = page.getByRole("dialog", { name: "Cancel this order?" });
  await cancel.getByRole("button", { name: "Cancel order" }).click();
  await expect(cancel.getByText("Give a reason")).toBeVisible();
  await cancel.getByLabel("Reason").fill("Customer changed their mind");
  await cancel.getByRole("button", { name: "Cancel order" }).click();
  await expect(cancel).toBeHidden();
  await expect(d.getByText("Order cancelled").first()).toBeVisible();
  await expect(d.getByRole("button", { name: "Cancel order" })).toHaveCount(0);
});

test("support staff can read orders and add notes, but see no actions", async ({ page }) => {
  await signIn(page, `/admin/orders?order=${O(1)}`, "support");
  const d = drawer(page);
  await expect(d.getByText("#JH-10481")).toBeVisible();
  await expect(d.getByRole("button", { name: "Mark as packed" })).toHaveCount(0);
  await expect(d.getByRole("button", { name: "Refund" })).toHaveCount(0);
  await expect(d.getByRole("button", { name: "Cancel order" })).toHaveCount(0);
  await expect(d.getByRole("button", { name: "Save rider" })).toHaveCount(0);
  await expect(d.getByLabel("Internal note")).toBeVisible();
});
