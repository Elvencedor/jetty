import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Badge, Button, Chip, EmptyState, IconButton, Media, SearchField, Segmented, SelectField, StatusPill, Switch, TextField, TextareaField } from "./index";

describe("Button", () => {
  it("is a real button that defaults to type=button, so it never submits a form by accident", () => {
    render(<Button>Add to bag</Button>);
    expect(screen.getByRole("button", { name: "Add to bag" })).toHaveAttribute("type", "button");
  });

  it("renders a link when given an href, so navigation is never a button", () => {
    render(<Button href="/bag">View bag</Button>);
    expect(screen.getByRole("link", { name: "View bag" })).toHaveAttribute("href", "/bag");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("while loading is busy and disabled, keeps its label for the layout, and ignores clicks", async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Pay</Button>);
    const button = screen.getByRole("button", { name: "Pay" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("fires onClick and supports icons and full width", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick} fullWidth iconLeft={<svg data-testid="icon" />}>Go</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("icon")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveClass("w-full");
  });
});

describe("IconButton", () => {
  it("is named by its label, and the badge count joins the name", () => {
    const { rerender } = render(<IconButton label="Open bag" icon={<svg />} />);
    expect(screen.getByRole("button", { name: "Open bag" })).toBeInTheDocument();
    rerender(<IconButton label="Open bag" icon={<svg />} badge={3} />);
    expect(screen.getByRole("button", { name: "Open bag, 3 items" })).toBeInTheDocument();
    rerender(<IconButton label="Open bag" icon={<svg />} badge={1} />);
    expect(screen.getByRole("button", { name: "Open bag, 1 item" })).toBeInTheDocument();
    rerender(<IconButton label="Open bag" icon={<svg />} badge={0} />);
    expect(screen.getByRole("button", { name: "Open bag" })).toBeInTheDocument();
  });

  it("caps a large count visually", () => {
    render(<IconButton label="Bag" icon={<svg />} badge={250} />);
    expect(screen.getByText("99+")).toBeInTheDocument();
    // What is shown is what is spoken.
    expect(screen.getByRole("button", { name: "Bag, 99+ items" })).toBeInTheDocument();
  });
});

describe("Chip", () => {
  it("reports its selected state to assistive technology and toggles on click", async () => {
    function Demo() {
      const [on, setOn] = useState(false);
      return <Chip selected={on} onClick={() => setOn(!on)}>20&quot;</Chip>;
    }
    render(<Demo />);
    const chip = screen.getByRole("button", { name: '20"' });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip).toHaveClass("bg-primary");
  });

  it("shows a sold-out choice as disabled and struck through, with its own accessible name", async () => {
    const onClick = vi.fn();
    render(<Chip disabled aria-label="30 inches, sold out" onClick={onClick}>30&quot;</Chip>);
    const chip = screen.getByRole("button", { name: "30 inches, sold out" });
    expect(chip).toBeDisabled();
    expect(screen.getByText('30"')).toHaveClass("line-through");
    await userEvent.click(chip);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows a price note under the label, and static/removable variants", async () => {
    const onRemove = vi.fn();
    render(
      <>
        <Chip note="+₦25k">HD</Chip>
        <Chip variant="removable" onClick={onRemove}>Body wave</Chip>
        <Chip variant="static">Info</Chip>
      </>,
    );
    expect(screen.getByText("+₦25k")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Body wave" }));
    expect(onRemove).toHaveBeenCalled();
    expect(screen.getByText("Info").closest("button")).toBeNull();
  });
});

describe("Segmented", () => {
  const items = [{ value: "a", label: "Featured" }, { value: "b", label: "On deal", count: 4 }, { value: "c", label: "Care" }];

  it("as tabs: arrow keys move and select, with roving tab stops", async () => {
    const onChange = vi.fn();
    render(<Segmented mode="tabs" label="Picks" items={items} value="a" onChange={onChange} />);
    expect(screen.getByRole("tablist", { name: "Picks" })).toBeInTheDocument();
    const [first, second, third] = screen.getAllByRole("tab");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");
    first!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("b");
    expect(second).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("c");
    third!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("keeps one tab stop even when the value matches no tab", () => {
    render(<Segmented mode="tabs" label="Picks" items={items} value="missing" onChange={() => undefined} />);
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
  });

  it("as a filter: pressed buttons in a group, with counts", async () => {
    const onChange = vi.fn();
    render(<Segmented label="Status" items={items} value="b" onChange={onChange} tone="primary" />);
    expect(screen.getByRole("group", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /On deal/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Care" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByRole("button", { name: "Care" }));
    expect(onChange).toHaveBeenCalledWith("c");
  });
});

describe("Switch", () => {
  it("is a switch with a name, toggled by click and keyboard", async () => {
    function Demo() {
      const [on, setOn] = useState(false);
      return <Switch checked={on} onChange={setOn} label="Show hero cards" />;
    }
    render(<Demo />);
    const toggle = screen.getByRole("switch", { name: "Show hero cards" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    toggle.focus();
    await userEvent.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("cannot be toggled when disabled", async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Locked" disabled />);
    await userEvent.click(screen.getByRole("switch", { name: "Locked" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("form fields", () => {
  it("connects the label, the hint and the control", () => {
    render(<TextField label="Full name" hint="As on your ID" />);
    const input = screen.getByLabelText("Full name");
    expect(input).toHaveAccessibleDescription("As on your ID");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("announces an error, marks the field invalid and replaces the hint with it", () => {
    render(<TextField label="Phone" hint="We text updates" error="Enter a Nigerian phone number" />);
    const input = screen.getByLabelText("Phone");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a Nigerian phone number");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a Nigerian phone number");
    expect(screen.queryByText("We text updates")).toBeNull();
  });

  it("accepts typing and shows a prefix without making it part of the value", async () => {
    render(<TextField label="Amount" prefix="₦" />);
    const input = screen.getByLabelText("Amount");
    await userEvent.type(input, "5000");
    expect(input).toHaveValue("5000");
    expect(screen.getByText("₦")).toHaveAttribute("aria-hidden", "true");
  });

  it("supports select, textarea and search with the same labelling", async () => {
    render(
      <>
        <SelectField label="State"><option value="LA">Lagos</option><option value="FC">FCT</option></SelectField>
        <TextareaField label="Landmark" error="Too long" />
        <SearchField aria-label="Search the shop" />
      </>,
    );
    await userEvent.selectOptions(screen.getByLabelText("State"), "FC");
    expect(screen.getByLabelText("State")).toHaveValue("FC");
    expect(screen.getByLabelText("Landmark")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("searchbox", { name: "Search the shop" })).toBeInTheDocument();
  });
});

describe("Media", () => {
  it("without an image shows a placeholder with its caption, named for screen readers", () => {
    render(<Media image={null} alt="Front view" caption="Front · hi-res photo" />);
    expect(screen.getByRole("img", { name: "Front view" })).toBeInTheDocument();
    expect(screen.getByText("Front · hi-res photo")).toBeInTheDocument();
  });

  it("reserves its shape up front and renders the picture with its alt text", () => {
    const { container } = render(<Media image={{ url: "https://cdn.example.com/a.webp" }} alt="Body wave frontal" aspect="1 / 1.25" />);
    expect(container.firstElementChild).toHaveStyle({ aspectRatio: "1 / 1.25" });
    expect(screen.getByRole("img", { name: "Body wave frontal" })).toBeInTheDocument();
  });

  it("treats a null URL like no image, and a decorative image as hidden from screen readers", () => {
    const { rerender } = render(<Media image={{ url: null }} alt="" />);
    expect(screen.queryByRole("img")).toBeNull();
    rerender(<Media image={{ url: "https://cdn.example.com/a.webp" }} alt="" />);
    expect(screen.queryByRole("img", { name: "" })).toBeNull();
  });
});

describe("small display components", () => {
  it("StatusPill and Badge show their text", () => {
    render(
      <>
        <StatusPill tone="success">Delivered</StatusPill>
        <Badge kind="sale">−14%</Badge>
      </>,
    );
    expect(screen.getByText("Delivered")).toHaveClass("bg-success-bg");
    expect(screen.getByText("−14%")).toHaveClass("bg-primary");
  });

  it("EmptyState has a heading, help text and an optional action", () => {
    render(<EmptyState title="Your bag is empty" action={<Button href="/shop">Shop wigs</Button>}>Add a wig to begin.</EmptyState>);
    expect(screen.getByRole("heading", { name: "Your bag is empty" })).toBeInTheDocument();
    expect(screen.getByText("Add a wig to begin.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Shop wigs" })).toBeInTheDocument();
  });
});
