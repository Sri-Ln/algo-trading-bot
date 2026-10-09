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

const DARK_BG = "#0a0e14";
const LIGHT_BG = "#f2f4f7";

// The status bar stays where it starts while the page scrolls under it, and the sticky
// side nav (desktop) stays below it however many rows the bar wraps to.
async function checkSticky(browser, name, viewport) {
  const fail = (msg) => errors.push(`sticky ${name}: ${msg}`);
  const page = await browser.newPage({ viewport });
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

// The theme switch: a choice survives a reload with no light frame first, System follows
// the OS live, and colors drawn from CSS variables (charts, regime bands) repaint without a reload.
async function checkTheme(browser, name, viewport) {
  const fail = (msg) => errors.push(`theme ${name}: ${msg}`);
  const context = await browser.newContext({ viewport, colorScheme: "light" });
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
