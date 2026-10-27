import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { pageRange, useCursorStack } from "@/lib/admin/useCursorStack";
import { toast, useToasts } from "@/lib/stores/toast";
import { ConfirmDialog } from "./ConfirmDialog";
import { DataTable, type Column } from "./DataTable";
import { InlineEditor } from "./InlineEditor";
import { SideDrawer } from "./SideDrawer";
import { TablePager } from "./TablePager";
import { Toaster } from "./Toaster";
import { renderHook } from "@testing-library/react";

type Row = { id: string; name: string; total: number };
const rows: Row[] = [{ id: "a", name: "JH-1", total: 100 }, { id: "b", name: "JH-2", total: 200 }];
const columns: Column<Row>[] = [{ key: "name", header: "Order", cell: (r) => r.name }, { key: "total", header: "Total", cell: (r) => r.total, align: "right" }];

describe("DataTable", () => {
  it("renders rows, opens a row from its first cell, and highlights the open one", async () => {
    const onOpen = vi.fn();
    render(<DataTable caption="Orders" columns={columns} rows={rows} rowKey={(r) => r.id} onOpen={onOpen} openLabel={(r) => r.name} selectedId="b" />);
    expect(screen.getByRole("table", { name: "Orders" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open JH-1" }));
    expect(onOpen).toHaveBeenCalledWith(rows[0]);
    expect(screen.getByText("JH-2").closest("tr")).toHaveAttribute("aria-selected", "true");
  });

  it("shows skeleton rows while loading, the empty state when there is nothing, and Retry on failure", async () => {
    const { rerender } = render(<DataTable caption="Orders" columns={columns} rows={undefined} loading rowKey={(r) => r.id} />);
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
    rerender(<DataTable caption="Orders" columns={columns} rows={[]} rowKey={(r) => r.id} empty={<p>No orders yet</p>} />);
    expect(screen.getByText("No orders yet")).toBeInTheDocument();
    const retry = vi.fn();
    rerender(<DataTable caption="Orders" columns={columns} rows={undefined} rowKey={(r) => r.id} error={{ message: "Couldn't load orders", onRetry: retry }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load orders");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });

  it("selects rows and all rows on the page, with a mixed state in between", async () => {
    function Harness() {
      const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
      return <DataTable caption="Orders" columns={columns} rows={rows} rowKey={(r) => r.id} openLabel={(r) => r.name} selection={{ ids, onChange: setIds }} />;
    }
    render(<Harness />);
    const all = screen.getByRole("checkbox", { name: /Select all orders/ }) as HTMLInputElement;
    await userEvent.click(screen.getByRole("checkbox", { name: "Select JH-1" }));
    expect(all.indeterminate).toBe(true);
    await userEvent.click(all);
    expect(screen.getByRole("checkbox", { name: "Select JH-2" })).toBeChecked();
    await userEvent.click(all);
    expect(screen.getByRole("checkbox", { name: "Select JH-1" })).not.toBeChecked();
  });
});

describe("paging", () => {
  it("steps forward and back through remembered cursors", () => {
    const { result } = renderHook(() => useCursorStack());
    expect([result.current.cursor, result.current.canPrev]).toEqual([undefined, false]);
    act(() => result.current.next("c2"));
    act(() => result.current.next("c3"));
    expect([result.current.cursor, result.current.index]).toEqual(["c3", 2]);
    act(() => result.current.prev());
    expect(result.current.cursor).toBe("c2");
    act(() => result.current.reset());
    expect([result.current.cursor, result.current.canPrev]).toEqual([undefined, false]);
  });
  it("describes the range on a page", () => {
    expect(pageRange(0, 8, 8)).toEqual({ from: 1, to: 8 });
    expect(pageRange(2, 8, 3)).toEqual({ from: 17, to: 19 });
    expect(pageRange(0, 8, 0)).toEqual({ from: 0, to: 0 });
  });
  it("says where you are and disables what cannot be pressed", () => {
    render(<TablePager from={1} to={8} total={1842} canPrev={false} canNext onPrev={() => {}} onNext={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1–8 of 1,842");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });
});

describe("SideDrawer", () => {
  function Harness({ dirty }: { dirty: boolean }) {
    const [open, setOpen] = useState(true);
    return <><p>{open ? "open" : "closed"}</p><SideDrawer open={open} onClose={() => setOpen(false)} title="Order JH-1" subtitle="Placed today" dirty={dirty}><p>Details</p></SideDrawer></>;
  }
  it("closes straight away when nothing has changed", async () => {
    render(<Harness dirty={false} />);
    expect(screen.getByRole("dialog", { name: "Order JH-1" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByText("closed")).toBeInTheDocument();
  });
  it("asks before discarding changes, and keeps the drawer if told to keep editing", async () => {
    render(<Harness dirty />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    const ask = await screen.findByRole("dialog", { name: "Discard your changes?" });
    expect(screen.getByText("open")).toBeInTheDocument();
    await userEvent.click(within(ask).getByRole("button", { name: "Keep editing" }));
    expect(screen.getByText("open")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Discard your changes?" })).getByRole("button", { name: "Discard changes" }));
    expect(screen.getByText("closed")).toBeInTheDocument();
  });
  it("warns the browser about leaving while there are unsaved changes, and only then", () => {
    const { unmount } = render(<Harness dirty />);
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    unmount();
    const later = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });
});

describe("ConfirmDialog", () => {
  it("confirms or cancels, and cannot be dismissed while busy", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(<ConfirmDialog open title="Cancel this order?" confirmLabel="Cancel order" tone="danger" onConfirm={onConfirm} onCancel={onCancel}>This releases the stock.</ConfirmDialog>);
    expect(screen.getByRole("dialog", { name: "Cancel this order?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    rerender(<ConfirmDialog open title="Cancel this order?" confirmLabel="Cancel order" busy onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});

describe("Toaster", () => {
  it("announces messages, errors as alerts, with an action, and dismisses them", async () => {
    useToasts.setState({ toasts: [] });
    render(<Toaster />);
    const undo = vi.fn();
    act(() => {
      toast.success("Order packed", { label: "Undo", onClick: undo });
      toast.error("Couldn't save");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Order packed");
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalled();
    expect(screen.queryByText("Order packed")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Couldn't save")).toBeNull();
  });
  it("keeps only the latest few", () => {
    useToasts.setState({ toasts: [] });
    act(() => { for (let i = 0; i < 7; i++) toast.info(`m${i}`); });
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(["m3", "m4", "m5", "m6"]);
  });
});

describe("InlineEditor", () => {
  it("edits in place, saves, and shows why a save was refused", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new ApiError(412, { code: "PRECONDITION_FAILED", message: "stale", requestId: "r" })).mockResolvedValueOnce(undefined);
    render(<InlineEditor label="Store name" value="Jetty" onSave={onSave} validate={(v) => (v.trim() ? undefined : "Enter a name")} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Store name" }));
    const field = screen.getByLabelText("Store name");
    await userEvent.clear(field);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter a name")).toBeInTheDocument();
    await userEvent.type(field, "Jetty's Hair");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Someone else changed this. Reload to see their version.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByLabelText("Store name")).toBeNull());
    expect(onSave).toHaveBeenLastCalledWith("Jetty's Hair");
  });
});
