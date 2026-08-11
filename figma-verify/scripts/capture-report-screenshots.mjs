#!/usr/bin/env node
/**
 * Dev tool: captures desktop/tablet/mobile screenshots of demo/report.html
 * (run `npm run demo:report` first) into /tmp, used to refresh the real
 * screenshots committed under docs/ for the README. Not wired to any npm
 * script since it's only needed when the report's UI changes.
 */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const reportPath = resolve(process.cwd(), "demo/report.html");
const url = pathToFileURL(reportPath).href;

const browser = await chromium.launch();

async function shot(name, width, height, actions) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url);
  await page.waitForTimeout(300);
  if (actions) await actions(page);
  await page.screenshot({ path: `/tmp/${name}.png` });
  await page.close();
}

await shot("desktop-default", 1440, 900);
await shot("desktop-selected", 1440, 900, async (page) => {
  const chip = page.locator(".fv-chip").nth(3);
  await chip.click({ force: true });
  await page.waitForTimeout(200);
});
await shot("desktop-overlay-mode", 1440, 900, async (page) => {
  await page.locator('#fv-mode button[data-mode="overlay"]').click();
  await page.waitForTimeout(200);
});
await shot("tablet-800", 800, 1024);
await shot("mobile-390", 390, 844);
await shot("mobile-390-fixes-tab", 390, 844, async (page) => {
  await page.locator("#fv-tab-fixes").click();
  await page.waitForTimeout(200);
});

await browser.close();
console.log("Screenshots written to /tmp/*.png");
