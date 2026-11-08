import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/product/Markdown";
import { Prose } from "./Prose";

describe("Prose", () => {
  it("renders headings, emphasis and lists", () => {
    render(<Prose>{"## Returns\n\nYou have **7 days**.\n\n- Unworn\n- Lace uncut"}</Prose>);
    expect(screen.getByRole("heading", { level: 2, name: "Returns" })).toBeInTheDocument();
    expect(screen.getByText("7 days").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
  it("renders tables", () => {
    render(<Prose>{"| Size | Cm |\n| --- | --- |\n| S | 52 |"}</Prose>);
    expect(screen.getByRole("columnheader", { name: "Size" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "52" })).toBeInTheDocument();
  });
  it("opens external links safely in a new tab, and keeps site links in place", () => {
    render(<Prose>{"[Paystack](https://paystack.com) and [Shop](/shop)"}</Prose>);
    const ext = screen.getByRole("link", { name: "Paystack" });
    expect(ext).toHaveAttribute("target", "_blank");
    expect(ext).toHaveAttribute("rel", "noopener noreferrer");
    const internal = screen.getByRole("link", { name: "Shop" });
    expect(internal).not.toHaveAttribute("target");
  });
  it("never renders raw HTML or scripts", () => {
    const { container } = render(<Prose>{'Hello <script>alert(1)</script><img src=x onerror="alert(1)"><iframe src="https://evil.test"></iframe> world'}</Prose>);
    expect(container.querySelector("script, img, iframe")).toBeNull();
    expect(container.innerHTML).not.toContain("onerror");
  });
  it("neutralises javascript: links", () => {
    const { container } = render(<Prose>{"[click](javascript:alert(1))"}</Prose>);
    const a = container.querySelector("a");
    expect(a?.getAttribute("href") ?? "").not.toMatch(/javascript:/i);
  });
  it("renders nothing harmful for empty text", () => {
    const { container } = render(<Prose>{""}</Prose>);
    expect(container.textContent).toBe("");
  });
  it("Markdown (product text) uses the same safe renderer", () => {
    const { container } = render(<Markdown>{"**Care** <b onclick=x>tip</b>"}</Markdown>);
    expect(screen.getByText("Care").tagName).toBe("STRONG");
    expect(container.innerHTML).not.toContain("onclick");
  });
});
