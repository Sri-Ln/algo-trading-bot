// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { TOUR_KEY } from "./lib/tour";

// Renders the whole console against the API files written by
// `algo-trading export --out web/public`.
const API = join(__dirname, "..", "public", "api");

beforeAll(() => {
  if (!existsSync(join(API, "status.json"))) {
    throw new Error(`no exported API in ${API}; run: uv run algo-trading export --out web/public`);
  }
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 900 });
});

const fromFiles = async (url: string) => {
  const path = join(API, url.replace(/^api\//, ""));
  if (!existsSync(path)) return new Response("not found", { status: 404 });
  return new Response(readFileSync(path), { status: 200 });
};

beforeEach(() => {
  vi.stubGlobal("fetch", fromFiles);
  localStorage.setItem(TOUR_KEY, "seen");
});
afterEach(cleanup);

const errors: unknown[] = [];
console.error = (...args: unknown[]) => errors.push(args);

async function open(tab: string) {
  await act(async () => fireEvent.click(screen.getByRole("tab", { name: tab })));
  return screen.findByRole("heading", { level: 1, name: tab });
}

describe("console", () => {
  it("shows the layout skeleton while data loads", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    render(<App />);
    expect(screen.getByRole("status").textContent).toContain("Loading the console");
    expect(screen.getByText("algo-trading-bot")).toBeTruthy();
  });

  it("offers a retry when data fails to load", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    render(<App />);
    expect((await screen.findByRole("alert")).textContent).toContain("HTTP 503");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

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

describe("product tour", () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, "", location.pathname);
  });

  it("opens on a first visit and not on the next", async () => {
    render(<App />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Status bar");
    expect(localStorage.getItem(TOUR_KEY)).toBe("seen");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Skip tour" })));
    expect(screen.queryByRole("dialog")).toBeNull();

    cleanup();
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("waits when the first visit is a link to another tab", async () => {
    history.replaceState(null, "", "#backtests");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Backtests" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(TOUR_KEY)).toBeNull();
  });

  it("replays from the Product tour button, on Overview", async () => {
    localStorage.setItem(TOUR_KEY, "seen");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    await open("Live");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Product tour" })));
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toContain("1 of 8");
  });

  it("pauses the 1-5 tab shortcuts while open", async () => {
    render(<App />);
    await screen.findByRole("dialog");
    await act(async () => fireEvent.keyDown(document, { key: "3" }));
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
  });
});
