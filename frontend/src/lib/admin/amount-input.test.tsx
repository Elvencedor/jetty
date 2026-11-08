import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { onAmountChange } from "./amount";

function Box({ initial = "", options }: { initial?: string; options?: Parameters<typeof onAmountChange>[2] }) {
  const [value, setValue] = useState(initial);
  return <input aria-label="Amount" value={value} onChange={onAmountChange(value, setValue, options)} />;
}

const box = () => screen.getByLabelText("Amount") as HTMLInputElement;
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

describe("an amount box", () => {
  it("separates thousands while typing and ignores letters", async () => {
    render(<Box />);
    await userEvent.type(box(), "12a3456");
    expect(box().value).toBe("123,456");
  });

  it("keeps the caret where the digit was added, not at the end", async () => {
    render(<Box initial="1,000" />);
    box().focus();
    box().setSelectionRange(1, 1); // after the "1"
    await userEvent.keyboard("5");
    await frame();
    expect(box().value).toBe("15,000");
    expect(box().selectionStart).toBe(2);
  });

  it("lets backspace move over a comma", async () => {
    render(<Box initial="1,234" />);
    box().focus();
    box().setSelectionRange(2, 2); // just after the comma
    await userEvent.keyboard("{Backspace}");
    await frame();
    expect(box().value).toBe("234");
  });

  it("takes a pasted amount with symbols", async () => {
    render(<Box />);
    box().focus();
    await userEvent.paste("₦1500000.5");
    expect(box().value).toBe("1,500,000.5");
  });

  it("allows a signed whole difference when asked", async () => {
    render(<Box options={{ decimal: false, signed: true }} />);
    await userEvent.type(box(), "-45000.9");
    expect(box().value).toBe("-450,009");
  });
});
