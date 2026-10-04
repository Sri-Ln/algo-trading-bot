import { useEffect, useRef } from "react";

export interface TipProps {
  "data-tt": string;
  "data-tip": string;
  "data-say"?: string;
}

/** Props that give an element a hover/tap/focus explanation, with an optional "what it says here". */
export const tip = (title: string, body: string, say?: string): TipProps =>
  say ? { "data-tt": title, "data-tip": body, "data-say": say } : { "data-tt": title, "data-tip": body };

/** One shared tooltip for every ``data-tip`` element on the page. */
export function TipLayer() {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tb = box.current!;
    let current: HTMLElement | null = null;

    const place = (el: HTMLElement, cx?: number, cy?: number) => {
      const r = el.getBoundingClientRect();
      const m = 12;
      let top = (cy ?? r.bottom) + 16;
      if (top + tb.offsetHeight > innerHeight - m) top = (cy ?? r.top) - tb.offsetHeight - 12;
      tb.style.left = Math.max(m, Math.min((cx ?? r.left) + 12, innerWidth - tb.offsetWidth - m)) + "px";
      tb.style.top = Math.max(m, top) + "px";
    };
    const show = (el: HTMLElement, cx?: number, cy?: number) => {
      current?.classList.remove("tipped");
      current = el;
      el.classList.add("tipped");
      tb.replaceChildren();
      const title = document.createElement("b");
      title.textContent = el.dataset.tt ?? "";
      tb.append(title, document.createTextNode(el.dataset.tip ?? ""));
      if (el.dataset.say) {
        const say = document.createElement("span");
        say.className = "say";
        say.textContent = el.dataset.say;
        tb.append(say);
      }
      tb.hidden = false;
      place(el, cx, cy);
    };
    const hide = () => {
      tb.hidden = true;
      current?.classList.remove("tipped");
      current = null;
    };
    const target = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>("[data-tip]");

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = target(e);
      if (!el) return void (current && hide());
      if (el !== current) show(el, e.clientX, e.clientY);
      else place(el, e.clientX, e.clientY);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      const el = target(e);
      if (el) show(el, e.clientX, e.clientY);
      else hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = target(e);
      if (el) {
        const r = el.getBoundingClientRect();
        show(el, r.left, r.bottom);
      }
    };
    const onScroll = () => current && !current.matches(":hover") && hide();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();

    // Explanations must be reachable by keyboard too.
    const focusable = () =>
      document
        .querySelectorAll("[data-tip]:not(button):not(input):not(a):not(label):not([tabindex])")
        .forEach((el) => el.setAttribute("tabindex", "0"));
    const observer = new MutationObserver(focusable);
    observer.observe(document.body, { childList: true, subtree: true });
    focusable();

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKey);
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKey);
      removeEventListener("scroll", onScroll);
    };
  }, []);

  return <div id="tipbox" ref={box} role="tooltip" hidden />;
}
