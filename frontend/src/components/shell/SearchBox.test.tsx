import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { API, server } from "@/test/server";
import { SearchBox } from "./SearchBox";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const seen: string[] = [];
beforeEach(() => {
  push.mockClear();
  seen.length = 0;
  server.use(
    http.get(`${API}/products/suggestions`, ({ request }) => {
      const q = new URL(request.url).searchParams.get("q")!;
      seen.push(q);
      return HttpResponse.json({ data: [{ id: "1", slug: "glueless-bob", title: "Glueless Bob Wig", image: null }, { id: "2", slug: "bob-curl", title: "Bob Curl Wig", image: null }] });
    }),
  );
});

const renderBox = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SearchBox /></QueryClientProvider>);

describe("SearchBox", () => {
  it("suggests after two characters, and asks once for a quick burst of typing", async () => {
    renderBox();
    const box = screen.getByRole("combobox", { name: "Search wigs" });
    await userEvent.type(box, "b");
    await userEvent.type(box, "ob");
    expect(await screen.findByRole("option", { name: /Glueless Bob Wig/ })).toBeInTheDocument();
    expect(seen).toEqual(["bob"]);
  });

  it("walks the suggestions with the arrow keys and opens the chosen product on Enter", async () => {
    renderBox();
    const box = screen.getByRole("combobox", { name: "Search wigs" });
    await userEvent.type(box, "bob");
    await screen.findByRole("option", { name: /Bob Curl Wig/ });
    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(box).toHaveAttribute("aria-activedescendant", expect.stringMatching(/-1$/));
    await userEvent.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/p/bob-curl");
  });

  it("searches the typed text on Enter when no suggestion is highlighted", async () => {
    renderBox();
    await userEvent.type(screen.getByRole("combobox", { name: "Search wigs" }), "26 inch{Enter}");
    expect(push).toHaveBeenCalledWith("/search?q=26%20inch");
  });

  it("does not search for nothing, and does not suggest for one character", async () => {
    renderBox();
    const box = screen.getByRole("combobox", { name: "Search wigs" });
    await userEvent.type(box, "   {Enter}");
    await userEvent.clear(box);
    await userEvent.type(box, "b");
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("option")).toBeNull();
    expect(seen).toEqual([]);
  });
});
