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
type Point = { top: number; left: number };

/**
 * How the spotlight and card travel from one section to the next. Try them with `?tour=<name>`.
 * glide: slow and fluid ("balletic"); stalk: a still beat, then a deliberate approach that
 * settles; skitter: quick, with a small overshoot; instant: jumps (also used for reduced motion).
 */
export type Motion = "glide" | "stalk" | "skitter" | "instant";
const MOTIONS: Record<Motion, { ms: number; wait: number; ease: (t: number) => number }> = {
  // Ease-out, so it answers the click at once and slows as it lands.
  glide: { ms: 450, wait: 0, ease: (t) => 1 - (1 - t) ** 3 },
  stalk: { ms: 800, wait: 220, ease: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2) },
  skitter: { ms: 320, wait: 0, ease: (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2 },
  instant: { ms: 0, wait: 0, ease: () => 1 },
};

/** The motion from `?tour=`, glide by default, instant when the viewer asks for reduced motion. */
export function pickMotion(): Motion {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return "instant";
  const asked = new URLSearchParams(location.search).get("tour");
  return asked && asked in MOTIONS ? (asked as Motion) : "glide";
}

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const lerpBox = (a: Box, b: Box, p: number): Box => ({
  top: lerp(a.top, b.top, p),
  left: lerp(a.left, b.left, p),
  width: Math.max(0, lerp(a.width, b.width, p)),
  height: Math.max(0, lerp(a.height, b.height, p)),
});
const screenBox = (): Box => ({ top: 0, left: 0, width: innerWidth, height: innerHeight });

const find = (target: string) => document.querySelector<HTMLElement>(`[data-tour="${target}"]`);

/** Where the highlighted element is right now, or null if it isn't on the page (or isn't visible). */
function measure(target: string): Box | null {
  const r = find(target)?.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) return null;
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD };
}

/** The card goes below the section if it fits, else above, else as low as it can; centered with no section. */
function placeCard(box: Box | null, w: number, h: number): Point {
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
  return { top: Math.max(EDGE, top), left: Math.max(EDGE, Math.min(left, innerWidth - EDGE - w)) };
}

/**
 * A step-by-step walkthrough: dims the page, outlines one section at a time and explains it.
 * Back / Next / Skip, plus Esc to close and the arrow keys to move; focus stays in the card.
 * The spotlight opens from the whole screen onto the first section, then travels between them.
 */
export function Tour({ steps = STEPS, motion, onClose }: { steps?: TourStep[]; motion?: Motion; onClose: () => void }) {
  const [i, setI] = useState(0);
  const hole = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const spec = MOTIONS[useState(() => motion ?? pickMotion())[0]];
  // What is on screen now, and where the current move started from and when.
  const shown = useRef<{ hole: Box; card: Point | null } | null>(null);
  const move = useRef({ target: "", from: screenBox(), cardFrom: null as Point | null, start: 0 });
  const step = steps[i]!;
  const last = i === steps.length - 1;
  const next = () => (last ? onClose() : setI(i + 1));
  const back = () => setI(Math.max(0, i - 1));

  // Give focus back to whatever had it (e.g. the tour button) when the tour closes. Read while
  // rendering, before the step effect below moves focus into the card.
  const [before] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => () => before?.focus?.(), [before]);

  // Each step starts a move from wherever the spotlight and card are now (the whole screen at first).
  useLayoutEffect(() => {
    move.current = {
      target: step.target,
      from: shown.current?.hole ?? screenBox(),
      cardFrom: shown.current?.card ?? null,
      start: performance.now() + spec.wait,
    };
    card.current!.dataset.settled = "false";
    find(step.target)?.scrollIntoView({ block: "center", behavior: spec.ms ? "smooth" : "auto" });
    nextBtn.current?.focus({ preventScroll: true });
  }, [step.target, spec]);

  // Every frame: ease from the start of the move toward the section's live position, so the
  // spotlight lands correctly even while the page scrolls underneath it.
  useLayoutEffect(() => {
    let frame = 0;
    const draw = (now: number) => {
      const m = move.current;
      const target = measure(m.target);
      const t = spec.ms ? Math.min(1, Math.max(0, (now - m.start) / spec.ms)) : 1;
      const p = spec.ease(t);
      const to = target ?? { top: innerHeight / 2, left: innerWidth / 2, width: 0, height: 0 };
      const h = lerpBox(m.from, to, p);
      const el = card.current!;
      const c = placeCard(target, el.offsetWidth, el.offsetHeight);
      const cp = m.cardFrom ? { top: lerp(m.cardFrom.top, c.top, p), left: lerp(m.cardFrom.left, c.left, p) } : c;
      Object.assign(hole.current!.style, { top: `${h.top}px`, left: `${h.left}px`, width: `${h.width}px`, height: `${h.height}px` });
      hole.current!.classList.toggle("none", !target && t === 1);
      el.style.top = `${cp.top}px`;
      el.style.left = `${cp.left}px`;
      // The first card rises in as the spotlight lands.
      el.style.opacity = m.cardFrom ? "1" : String(Math.min(1, Math.max(0, (p - 0.35) / 0.65)));
      el.style.translate = m.cardFrom ? "" : `0 ${(1 - p) * 10}px`;
      shown.current = { hole: h, card: cp };
      el.dataset.settled = String(t === 1);
      frame = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => cancelAnimationFrame(frame);
  }, [spec]);

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

  return (
    <div className="tour">
      {/* Swallows clicks so the page can't be used behind the tour. */}
      <div className="tour-block" />
      <div ref={hole} className="tour-hole" />
      <div
        ref={card}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        data-target={step.target}
      >
        <div key={i} className="tour-text">
          <span className="tour-count">
            {i + 1} of {steps.length}
          </span>
          <h2 id="tour-title">{step.title}</h2>
          <p id="tour-body">{step.body}</p>
        </div>
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
