import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useCustomerSession } from "@/lib/stores/session";
import type { Customer } from "@/lib/api/types";
import { Providers } from "./providers";

const customer = (id: string): Customer => ({ id, phone: "+2348031234567", email: null, emailVerified: false, phoneVerified: true, createdAt: "" });
const signIn = (id: string) => act(() => useCustomerSession.getState().setSession({ accessToken: "t", expiresIn: 900, user: customer(id) }));

describe("account data on a shared device", () => {
  function mount() {
    let client!: QueryClient;
    const Probe = () => ((client = useQueryClient()), null);
    render(<Providers><Probe /></Providers>);
    return client;
  }

  it("is forgotten when the customer signs out, but shared catalogue data stays", () => {
    const client = mount();
    signIn("c1");
    client.setQueryData(["my-orders"], { data: ["secret"] });
    client.setQueryData(["my-order", "o1"], { id: "o1" });
    client.setQueryData(["products"], { data: [] });
    act(() => useCustomerSession.getState().clear());
    expect(client.getQueryData(["my-orders"])).toBeUndefined();
    expect(client.getQueryData(["my-order", "o1"])).toBeUndefined();
    expect(client.getQueryData(["products"])).toEqual({ data: [] });
  });

  it("is forgotten when a different customer signs in, and kept when the same one refreshes", () => {
    const client = mount();
    signIn("c1");
    client.setQueryData(["my-orders"], { data: ["mine"] });
    signIn("c1");
    expect(client.getQueryData(["my-orders"])).toEqual({ data: ["mine"] });
    signIn("c2");
    expect(client.getQueryData(["my-orders"])).toBeUndefined();
  });
});
