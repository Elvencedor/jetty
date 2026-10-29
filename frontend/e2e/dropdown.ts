import { expect, type Locator } from "@playwright/test";

/** Opens a custom dropdown and chooses an option by its visible text. */
export async function choose(dropdown: Locator, option: string | RegExp) {
  await dropdown.click();
  await dropdown.page().getByRole("option", { name: option, exact: typeof option === "string" }).click();
  await expect(dropdown).toHaveAttribute("aria-expanded", "false");
}
