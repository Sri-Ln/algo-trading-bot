// Opens the built console in a real browser, visits every tab at desktop and
// phone widths, fails on any page error, and saves screenshots.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 4173;
const OUT = "e2e/screenshots";
mkdirSync(OUT, { recursive: true });

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "inherit" });
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
  await browser.close();
} finally {
  stop();
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`ok: screenshots in ${OUT}`);
