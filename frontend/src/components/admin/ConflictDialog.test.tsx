import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { useConflictChoice } from "./ConflictDialog";

const conflict = (currentVersion?: number) => new ApiError(412, { code: "PRECONDITION_FAILED", message: "changed", requestId: "r", ...(currentVersion === undefined ? {} : { details: [{ currentVersion }] }) });

/** A save button that fails the way the API does when the version is out of date. */
function Harness({ save, onUseTheirs }: { save: (version: number) => Promise<unknown>; onUseTheirs: () => unknown }) {
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState(0);
  const { offer, dialog } = useConflictChoice({ noun: "zone", onUseTheirs });
  const run = async (version: number): Promise<void> => {
    try {
      await save(version);
      setSaved((n) => n + 1);
      setProblem("");
    } catch (err) {
      if (offer(err, run)) return;
      setProblem("The server had a problem");
      throw err;
    }
  };
  return (
    <>
      <button onClick={() => void run(3).catch(() => undefined)}>Save</button>
      <p>saved {saved}</p>
      {problem ? <p role="alert">{problem}</p> : null}
      {dialog}
    </>
  );
}

describe("the choice offered when a save finds the record changed", () => {
  it("does not appear while saves succeed", async () => {
    render(<Harness save={async () => undefined} onUseTheirs={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("saved 1")).toBeInTheDocument();
    expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument();
  });

  it("does not appear for an error that is not a version conflict", async () => {
    render(<Harness save={async () => { throw new ApiError(500, { code: "INTERNAL", message: "boom", requestId: "r" }); }} onUseTheirs={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The server had a problem");
    expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument();
  });

  it("is not shown for a missing version either: that is a bug, not someone else's edit", async () => {
    render(<Harness save={async () => { throw new ApiError(428, { code: "PRECONDITION_REQUIRED", message: "send it", requestId: "r" }); }} onUseTheirs={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Someone else changed/)).not.toBeInTheDocument();
  });

  it("appears on a conflict, and keeping my changes saves again against the version the API named", async () => {
    const save = vi.fn(async (version: number) => { if (version === 3) throw conflict(7); });
    render(<Harness save={save} onUseTheirs={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Someone else changed this zone")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(7));
    expect(await screen.findByText("saved 1")).toBeInTheDocument();
    expect(screen.queryByText("Someone else changed this zone")).not.toBeInTheDocument();
  });

  it("using their version drops my edits: nothing is saved again", async () => {
    const save = vi.fn(async () => { throw conflict(7); });
    const useTheirs = vi.fn();
    render(<Harness save={save} onUseTheirs={useTheirs} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(await screen.findByRole("button", { name: "Use their version" }));
    await waitFor(() => expect(useTheirs).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("Someone else changed this zone")).not.toBeInTheDocument());
    expect(screen.getByText("saved 0")).toBeInTheDocument();
  });

  it("keep editing closes it without saving or discarding anything", async () => {
    const save = vi.fn(async () => { throw conflict(7); });
    const useTheirs = vi.fn();
    render(<Harness save={save} onUseTheirs={useTheirs} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(screen.queryByText("Someone else changed this zone")).not.toBeInTheDocument());
    expect(save).toHaveBeenCalledTimes(1);
    expect(useTheirs).not.toHaveBeenCalled();
  });

  it("asks again if someone saves yet again while the admin is deciding", async () => {
    const save = vi.fn(async (version: number) => { if (version !== 9) throw conflict(version === 3 ? 7 : 9); });
    render(<Harness save={save} onUseTheirs={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(7));
    expect(await screen.findByText("Someone else changed this zone")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep my changes" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(9));
    expect(await screen.findByText("saved 1")).toBeInTheDocument();
  });

  it("offers only their version when the API did not say which version is current", async () => {
    render(<Harness save={async () => { throw conflict(); }} onUseTheirs={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("button", { name: "Use their version" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep my changes" })).not.toBeInTheDocument();
  });
});
