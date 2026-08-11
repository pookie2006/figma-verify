#!/usr/bin/env node
/**
 * Prints (and, on desktop OSes, opens) the file:// URL for a generated
 * report. Used by `npm run demo:open` so the one-command demo path always
 * ends with a clickable/openable link, regardless of platform.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const relPath = process.argv[2];
if (!relPath) {
  console.error("Usage: node scripts/open-report.mjs <path-to-report.html>");
  process.exit(2);
}

const absPath = resolve(process.cwd(), relPath);
const url = pathToFileURL(absPath).href;

console.log(`\nReport ready: ${url}\n`);

const opener =
  process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";

try {
  const child = spawn(opener, [url], { shell: process.platform === "win32", stdio: "ignore", detached: true });
  child.on("error", () => {
    // No GUI/browser available (e.g. a headless CI or cloud sandbox) — the
    // printed link above is the fallback, so this is not an error for us.
  });
  child.unref();
} catch {
  // Same fallback as above.
}
