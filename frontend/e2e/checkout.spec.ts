import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function addWigAndOpenCheckout(page: Page) {
  await page.goto("/p/bone-straight-frontal");
  const add = page.getByRole("button", { name: /Add to bag/ });
  await expect(async () => {
    await add.click();
    await expect(page.getByRole("status").filter({ hasText: "Added to bag" })).toBeVisible({ timeout: 500 });
  }).toPass();
  await page.goto("/checkout");
  // Typing or submitting before the page is interactive would be lost, so wait for it.
  await page.waitForLoadState("networkidle");
}

async function fillDelivery(page: Page, name = "Ada Obi") {
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel(/^Phone/).fill("0803 123 4567");
  await page.getByLabel("Address", { exact: true }).fill("12 Admiralty Way");
  await page.getByLabel("City or town").fill("Lekki");
  await page.getByLabel("State").selectOption("Lagos");
}

test("checking out with a bag walks the three steps and reaches payment", async ({ page }) => {
  await addWigAndOpenCheckout(page);
  await expect(page.getByRole("heading", { name: "Where should we deliver?" })).toBeVisible();

  // Nothing is sent until the form is valid, and the first problem gets the focus.
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByText("Enter your full name")).toBeVisible();
  await expect(page.getByLabel("Full name")).toBeFocused();

  await fillDelivery(page);
  await page.getByRole("radio", { name: /Same-day delivery/ }).check({ force: true });
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole("button", { name: "Continue to payment" }).click();

  await expect(page.getByRole("heading", { name: "How would you like to pay?" })).toBeVisible();
  await page.getByRole("radio", { name: /Card/ }).check({ force: true });
  await page.getByRole("button", { name: "Review order" }).click();

  await expect(page.getByRole("heading", { name: "Quick check" })).toBeVisible();
  await expect(page.getByText("Ada Obi, 12 Admiralty Way, Lekki, Lagos")).toBeVisible();
  await page.getByRole("button", { name: /^Pay ₦/ }).click();

  await expect(page).toHaveURL(/\/checkout\/pay\?order=/);
  await expect(page.getByRole("heading", { level: 1, name: /Order JH-/ })).toBeVisible();
});

test("details survive a reload and a step can't be reached early", async ({ page }) => {
  await addWigAndOpenCheckout(page);
  await fillDelivery(page);
  await page.getByRole("radio", { name: /Same-day delivery/ }).check({ force: true });
  await page.reload();
  await expect(page.getByLabel("Full name")).toHaveValue("Ada Obi");
  await page.goto("/checkout?step=review");
  await expect(page.getByRole("heading", { name: "How would you like to pay?" })).toBeVisible();
});

test("returning from Paystack confirms with the server and lands on the confirmation", async ({ page }) => {
  await addWigAndOpenCheckout(page);
  await fillDelivery(page);
  await page.getByRole("radio", { name: /Same-day delivery/ }).check({ force: true });
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("radio", { name: /Card/ }).check({ force: true });
  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("button", { name: /^Pay ₦/ }).click();
  await expect(page).toHaveURL(/order=([0-9a-f-]{36})/);
  const orderId = new URL(page.url()).searchParams.get("order")!;

  // Paystack redirects back with the reference; the server verifies it, the page never decides.
  await page.goto(`/checkout/return?reference=ref-${orderId}-1`);
  await expect(page).toHaveURL(new RegExp(`/order/${orderId}/confirmed`));
  await expect(page.getByRole("heading", { level: 1, name: /Yay, it's yours, Ada!/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Order progress" })).toBeVisible();

  // Paid: the bag is empty now.
  await page.goto("/bag");
  await expect(page.getByRole("heading", { name: "Your bag is empty" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("a failed payment says no money was taken and can be retried", async ({ page }) => {
  await addWigAndOpenCheckout(page);
  await fillDelivery(page, "Fail Test");
  await page.getByRole("radio", { name: /Same-day delivery/ }).check({ force: true });
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("radio", { name: /Card/ }).check({ force: true });
  await page.getByRole("button", { name: "Review order" }).click();
  await page.getByRole("button", { name: /^Pay ₦/ }).click();
  await expect(page.getByText("Your payment didn't go through. No money was taken.")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Your payment didn't go through.")).toHaveCount(0);
});

test("tracking an order needs its number and phone", async ({ page }) => {
  await page.goto("/track");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Track order" }).click();
  await expect(page.getByText("Enter your order number", { exact: true })).toBeVisible();
  await page.getByLabel("Order number").fill("JH-99999");
  await page.getByLabel("Phone number").fill("0803 123 4567");
  await page.getByRole("button", { name: "Track order" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "couldn't find an order" })).toBeVisible();
});
