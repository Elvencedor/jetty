import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("an info page renders its markdown safely, links inside the site normally and outside it safely", async ({ page }) => {
  await page.goto("/pages/returns");
  await expect(page).toHaveTitle(/Returns and refunds/);
  await expect(page.getByRole("heading", { level: 1, name: "Returns and refunds" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Returning an item" })).toBeVisible();
  await expect(page.getByText("7 days")).toBeVisible();
  // Raw HTML from the CMS is never run or shown as markup.
  await expect(page.locator("main script")).toHaveCount(0);
  await expect(page.locator("article").getByRole("link", { name: "Track an order" })).toHaveAttribute("href", "/track");
  const external = page.locator("article").getByRole("link", { name: "FAQs" });
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("rel", /noopener/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/pages\/returns$/);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("the contact page adds the store's current contact details", async ({ page }) => {
  await page.goto("/pages/contact");
  await expect(page.getByRole("link", { name: "+2348000000000" }).first()).toBeVisible();
  await expect(page.getByText("Lekki, Lagos").first()).toBeVisible();
});

test("a page that does not exist is not found", async ({ page }) => {
  await page.goto("/pages/does-not-exist");
  await expect(page.getByRole("heading", { name: /couldn.t find that page/i })).toBeVisible();
});

test("the privacy choice is asked inline, respected, and can be reopened", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const notice = page.getByRole("region", { name: "Privacy choice" });
  await expect(notice).toBeVisible();

  // Nothing is sent before a choice, and the page is usable meanwhile.
  const sent: string[] = [];
  page.on("request", (r) => r.url().includes("/analytics/events") && sent.push(r.url()));
  await page.goto("/p/glueless-bob");
  await page.waitForLoadState("networkidle");
  expect(sent).toHaveLength(0);

  await page.getByRole("button", { name: "No thanks" }).click();
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.getByRole("region", { name: "Privacy choice" })).toHaveCount(0);

  // Reopened from the footer.
  await page.getByRole("button", { name: "Privacy choices" }).click();
  await expect(page.getByRole("region", { name: "Privacy choice" })).toBeVisible();
});

test("agreeing to analytics starts recording visits", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Allow" }).click();
  const request = page.waitForRequest((r) => r.url().includes("/analytics/events"));
  await page.goto("/p/glueless-bob");
  const body = (await request).postDataJSON() as { events: { name: string }[] };
  expect(body.events.map((e) => e.name)).toContain("product_view");
});

test("robots.txt keeps private pages out and points to the sitemap", async ({ request }) => {
  const text = await (await request.get("/robots.txt")).text();
  expect(text).toMatch(/Disallow: \/checkout/);
  expect(text).toMatch(/Disallow: \/account/);
  expect(text).toMatch(/Sitemap: .*\/sitemap\.xml/);
});

test("the sitemap lists every product, the categories, and only the pages that exist", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  for (const path of ["/", "/shop", "/shop/frontal", "/shop/new-arrivals", "/p/bone-straight-frontal", "/p/glueless-bob", "/p/deep-curly-closure", "/pages/returns", "/pages/contact"]) {
    expect(xml, path).toContain(`${path === "/" ? "" : path}</loc>`);
  }
  expect(xml).not.toContain("/pages/terms</loc>");
  expect(xml).not.toContain("/checkout");
});

test("link previews have a title, an image and the right canonical address", async ({ page }) => {
  await page.goto("/p/bone-straight-frontal?rating=5");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Bone Straight/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/p\/bone-straight-frontal$/);
  await page.goto("/shop/frontal?sort=newest&texture=straight");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/shop\/frontal$/);
  await page.goto("/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /opengraph-image/);
  const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
  expect(JSON.parse(ld!)["@graph"].map((n: { "@type": string }) => n["@type"])).toEqual(["Organization", "WebSite"]);
});
