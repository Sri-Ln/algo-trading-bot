import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface TourStep {
  /** Matches a `data-tour` attribute on the element to highlight. */
  target: string;
  title: string;
  body: string;
}

/** The Overview walkthrough, top to bottom. */
export const STEPS: TourStep[] = [
  {
    target: "status",
    title: "Status bar",
    body: "Always at the top: whether the bot is healthy, when it last ran and runs next, the paper account's value, and the mode it is in today.",
  },
  {
    target: "kpis",
    title: "Headline numbers",
    body: "The paper account, today's mode and what the bot holds, how many daily runs there have been, and how the strategy's backtest compares with just holding the market.",
  },
  {
    target: "latest-run",
    title: "Latest run",
    body: "The most recent daily run, stage by stage: check the market clock, fetch prices, decide, reconcile, place orders. Open it in Decisions for the full trace.",
  },
  {
    target: "services",
    title: "Services and events",
    body: "What the bot depends on (the broker, the price feed, the scheduler) and a log of recent runs and mode changes.",
  },
  {
    target: "backtest",
    title: "Backtest",
    body: "What $1 would have grown to following the rules (blue) vs. holding the stock market (grey). The colored strip shows the mode the bot was in; click the chart to replay that day.",
  },
  {
    target: "tabs",
    title: "Sections",
    body: "Decisions shows every daily decision and can replay any day since 2013; Backtests has the simulations and overfitting checks; Live, the broker account; System, how it's built. Keys 1 to 5 switch between them.",
  },
  {
    target: "theme",
    title: "Theme",
    body: "Light, dark, or follow your device.",
  },
  {
    target: "tour",
    title: "That's the tour",
    body: "Run it again any time from here. Hover or tap any label on the page for a plain-English explanation of it.",
  },
];

const PAD = 6; // space between the highlighted element and its outline
const GAP = 12; // space between the outline and the card
const EDGE = 12; // nearest the card gets to the viewport edge

type Box = { top: number; left: number; width: number; height: number };

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

const find = (target: string) => document.querySelector<HTMLElement>(`[data-tour="${target}"]`);

/** Where the highlighted element is right now, or null if it isn't on the page (or isn't visible). */
function measure(target: string): Box | null {
  const r = find(target)?.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) return null;
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD };
}

/**
 * A step-by-step walkthrough: dims the page, outlines one section at a time and explains it.
 * Back / Next / Skip, plus Esc to close and the arrow keys to move; focus stays in the card.
 */
export function Tour({ steps = STEPS, onClose }: { steps?: TourStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const step = steps[i]!;
  const last = i === steps.length - 1;
  const next = () => (last ? onClose() : setI(i + 1));
  const back = () => setI(Math.max(0, i - 1));

  // Give focus back to whatever had it (e.g. the tour button) when the tour closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => before?.focus?.();
  }, []);

  // Bring each step's section into view, then follow it as the page scrolls or reflows.
  useEffect(() => {
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    find(step.target)?.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
    nextBtn.current?.focus({ preventScroll: true });
    let frame = 0;
    const follow = () => {
      const b = measure(step.target);
      setBox((prev) => (sameBox(prev, b) ? prev : b));
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [step.target]);

  // Put the card below the section if it fits, else above, else as low as it can go.
  useLayoutEffect(() => {
    const el = card.current!;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top: number;
    let left: number;
    if (!box) {
      top = (innerHeight - h) / 2;
      left = (innerWidth - w) / 2;
    } else {
      const below = box.top + box.height + GAP;
      const above = box.top - GAP - h;
      top = below + h <= innerHeight - EDGE ? below : above >= EDGE ? above : innerHeight - EDGE - h;
      left = box.left;
    }
    el.style.top = `${Math.max(EDGE, top)}px`;
    el.style.left = `${Math.max(EDGE, Math.min(left, innerWidth - EDGE - w))}px`;
  });

  // Keyboard: Esc closes, arrows move, Tab stays inside the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
      else if (e.key === "Tab") {
        const items = [...card.current!.querySelectorAll<HTMLElement>("button")];
        const at = items.indexOf(document.activeElement as HTMLElement);
        const to = (at + (e.shiftKey ? -1 : 1) + items.length) % items.length;
        items[to]?.focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  });

  const hole = box ?? { top: innerHeight / 2, left: innerWidth / 2, width: 0, height: 0 };
  return (
    <div className="tour">
      {/* Swallows clicks so the page can't be used behind the tour. */}
      <div className="tour-block" />
      <div className={`tour-hole${box ? "" : " none"}`} style={hole} />
      <div
        ref={card}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        data-target={step.target}
      >
        <span className="tour-count">
          {i + 1} of {steps.length}
        </span>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body">{step.body}</p>
        <div className="tour-actions">
          {!last && (
            <button type="button" className="link" onClick={onClose}>
              Skip tour
            </button>
          )}
          {i > 0 && (
            <button type="button" className="btn" onClick={back}>
              Back
            </button>
          )}
          <button type="button" className="btn primary" ref={nextBtn} onClick={next}>
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
