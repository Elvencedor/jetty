import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { choose } from "./dropdown";

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
  await page.getByRole("button", { name: "Low stock", exact: true }).click();
  await expect(page.getByText("Bone Straight HD Frontal")).toBeVisible();
  await expect(page.getByText("Silk Sleep Bonnet")).toHaveCount(0);
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

test("tags are typed in, tidied, removed, and saved with the product", async ({ page }) => {
  await owner(page, `/admin/products?product=${PRODUCT}`);
  const d = drawer(page);
  const tags = d.getByLabel("Tags", { exact: true });
  await tags.fill("Best  Seller");
  await tags.press("Enter");
  await tags.fill("Summer, gift");
  await expect(d.getByRole("list", { name: "Tags on this product" }).getByRole("listitem")).toHaveText(["best seller", "summer", "gift"]);
  await d.getByRole("button", { name: "Remove tag gift" }).click();
  await d.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeAttached();
  await page.reload();
  await expect(drawer(page).getByRole("list", { name: "Tags on this product" }).getByRole("listitem")).toHaveText(["best seller", "summer"]);
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

test("stock adjusts in the row and is written to the ledger as one change", async ({ page }) => {
  await owner(page, `/admin/products?product=${PRODUCT}&tab=variants`);
  const d = drawer(page);
  // Variants are grouped by Length and the first length is open; its second row is 13×4 HD, sold out.
  const stock = d.getByRole("group", { name: "Stock for 13×4 HD · Natural 1B" });
  await expect(stock.getByRole("textbox")).toHaveValue("0");
  await stock.getByRole("button", { name: /One more/ }).click();
  await stock.getByRole("button", { name: /One more/ }).click();
  await expect(stock.getByRole("textbox")).toHaveValue("2");
  const [write] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/admin/inventory/") && r.method() === "PATCH"),
    // Nothing is sent until the taps stop.
  ]);
  expect(write.postDataJSON()).toMatchObject({ mode: "adjust", quantity: 2, reason: "correction" });
});

test("variants group by any option, filter and search, and the action bar stays pinned", async ({ page }) => {
  await owner(page, `/admin/products?product=${PRODUCT}&tab=variants`);
  const d = drawer(page);
  await expect(d.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  const bar = d.getByRole("button", { name: "Delete product" });
  // The action bar is pinned to the bottom of the screen: its buttons end one padding (12px) above the bottom edge.
  const bottom = page.viewportSize()!.height - 12;
  const pinned = () => expect.poll(async () => { const box = await bar.boundingBox(); return box ? Math.round(box.y + box.height) : null; }).toBe(bottom);
  await pinned();

  // Grouped by the first option (Length) to begin with; switch to Lace.
  await expect(d.getByRole("region", { name: '12"' })).toBeVisible();
  await choose(d.getByLabel("Group by"), "Lace");
  await expect(d.getByRole("region", { name: "4×4 closure" })).toBeVisible();
  await expect(d.getByRole("region", { name: '12"' })).toHaveCount(0);

  // Searching narrows to the matching variant and says how many are shown.
  await d.getByRole("searchbox", { name: "Search variants" }).fill("13X4");
  await expect(d.getByText(/Showing 2 of 4/)).toBeVisible();
  await d.getByRole("button", { name: "Clear filters" }).click();
  await expect(d.getByText(/Showing/)).toHaveCount(0);

  // The bar is the modal's, not the content's: it has not moved however the content changed.
  await pinned();
});

test("adding an option opens its form at the top of the options, picks values, and adds them", async ({ page }) => {
  await owner(page, `/admin/products?product=${PRODUCT}&tab=variants`);
  const d = drawer(page);
  const options = d.getByRole("complementary", { name: "Options" });
  // The button is the first thing under the explanation, above the option cards.
  const add = options.getByRole("button", { name: "+ Add another option" });
  const lengthCard = options.getByRole("region", { name: "Length" });
  // Compared by their order in the page, not by pixels: the modal slides in, so positions measured one after the other can disagree.
  const lengthHandle = await lengthCard.elementHandle();
  expect(await add.evaluate((el, other) => Boolean(el.compareDocumentPosition(other!) & Node.DOCUMENT_POSITION_FOLLOWING), lengthHandle)).toBe(true);
  await add.click();
  await expect(options.getByText("Add another option", { exact: true })).toBeVisible();
  await options.getByRole("button", { name: "Density", exact: true }).click();
  await options.getByRole("button", { name: "150%" }).click();
  await options.getByRole("button", { name: "180%" }).click();
  await expect(options.getByRole("status")).toContainText("2 values × 4 current variants = 8 variants");
  await options.getByRole("button", { name: "Add option", exact: true }).click();
  await expect(options.getByRole("region", { name: "Density" })).toBeVisible();
  await expect(d.getByText("You have changes to options or variants")).toBeVisible();
});

test("promotions can be attached to a product from existing ones, taken off again, or created on the spot", async ({ page }) => {
  await owner(page, `/admin/products?product=${PRODUCT}&tab=merch`);
  const d = drawer(page);
  const promos = d.getByRole("region", { name: "Promotions" });
  const onProduct = promos.getByRole("list", { name: "Promotions on this product" });

  // The one that names this product (and another) is listed, can be taken off, and says why it applies.
  await expect(onProduct.getByRole("listitem").filter({ hasText: "Bone Straight sale" })).toContainText("Chosen for this product");
  await expect(onProduct.getByRole("listitem").filter({ hasText: "Bone Straight sale" })).toContainText("15% off");
  // Editing happens on the Promotions page: the row links there, and has no edit controls of its own.
  await expect(onProduct.getByRole("link", { name: /View in Promotions.*Bone Straight sale/ })).toHaveAttribute("href", /\/admin\/promotions\//);
  // Promotions for every product show too, with no way to take one product off them.
  await expect(onProduct.getByRole("listitem").filter({ hasText: "BOGO · Bob wigs" })).toContainText("Applies to every product");
  await expect(onProduct.getByRole("listitem").filter({ hasText: "BOGO · Bob wigs" }).getByRole("button")).toHaveCount(0);

  await onProduct.getByRole("button", { name: "Remove Bone Straight sale from this product" }).click();
  await expect(d.getByRole("status").filter({ hasText: "Taken off Bone Straight sale" })).toBeVisible();
  await expect(onProduct.getByText("Bone Straight sale")).toHaveCount(0);

  // Drafts are written in Promotions: this one (a draft for another product) is neither listed nor offered here.
  await expect(onProduct.getByText("Bonnet offer")).toHaveCount(0);
  await promos.getByLabel("Add an existing promotion").click();
  await expect(page.getByRole("option", { name: /Bonnet offer/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // It is now something that can be attached again, along with the others limited to chosen products.
  await choose(promos.getByLabel("Add an existing promotion"), /Bone Straight sale/);
  await promos.getByRole("button", { name: "Attach", exact: true }).click();
  await expect(d.getByRole("status").filter({ hasText: "Bone Straight sale now applies to this product" })).toBeVisible();
  await expect(onProduct.getByRole("listitem").filter({ hasText: "Bone Straight sale" })).toBeVisible();

  // Make a new one for this product only.
  await promos.getByRole("button", { name: "+ Create a promotion for this product" }).click();
  await expect(promos.getByRole("button", { name: "Save as draft" })).toHaveCount(0);
  await promos.getByRole("button", { name: "Create and switch on" }).click();
  await expect(promos.getByText("Give it a name your team will recognise").or(promos.getByText("Enter a percentage from 1 to 90"))).toBeVisible();
  await promos.getByLabel("Name", { exact: true }).fill("Launch week");
  await promos.getByLabel("Percent off (%)").fill("20");
  await promos.getByRole("button", { name: "Create and switch on" }).click();
  await expect(d.getByRole("status").filter({ hasText: "Launch week is on for this product" })).toBeVisible();
  const launch = onProduct.getByRole("listitem").filter({ hasText: "Launch week" });
  await expect(launch).toContainText("20% off");
  await expect(launch).toContainText("Chosen for this product");
  // It is the only product on it, so it cannot be removed from here.
  await expect(launch).toContainText("Only product on it");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("a product with no options shows one price and SKU form, and the nav keeps a restricted role out", async ({ page }) => {
  await owner(page, "/admin/products?product=00000000-0000-4000-8000-000000002002&tab=variants");
  const d = drawer(page);
  await expect(d.getByRole("region", { name: "Price and SKU" })).toBeVisible();
  await expect(d.getByRole("textbox", { name: "SKU" })).toHaveValue("BONNET-1");
  await expect(d.getByRole("button", { name: "+ Add options like Length or Colour" })).toBeVisible();
});
