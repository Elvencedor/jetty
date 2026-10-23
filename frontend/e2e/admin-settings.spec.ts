import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, who: string, next: string) {
  await page.goto("/admin/login?next=" + encodeURIComponent(next));
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(`${who}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(next));
}

// The settings are one shared fixture, so these run one at a time, on desktop, from a fresh copy.
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ request, isMobile }) => {
  test.skip(isMobile, "the shared fixture settings are edited from the desktop profile only");
  await request.post("http://localhost:4010/api/v1/__test/reset-settings");
});

test("the index goes to Store details, the menu marks where you are, and the page is accessible", async ({ page }) => {
  await signIn(page, "owner", "/admin/settings/store");
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/admin\/settings\/store$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Store details/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("Store name")).toHaveValue("Jetty's Hair");
  await expect(page.getByLabel("Support phone")).toHaveValue("0803 123 4567");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("store details save only when changed, validate in place, and can be discarded", async ({ page }) => {
  await signIn(page, "owner", "/admin/settings/store");
  const save = page.getByRole("button", { name: "Save changes" });
  await expect(save).toBeDisabled();

  await page.getByLabel("Store name").fill("Jetty's Hair Studio");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByLabel("Store name")).toHaveValue("Jetty's Hair");

  await page.getByLabel("Support email").fill("nope");
  await save.click();
  await expect(page.getByText("Enter an email like hello@yourshop.com")).toBeVisible();
  await page.getByLabel("Support email").fill("support@jettys.com");
  await page.getByLabel("WhatsApp business number").fill("0803 999 0000");
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Store details saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Support email")).toHaveValue("support@jettys.com");
  await expect(page.getByLabel("WhatsApp business number")).toHaveValue("0803 999 0000");
});

test("the landing page nudges until the contact details are filled in, then goes quiet", async ({ page }) => {
  await signIn(page, "owner", "/admin/settings/store");
  await page.getByLabel("WhatsApp business number").fill("");
  await page.getByLabel("Showroom / pickup address").fill("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Store details saved" }).first()).toBeAttached();

  await page.goto("/admin");
  const nudge = page.getByRole("region", { name: "Finish setting up" });
  await expect(nudge).toContainText("Customers can't see your WhatsApp number or showroom address.");
  await nudge.getByRole("link", { name: "Add them" }).click();
  await expect(page).toHaveURL(/\/admin\/settings\/store$/);
  await page.getByLabel("WhatsApp business number").fill("0803 999 0000");
  await page.getByLabel("Showroom / pickup address").fill("Lekki Phase 1, Lagos");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Store details saved" }).first()).toBeAttached();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Finish setting up" })).toHaveCount(0);
});

test("delivery zones show what checkout charges, can be switched off with a warning, and edited in a drawer", async ({ page }) => {
  await signIn(page, "owner", "/admin/settings/delivery");
  const mainland = page.getByRole("listitem").filter({ hasText: "Lagos Mainland" }).first();
  await expect(mainland.getByText("Order before 2:00 pm")).toBeVisible();
  await expect(mainland.getByText("₦3,500")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Abuja" }).first().getByText("₦8,000")).toBeVisible();

  await page.getByRole("switch", { name: "Deliver to Abuja" }).click();
  const confirm = page.getByRole("dialog", { name: "Switch off Abuja?" });
  await expect(confirm).toContainText("Orders already placed are still delivered");
  await confirm.getByRole("button", { name: "Switch off" }).click();
  await expect(page.getByRole("switch", { name: "Deliver to Abuja" })).toHaveAttribute("aria-checked", "false");

  await mainland.getByRole("button", { name: "Edit Lagos Mainland" }).click();
  const drawer = page.getByRole("dialog", { name: "Edit Lagos Mainland" });
  await drawer.getByLabel("Same-day", { exact: true }).fill("4,000");
  await drawer.getByLabel("Areas").fill("Yaba\nIkeja\nMaryland");
  await drawer.getByRole("button", { name: "Save zone" }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByText("₦4,000")).toBeVisible();
  await expect(page.getByText(/Maryland/)).toBeVisible();

  await page.getByRole("button", { name: "Add zone" }).click();
  const add = page.getByRole("dialog", { name: "Add delivery zone" });
  await add.getByLabel("Next day", { exact: true }).fill("1,500");
  await add.getByRole("button", { name: "Save zone" }).click();
  await expect(add.getByText("Name the zone, like Lagos Mainland")).toBeVisible();
  await add.getByLabel("Zone name").fill("Port Harcourt");
  await add.getByLabel("State").fill("Rivers");
  await add.getByRole("button", { name: "Save zone" }).click();
  await expect(page.getByRole("heading", { name: "Port Harcourt" })).toBeVisible();
});

test("payments keep one method on, and policies change the return window", async ({ page }) => {
  await signIn(page, "owner", "/admin/settings/payments");
  await page.getByRole("switch", { name: "Accept card payments" }).click();
  const transfer = page.getByRole("switch", { name: "Accept bank transfer payments" });
  await expect(transfer).toBeDisabled();
  await page.getByLabel("Cancel unpaid transfer orders after").selectOption("240");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Payment settings saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Accept card payments" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByLabel("Cancel unpaid transfer orders after")).toHaveValue("240");

  await page.getByRole("link", { name: /^Returns & policies/ }).click();
  await page.getByLabel("Return window").selectOption("14");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Policies saved" })).toBeVisible();
});

test("a payout account is connected by checking the account name first, and shown with only its last four digits", async ({ page }) => {
  await signIn(page, "owner", "/admin/settings/payments");
  await expect(page.getByText(/No payout account yet/)).toBeVisible();
  await page.getByRole("button", { name: "Connect payout account" }).click();
  const drawer = page.getByRole("dialog", { name: "Connect payout account" });
  await expect(drawer.getByLabel("Business name")).toHaveValue("Jetty's Hair");
  const connect = drawer.getByRole("button", { name: "Connect account" });
  await expect(connect).toBeDisabled();

  await drawer.getByLabel("Bank").selectOption("058");
  await drawer.getByLabel("Account number").fill("0999999999");
  await expect(drawer.getByText(/could not find that account/)).toBeVisible();
  await expect(connect).toBeDisabled();

  await drawer.getByLabel("Account number").fill("0123456789");
  await expect(drawer.getByText("✓ JETTY HAIR LTD")).toBeVisible();
  await connect.click();
  await expect(drawer).toBeHidden();
  await expect(page.getByText("Connected · test mode")).toBeVisible();
  await expect(page.getByText(/GTBank ••••6789 · JETTY HAIR LTD/)).toBeVisible();
  await expect(page.getByText("0123456789")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: "Change account" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("a role that can only read sees the settings without the means to change them", async ({ page }) => {
  await signIn(page, "manager", "/admin/settings/store");
  await expect(page.getByText("only an owner can change them")).toBeVisible();
  await expect(page.getByLabel("Store name")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await page.getByRole("link", { name: /^Payments/ }).click();
  await expect(page.getByText(/No payout account yet/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect payout account" })).toHaveCount(0);
  await page.getByRole("link", { name: /^Delivery & pickup/ }).click();
  await expect(page.getByRole("button", { name: "Add zone" })).toHaveCount(0);
  await expect(page.getByRole("switch", { name: "Deliver to Abuja" })).toBeDisabled();
});
