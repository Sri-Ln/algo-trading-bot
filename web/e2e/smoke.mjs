// Opens the built console in a real browser, visits every tab at desktop and
// phone widths, fails on any page error, and saves screenshots.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 4173;
const OUT = "e2e/screenshots";
mkdirSync(OUT, { recursive: true });

// Run Vite's own entry point, not npx, so kill() stops the server rather than a wrapper.
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--port", String(PORT), "--strictPort"], { stdio: "inherit" });
const stop = () => server.kill();

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("preview server did not start");
}

const TABS = ["Overview", "Decisions", "Backtests", "Live", "System"];
const errors = [];

// Pages for the other checks start with the tour already seen, so it doesn't cover them.
const skipTour = (target) => target.addInitScript(() => localStorage.setItem("tour", "seen"));

const DARK_BG = "#0a0e14";
const LIGHT_BG = "#f2f4f7";

// The status bar stays where it starts while the page scrolls under it, and the sticky
// side nav (desktop) stays below it however many rows the bar wraps to.
async function checkSticky(browser, name, viewport) {
  const fail = (msg) => errors.push(`sticky ${name}: ${msg}`);
  const page = await browser.newPage({ viewport });
  await skipTour(page);
  page.on("pageerror", (e) => fail(e.message));
  await page.goto(`http://localhost:${PORT}/#backtests`);
  await page.getByRole("heading", { level: 1, name: "Backtests" }).waitFor();
  const at = () =>
    page.evaluate(() => {
      const bar = document.querySelector(".status").getBoundingClientRect();
      const nav = document.querySelector("nav.side");
      return { top: bar.top, bottom: bar.bottom, navTop: nav.getBoundingClientRect().top, navSticky: getComputedStyle(nav).position === "sticky" };
    });
  const before = await at();
  await page.evaluate(() => scrollTo(0, 900));
  await page.waitForTimeout(200);
  const after = await at();
  if ((await page.evaluate(() => scrollY)) < 300) fail("page did not scroll; the test needs a longer tab");
  if (Math.abs(after.top - before.top) > 1) fail(`status bar moved from ${before.top} to ${after.top}`);
  if (after.navSticky && after.navTop < after.bottom) fail(`side nav (top ${after.navTop}) is under the status bar (bottom ${after.bottom})`);
  await page.close();
}

// The product tour: opens by itself a moment into a first visit, travels smoothly between the
// Overview sections with the rest of the page dimmed and blocked, stays closed on the next
// visit, and replays from its button (Next with the arrow key, Esc and Skip to close).
async function checkTour(browser, name, viewport) {
  const fail = (msg) => errors.push(`tour ${name}: ${msg}`);
  const context = await browser.newContext({ viewport, colorScheme: "light" });
  const page = await context.newPage();
  page.on("pageerror", (e) => fail(e.message));
  page.on("console", (m) => m.type() === "error" && fail(m.text()));
  const dialog = page.getByRole("dialog");
  const tourButton = page.getByRole("button", { name: "Product tour" });
  const settled = () => page.waitForFunction(() => document.querySelector(".tour-card")?.dataset.settled === "true", null, { timeout: 5000 });
  const holeAt = () => page.evaluate(() => document.querySelector(".tour-hole").getBoundingClientRect().toJSON());

  await page.goto(`http://localhost:${PORT}/`);
  await page.getByRole("heading", { level: 1, name: "Overview" }).waitFor();
  if (await dialog.count()) fail("the tour opened the moment the page appeared");
  await dialog.waitFor();
  if ((await page.evaluate(() => localStorage.getItem("tour"))) !== "seen") fail("the first visit was not remembered");
  const total = Number((await dialog.locator(".tour-count").textContent()).split(" of ")[1]);
  for (let i = 1; i <= total; i++) {
    await settled();
    const s = await page.evaluate(() => {
      const box = (r) => ({ top: r.top, left: r.left, bottom: r.bottom, right: r.right, height: r.height });
      const card = document.querySelector(".tour-card");
      const target = card.dataset.target;
      return {
        target,
        count: card.querySelector(".tour-count").textContent,
        el: box(document.querySelector(`[data-tour="${target}"]`).getBoundingClientRect()),
        hole: box(document.querySelector(".tour-hole").getBoundingClientRect()),
        card: box(card.getBoundingClientRect()),
        corner: document.elementFromPoint(2, innerHeight - 2)?.className,
      };
    });
    const at = `step ${i} (${s.target})`;
    if (s.count !== `${i} of ${total}`) fail(`${at}: counter reads ${s.count}`);
    const { el, hole, card } = s;
    const around = hole.top <= el.top + 1 && hole.left <= el.left + 1 && hole.bottom >= el.bottom - 1 && hole.right >= el.right - 1;
    if (!around || el.top - hole.top > 10) fail(`${at}: outline ${JSON.stringify(hole)} is not around the section ${JSON.stringify(el)}`);
    if (el.height < viewport.height && (el.top < 0 || el.bottom > viewport.height)) fail(`${at}: section is not fully on screen`);
    if (card.top < 0 || card.left < 0 || card.bottom > viewport.height || card.right > viewport.width) fail(`${at}: card is off screen`);
    const roomy = el.height + card.height + 40 < viewport.height;
    if (roomy && card.top < el.bottom && card.bottom > el.top && card.left < el.right && card.right > el.left) fail(`${at}: card covers the section`);
    if (s.corner !== "tour-block") fail(`${at}: the page behind the tour is clickable (${s.corner})`);
    await page.screenshot({ path: `${OUT}/tour-${name}-${i}-${s.target}.png` });
    const from = await holeAt();
    await dialog.getByRole("button", { name: i === total ? "Done" : "Next" }).click();
    // Mid-move, the spotlight is between the two sections rather than at either.
    if (i === 2) {
      await page.waitForTimeout(200);
      const mid = await holeAt();
      await settled();
      const to = await holeAt();
      const off = (a, b) => Math.abs(a.top - b.top) + Math.abs(a.left - b.left) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
      if (off(mid, from) < 8 || off(mid, to) < 8) fail(`the spotlight jumped instead of moving (from ${off(mid, from)}px, to ${off(mid, to)}px)`);
    }
  }
  if (await dialog.count()) fail("Done did not close the tour");

  await page.reload();
  await page.getByRole("heading", { level: 1, name: "Overview" }).waitFor();
  await page.waitForTimeout(400);
  if (await dialog.count()) fail("the tour opened again on a return visit");

  await page.getByRole("tab", { name: "Live" }).click();
  await tourButton.click();
  await dialog.waitFor();
  if (!(await page.getByRole("heading", { level: 1, name: "Overview" }).count())) fail("replaying did not go to Overview");
  await page.keyboard.press("ArrowRight");
  if ((await dialog.locator(".tour-count").textContent()) !== `2 of ${total}`) fail("ArrowRight did not move to step 2");
  await page.keyboard.press("Escape");
  if (await dialog.count()) fail("Escape did not close the tour");
  if (!(await tourButton.evaluate((b) => b === document.activeElement))) fail("focus did not return to the tour button");

  // With reduced motion the spotlight jumps straight to the next section.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await tourButton.click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Next" }).click();
  await page.waitForTimeout(60);
  if ((await page.evaluate(() => document.querySelector(".tour-card").dataset.settled)) !== "true") fail("reduced motion still animates");
  await page.keyboard.press("Escape");

  // Every motion style lands on the section.
  for (const motion of ["stalk", "skitter", "instant"]) {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(`http://localhost:${PORT}/?tour=${motion}`);
    await tourButton.click();
    await dialog.getByRole("button", { name: "Next" }).click();
    await settled();
    const ok = await page.evaluate(() => {
      const el = document.querySelector('[data-tour="kpis"]').getBoundingClientRect();
      const h = document.querySelector(".tour-hole").getBoundingClientRect();
      return Math.abs(h.top + 6 - el.top) < 1.5 && Math.abs(h.width - 12 - el.width) < 1.5;
    });
    if (!ok) fail(`?tour=${motion} did not land on the section`);
    await page.keyboard.press("Escape");
  }

  await page.goto(`http://localhost:${PORT}/`);
  await page.emulateMedia({ colorScheme: "dark" });
  await tourButton.click();
  await dialog.waitFor();
  await settled();
  await page.screenshot({ path: `${OUT}/tour-${name}-dark.png` });
  await dialog.getByRole("button", { name: "Skip tour" }).click();
  if (await dialog.count()) fail("Skip did not close the tour");
  await context.close();
}

// The theme switch: a choice survives a reload with no light frame first, System follows
// the OS live, and colors drawn from CSS variables (charts, regime bands) repaint without a reload.
async function checkTheme(browser, name, viewport) {
  const fail = (msg) => errors.push(`theme ${name}: ${msg}`);
  const context = await browser.newContext({ viewport, colorScheme: "light" });
  await skipTour(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => fail(e.message));
  page.on("console", (m) => m.type() === "error" && fail(m.text()));
  // Runs before any page script, so this sees what the inline <head> script set.
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      window.__atDCL = {
        theme: document.documentElement.dataset.theme ?? null,
        body: getComputedStyle(document.body).backgroundColor,
      };
    });
  });
  const bg = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
  const band = () => page.evaluate(() => getComputedStyle(document.querySelector('rect[fill="var(--on)"]')).fill);
  const button = (label) => page.getByRole("button", { name: `${label} theme` });
  // Without the hover tooltip covering the page.
  const shoot = async (theme) => {
    await page.mouse.move(viewport.width - 1, viewport.height - 1);
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/theme-${name}-${theme}.png` });
  };
  const expectBg = async (want, when) => {
    const got = await bg();
    if (got !== want) fail(`${when}: --bg is ${got}, expected ${want}`);
  };

  await page.goto(`http://localhost:${PORT}/`);
  await page.getByRole("heading", { level: 1, name: "Overview" }).waitFor();
  if ((await button("System").getAttribute("aria-pressed")) !== "true") fail("System is not the default");
  await expectBg(LIGHT_BG, "default with a light OS");

  // Last item in the status bar: after the mode pill, at the right end, on screen.
  const place = await page.evaluate(() => {
    const sw = document.querySelector(".status .theme").getBoundingClientRect();
    const mode = [...document.querySelectorAll(".status .stat")].at(-1).getBoundingClientRect();
    const bar = document.querySelector(".status").getBoundingClientRect();
    const after = sw.left >= mode.right || sw.top >= mode.bottom;
    return { after, rightGap: bar.right - sw.right, left: sw.left, right: sw.right };
  });
  if (!place.after) fail("switch is not after the mode pill");
  if (place.rightGap > 20) fail(`switch is not at the right end of the status bar (${place.rightGap}px short)`);
  if (place.left < 0 || place.right > viewport.width) fail(`switch is off screen: ${JSON.stringify(place)}`);

  // Keyboard: Tab from Light to Dark shows a focus ring, Space picks it.
  await button("Light").focus();
  await page.keyboard.press("Tab");
  if (!(await button("Dark").evaluate((el) => el === document.activeElement))) fail("Tab did not reach Dark");
  const ring = await button("Dark").evaluate((el) => getComputedStyle(el).outlineStyle);
  if (ring === "none") fail("no visible focus ring on the switch");
  const lightBand = await band();
  await page.keyboard.press("Space");
  await expectBg(DARK_BG, "after choosing Dark");
  if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== "dark") fail("data-theme is not dark");
  if ((await band()) === lightBand) fail("regime band color did not change without a reload");
  await shoot("dark");

  await page.reload();
  await page.getByRole("heading", { level: 1, name: "Overview" }).waitFor();
  const atDCL = await page.evaluate(() => window.__atDCL);
  if (atDCL?.theme !== "dark") fail(`data-theme at DOMContentLoaded was ${atDCL?.theme}`);
  if (atDCL?.body !== "rgb(10, 14, 20)") fail(`body background at DOMContentLoaded was ${atDCL?.body}`);
  await expectBg(DARK_BG, "after reload with Dark chosen");
  if ((await button("Dark").getAttribute("aria-pressed")) !== "true") fail("Dark is not marked after reload");

  // Light wins over a dark OS.
  await button("Light").click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expectBg(LIGHT_BG, "Light chosen with a dark OS");
  await shoot("light");

  // System follows the emulated OS setting, live.
  await button("System").click();
  await expectBg(DARK_BG, "System with a dark OS");
  await page.emulateMedia({ colorScheme: "light" });
  await expectBg(LIGHT_BG, "System with a light OS");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectBg(DARK_BG, "System after the OS switched back to dark");
  if ((await page.evaluate(() => localStorage.getItem("theme"))) !== "system") fail("System was not saved");

  await context.close();
}

try {
  await waitForServer();
  const browser = await chromium.launch();
  for (const [name, viewport, scheme] of [
    ["desktop", { width: 1360, height: 900 }, "light"],
    ["dark", { width: 1360, height: 900 }, "dark"],
    ["phone", { width: 400, height: 860 }, "light"],
  ]) {
    const page = await browser.newPage({ viewport, colorScheme: scheme });
    await skipTour(page);
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
    await page.goto(`http://localhost:${PORT}/`);
    await page.getByRole("heading", { level: 1, name: "Overview" }).waitFor();
    for (const tab of TABS) {
      if (name !== "desktop" && !["Overview", "Decisions"].includes(tab)) continue;
      await page.getByRole("tab", { name: tab }).click();
      await page.getByRole("heading", { level: 1, name: tab }).waitFor();
      if (tab === "Decisions") {
        await page.getByRole("button", { name: "Replay" }).click();
        await page.getByRole("button", { name: "Jun 2022" }).click();
        await page.getByText("rule_1").first().waitFor();
      }
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${name}-${tab.toLowerCase()}.png`, fullPage: true });
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (overflow > 0) errors.push(`${name}: page scrolls sideways by ${overflow}px`);
    await page.close();
  }
  for (const [name, viewport] of [
    ["desktop", { width: 1360, height: 900 }],
    ["phone", { width: 400, height: 860 }],
  ]) {
    await checkTheme(browser, name, viewport);
    await checkSticky(browser, name, viewport);
    await checkTour(browser, name, viewport);
  }
  await browser.close();
} finally {
  stop();
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`ok: screenshots in ${OUT}`);
