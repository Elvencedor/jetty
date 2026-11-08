import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { PasswordSignIn } from "@/components/account/PasswordSignIn";
import { TrackForm } from "@/components/order/TrackForm";
import { useCustomerSession } from "@/lib/stores/session";
import { API, server } from "@/test/server";

const customer = { id: "c1", phone: "+2348031234567", email: "ada@example.com", emailVerified: false, phoneVerified: true, createdAt: "2026-01-01T00:00:00Z" };
const apiError = (code: string, status: number, headers: Record<string, string> = {}) => HttpResponse.json({ error: { code, message: "server message", requestId: "r" } }, { status, headers });
const withQuery = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("PasswordSignIn", () => {
  const type = async (email: string, password: string) => {
    if (email) await userEvent.type(screen.getByLabelText("Email"), email);
    if (password) await userEvent.type(screen.getByLabelText("Password"), password);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  };

  it("validates before calling the API", async () => {
    let calls = 0;
    server.use(http.post(`${API}/auth/login`, () => (calls++, HttpResponse.json({}))));
    render(<PasswordSignIn onDone={vi.fn()} />);
    await type("", "");
    expect(await screen.findByText("Enter a valid email")).toBeInTheDocument();
    expect(screen.getByText("Enter your password")).toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it("signs in with a trimmed, lower-cased email, then reports success and holds the session", async () => {
    let body: unknown;
    server.use(http.post(`${API}/auth/login`, async ({ request }) => ((body = await request.json()), HttpResponse.json({ accessToken: "tok", tokenType: "Bearer", expiresIn: 900, customer }))));
    const onDone = vi.fn();
    render(<PasswordSignIn onDone={onDone} />);
    await type("  Ada@Example.COM ", "correct-horse");
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(body).toEqual({ email: "ada@example.com", password: "correct-horse" });
    expect(useCustomerSession.getState()).toMatchObject({ status: "authenticated", accessToken: "tok" });
  });

  it("shows a vague error for bad credentials and clears the password field", async () => {
    server.use(http.post(`${API}/auth/login`, () => apiError("INVALID_CREDENTIALS", 401)));
    const onDone = vi.fn();
    render(<PasswordSignIn onDone={onDone} />);
    await type("ada@example.com", "wrong-password");
    expect(await screen.findByRole("alert")).toHaveTextContent("That email or password isn't right.");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("tells the shopper how long to wait when rate limited", async () => {
    server.use(http.post(`${API}/auth/login`, () => apiError("RATE_LIMITED", 429, { "Retry-After": "42" })));
    render(<PasswordSignIn onDone={vi.fn()} />);
    await type("ada@example.com", "whatever-pass");
    expect(await screen.findByRole("alert")).toHaveTextContent("42 seconds");
  });

  it("links to password reset", () => {
    render(<PasswordSignIn onDone={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute("href", "/account/reset-password");
  });
});

describe("TrackForm", () => {
  const fill = async (order: string, phone: string) => {
    if (order) await userEvent.type(screen.getByLabelText("Order number"), order);
    if (phone) await userEvent.type(screen.getByLabelText("Phone number"), phone);
    await userEvent.click(screen.getByRole("button", { name: "Track order" }));
  };

  it("asks for both fields", async () => {
    withQuery(<TrackForm />);
    await fill("", "");
    expect(await screen.findByText("Enter your order number")).toBeInTheDocument();
    expect(screen.getByText("Enter the phone number you ordered with")).toBeInTheDocument();
  });

  it("rejects a phone number that is not Nigerian without calling the API", async () => {
    let calls = 0;
    server.use(http.post(`${API}/orders/track`, () => (calls++, HttpResponse.json({}))));
    withQuery(<TrackForm />);
    await fill("JH-1", "12345");
    expect(await screen.findByText("Enter the phone number you ordered with")).toBeInTheDocument();
    expect(calls).toBe(0);
  });

  it("sends the order number upper-cased without '#', and the phone in E.164", async () => {
    let body: unknown;
    server.use(http.post(`${API}/orders/track`, async ({ request }) => ((body = await request.json()), HttpResponse.json({ orderNumber: "JH-10482", status: "packed", placedAt: "2026-06-01T10:00:00Z", timeline: [] }))));
    withQuery(<TrackForm />);
    await fill("#jh-10482", "0803 123 4567");
    expect(await screen.findByRole("region", { name: "Order status" })).toHaveTextContent("#JH-10482");
    expect(body).toEqual({ orderNumber: "JH-10482", phone: "+2348031234567" });
  });

  it("shows no progress tracker for a cancelled order", async () => {
    server.use(http.post(`${API}/orders/track`, () => HttpResponse.json({ orderNumber: "JH-1", status: "cancelled", placedAt: null, timeline: [] })));
    withQuery(<TrackForm />);
    await fill("JH-1", "08031234567");
    const result = await screen.findByRole("region", { name: "Order status" });
    expect(result).toHaveTextContent("#JH-1");
    expect(result.querySelector("ol")).toBeNull();
    expect(result).not.toHaveTextContent("Placed");
  });

  it("says only 'not found' for a wrong number and phone pair", async () => {
    server.use(http.post(`${API}/orders/track`, () => apiError("NOT_FOUND", 404)));
    withQuery(<TrackForm />);
    await fill("JH-9", "08031234567");
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't find an order with that number and phone");
  });

  it("asks the shopper to wait when rate limited, and gives a generic message otherwise", async () => {
    server.use(http.post(`${API}/orders/track`, () => apiError("RATE_LIMITED", 429)));
    withQuery(<TrackForm />);
    await fill("JH-9", "08031234567");
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries");
  });

  it("gives a generic message for server trouble", async () => {
    server.use(http.post(`${API}/orders/track`, () => apiError("INTERNAL_ERROR", 500)));
    withQuery(<TrackForm />);
    await fill("JH-9", "08031234567");
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't look that up right now");
  });
});
