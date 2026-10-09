// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { markTourSeen, readTourSeen, TOUR_KEY } from "../lib/tour";
import { Tour, type TourStep } from "./Tour";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("tour seen flag", () => {
  it("is unset at first and set once marked", () => {
    expect(readTourSeen()).toBe(false);
    markTourSeen();
    expect(localStorage.getItem(TOUR_KEY)).toBe("seen");
    expect(readTourSeen()).toBe(true);
  });

  it("treats blocked storage as not seen and doesn't throw", () => {
    const blocked = (): Storage => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    expect(readTourSeen(blocked)).toBe(false);
    expect(() => markTourSeen(blocked)).not.toThrow();
  });
});

const STEPS: TourStep[] = [
  { target: "a", title: "First", body: "one" },
  { target: "b", title: "Second", body: "two" },
  { target: "c", title: "Third", body: "three" },
];

function setup() {
  const onClose = vi.fn();
  render(
    <>
      <div data-tour="a" />
      <div data-tour="b" />
      <Tour steps={STEPS} onClose={onClose} />
    </>,
  );
  const title = () => screen.getByRole("dialog").querySelector("h2")!.textContent;
  const count = () => screen.getByRole("dialog").querySelector(".tour-count")!.textContent;
  return { onClose, title, count };
}

const key = (k: string) => act(() => void fireEvent.keyDown(document, { key: k }));

describe("Tour", () => {
  it("steps forward and back, and closes on Done", () => {
    const { onClose, title, count } = setup();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    expect(title()).toBe("First");
    expect(count()).toBe("1 of 3");
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(title()).toBe("Second");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(title()).toBe("First");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(count()).toBe("3 of 3");
    expect(screen.queryByRole("button", { name: "Skip tour" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("can be skipped", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("moves with the arrow keys and closes on Escape", async () => {
    const { onClose, title } = setup();
    await key("ArrowRight");
    expect(title()).toBe("Second");
    await key("ArrowLeft");
    expect(title()).toBe("First");
    await key("ArrowLeft");
    expect(title()).toBe("First");
    await key("Escape");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("starts with focus on Next and keeps Tab inside the card", async () => {
    setup();
    expect(document.activeElement?.textContent).toBe("Next");
    await key("Tab");
    expect(document.activeElement?.textContent).toBe("Skip tour");
    await key("Tab");
    expect(document.activeElement?.textContent).toBe("Next");
  });

  it("points at each step's section", () => {
    setup();
    expect(screen.getByRole("dialog").dataset.target).toBe("a");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog").dataset.target).toBe("b");
  });
});
