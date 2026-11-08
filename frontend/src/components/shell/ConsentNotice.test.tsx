import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useConsent } from "@/lib/stores/consent";
import { ConsentNotice } from "./ConsentNotice";
import { PrivacyChoiceButton } from "./PrivacyChoiceButton";

beforeEach(async () => {
  await act(async () => void (await useConsent.persist.rehydrate()));
});

describe("ConsentNotice", () => {
  it("asks until the visitor chooses, with both answers equally available", () => {
    render(<ConsentNotice />);
    expect(screen.getByRole("region", { name: "Privacy choice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "No thanks" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "/pages/privacy");
  });
  it("records 'granted' and goes away", async () => {
    render(<ConsentNotice />);
    await userEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(useConsent.getState().analytics).toBe("granted");
    expect(screen.queryByRole("region", { name: "Privacy choice" })).toBeNull();
  });
  it("records 'denied' and goes away", async () => {
    render(<ConsentNotice />);
    await userEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(useConsent.getState().analytics).toBe("denied");
    expect(screen.queryByRole("region", { name: "Privacy choice" })).toBeNull();
  });
  it("stays hidden for a visitor who already chose", () => {
    useConsent.setState({ analytics: "granted" });
    render(<ConsentNotice />);
    expect(screen.queryByRole("region", { name: "Privacy choice" })).toBeNull();
  });
  it("comes back when the footer's privacy-choices button resets the choice", async () => {
    useConsent.setState({ analytics: "denied" });
    render(<><ConsentNotice /><PrivacyChoiceButton /></>);
    expect(screen.queryByRole("region", { name: "Privacy choice" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /privacy choices/i }));
    expect(useConsent.getState().analytics).toBe("unset");
    expect(await screen.findByRole("region", { name: "Privacy choice" })).toBeInTheDocument();
  });
});
