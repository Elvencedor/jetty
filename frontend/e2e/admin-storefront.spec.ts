import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, next: string) {
  await page.goto("/admin/login?next=" + encodeURIComponent(next));
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill("owner@example.com");
  await page.getByLabel("Password").fill("correct-horse-1");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(next.replace(/[?]/g, "\\?")));
}

// The content is one shared fixture, so these run one at a time, on desktop, from a fresh copy.
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ request, isMobile }) => {
  test.skip(isMobile, "the shared fixture content is edited from the desktop profile only");
  await request.post("http://localhost:4010/api/v1/__test/reset-content");
});

const sections = (page: Page) => page.getByRole("region", { name: "Homepage sections" });

test("the section list shows the order, what is hidden, and the inspector explains each block", async ({ page }) => {
  await signIn(page, "/admin/storefront");
  await expect(page.getByRole("heading", { level: 1, name: "Storefront" })).toBeVisible();
  await expect(sections(page).getByText(/7 of 10 showing/)).toBeVisible();
  await expect(sections(page).getByRole("listitem")).toHaveCount(10);
  await expect(sections(page).getByText("Hidden from customers").first()).toBeVisible();

  await sections(page).getByRole("button", { name: /^Trust badges/ }).click();
  await expect(page).toHaveURL(/section=trust/);
  await expect(page.getByRole("region", { name: "Trust badges" }).getByText(/Nothing to fill in/)).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("a block moves and hides at once, with the change announced and an Undo", async ({ page }) => {
  await signIn(page, "/admin/storefront");
  await sections(page).getByRole("button", { name: "Move Hero cards up" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Hero cards moved to position 1 of 9" }).first()).toBeAttached();
  await expect(sections(page).getByRole("listitem").nth(1)).toContainText("Hero cards");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(sections(page).getByRole("listitem").nth(1)).toContainText("Story circles");

  await sections(page).getByRole("button", { name: "Hide Category tiles" }).click();
  await expect(sections(page).getByRole("button", { name: "Show Category tiles" })).toBeVisible();
  await expect(sections(page).getByText(/6 of 10 showing/)).toBeVisible();
});

test("announcements are drafted, validated, published and removed", async ({ page }) => {
  await signIn(page, "/admin/storefront");
  const panel = page.getByRole("region", { name: "Announcement bar" });
  await expect(panel.getByText("Free delivery over ₦250,000", { exact: true }).first()).toBeVisible();
  await expect(panel.getByText("Live", { exact: true }).first()).toBeVisible();
  await expect(panel.getByText("Draft", { exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "Publish Weekend sale: 10% off frontals" }).click();
  await expect(panel.getByText("Draft", { exact: true })).toHaveCount(0);

  await panel.getByRole("button", { name: "Add message" }).click();
  await panel.getByRole("button", { name: "Save as draft" }).click();
  await expect(panel.getByText("Write the message")).toBeVisible();
  await panel.getByLabel("Message").fill("Black Friday starts Friday");
  await panel.getByLabel("Links to").fill("//evil.com");
  await panel.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(panel.getByText(/starting with https/)).toBeVisible();
  await panel.getByLabel("Links to").fill("/shop");
  await panel.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(panel.getByText("Black Friday starts Friday", { exact: true }).first()).toBeVisible();

  await panel.getByRole("button", { name: /^Remove Black Friday/ }).click();
  await page.getByRole("dialog", { name: "Remove this message?" }).getByRole("button", { name: "Remove" }).click();
  await expect(panel.getByText("Black Friday starts Friday", { exact: true })).toHaveCount(0);
});

test("hero cards can be reordered, taken down and edited", async ({ page }) => {
  await signIn(page, "/admin/storefront?section=hero");
  const panel = page.getByRole("region", { name: "Hero cards" });
  await expect(panel.getByRole("listitem")).toHaveCount(2);
  await panel.getByRole("button", { name: "Move New bobs earlier" }).click();
  await expect(panel.getByRole("listitem").first()).toContainText("New bobs");
  await panel.getByRole("button", { name: "Take down New bobs" }).click();
  await expect(panel.getByRole("listitem").first().getByText("Draft", { exact: true })).toBeVisible();

  await panel.getByRole("button", { name: /^Edit hero card: Wigs you will love/ }).click();
  await expect(panel.getByLabel("Headline", { exact: true })).toHaveValue("Wigs you will love");
  await expect(panel.getByText("18 / 160 characters")).toBeVisible();
  await panel.getByRole("button", { name: "Plum" }).click();
  await panel.getByLabel("Headline", { exact: true }).fill("Wigs you will adore");
  await panel.getByRole("button", { name: "Save changes" }).click();
  await expect(panel.getByText("Wigs you will adore", { exact: true }).first()).toBeVisible();
});

test("a hero card takes a picture, asks what it shows, and keeps it", async ({ page }) => {
  await signIn(page, "/admin/storefront?section=hero");
  const panel = page.getByRole("region", { name: "Hero cards" });
  await panel.getByRole("button", { name: /^Edit hero card: New bobs/ }).click();
  await expect(panel.getByText("Portrait 4:5, at least 1200 pixels wide.")).toBeVisible();
  // A 1x1 PNG is a real image the browser can shrink and upload.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await panel.locator('input[type="file"]').setInputFiles({ name: "hero.png", mimeType: "image/png", buffer: png });
  await expect(panel.getByRole("button", { name: "Change picture" })).toBeVisible();
  await panel.getByRole("button", { name: "Save changes" }).click();
  await expect(panel.getByText("Describe the picture for people who can't see it")).toBeVisible();
  await panel.getByLabel("What the picture shows").fill("Woman wearing a short bob wig");
  await panel.getByRole("button", { name: "Save changes" }).click();
  await expect(panel.getByRole("button", { name: /^Edit hero card: New bobs/ })).toBeVisible();

  await panel.getByRole("button", { name: /^Edit hero card: New bobs/ }).click();
  await expect(panel.getByLabel("What the picture shows")).toHaveValue("Woman wearing a short bob wig");
  await panel.getByRole("button", { name: "Remove picture" }).click();
  await expect(panel.getByRole("button", { name: "Add a picture" })).toBeVisible();
});

test("the picks row is chosen product by product, in an order, or left to the featured flag", async ({ page }) => {
  await signIn(page, "/admin/storefront?section=products");
  const panel = page.getByRole("region", { name: "Jetty's picks" });
  await expect(panel.getByRole("radio", { name: /Products marked as featured/ })).toHaveAttribute("aria-checked", "true");
  await panel.getByRole("radio", { name: /I will pick them/ }).click();
  await panel.getByLabel("Section title").fill("Our favourites");
  await panel.getByRole("button", { name: "Add Bone Straight HD Frontal" }).click();
  await expect(panel.getByRole("button", { name: "Added Bone Straight HD Frontal" })).toBeDisabled();
  await expect(panel.getByRole("heading", { name: "Chosen products (1 of 24)" })).toBeVisible();
  // Only products that are on sale can be picked, so a draft does not turn up.
  await panel.getByLabel("Find a product").fill("bonnet");
  await expect(panel.getByText("No products match.")).toBeVisible();
  await expect(panel.getByRole("button", { name: "Move Bone Straight HD Frontal earlier" })).toBeDisabled();
  await panel.getByRole("button", { name: "Save and publish" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved. The home page row is updated." }).first()).toBeAttached();
});

test("pages are edited with a preview, and published", async ({ page }) => {
  await signIn(page, "/admin/storefront?tab=pages");
  const pages = page.getByRole("region", { name: "Pages" });
  await expect(pages.getByText("/returns")).toBeVisible();
  await expect(pages.getByRole("listitem").filter({ hasText: "Terms" }).getByText("Draft", { exact: true })).toBeVisible();

  await pages.getByRole("button", { name: "Edit Terms" }).click();
  const drawer = page.getByRole("dialog", { name: "Terms" });
  await drawer.getByLabel("Text").fill("# Terms\n\nBy ordering you agree to **these terms**.");
  await drawer.getByRole("tab", { name: "Preview" }).click();
  await expect(drawer.getByRole("heading", { level: 1, name: "Terms" })).toBeVisible();
  await expect(drawer.getByText("these terms")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await drawer.getByRole("button", { name: "Save and publish" }).click();
  await expect(drawer).toBeHidden();
  await expect(pages.getByRole("listitem").filter({ hasText: "Terms" }).getByText("Live", { exact: true })).toBeVisible();
});
