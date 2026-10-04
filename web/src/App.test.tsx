// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { App } from "./App";

// Renders the whole console against the API files written by
// `algo-trading export --out web/public`.
const API = join(__dirname, "..", "public", "api");

beforeAll(() => {
  if (!existsSync(join(API, "status.json"))) {
    throw new Error(`no exported API in ${API}; run: uv run algo-trading export --out web/public`);
  }
  vi.stubGlobal("fetch", async (url: string) => {
    const path = join(API, url.replace(/^api\//, ""));
    if (!existsSync(path)) return new Response("not found", { status: 404 });
    return new Response(readFileSync(path), { status: 200 });
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 900 });
});

afterEach(cleanup);

const errors: unknown[] = [];
console.error = (...args: unknown[]) => errors.push(args);

async function open(tab: string) {
  await act(async () => fireEvent.click(screen.getByRole("tab", { name: tab })));
  return screen.findByRole("heading", { level: 1, name: tab });
}

describe("console", () => {
  it("renders every tab without errors", async () => {
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    expect(screen.getByText("Backtest Sharpe")).toBeTruthy();

    await open("Decisions");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Replay" })));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Mar 2020" })));
    await screen.findByText(/2020-03-16/);
    await screen.findAllByText("rule_1");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "JSON" })));
    expect(document.querySelector("pre.json")?.textContent).toContain('"regime"');

    await open("Backtests");
    const slider = screen.getByRole("slider");
    await act(async () => fireEvent.change(slider, { target: { value: "25" } }));
    expect(document.querySelector(".cost .mono")?.textContent).toBe("25 bps");
    expect(document.querySelector("tr.sel")?.textContent).toContain("high-cost");
    expect(document.querySelectorAll(".heat .c").length).toBe(25);

    await open("Live");
    await open("System");
    expect(screen.getByText("/api/status.json")).toBeTruthy();

    expect(errors).toEqual([]);
  });
});
