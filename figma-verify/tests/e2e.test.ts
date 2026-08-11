/**
 * End-to-end: serve the deliberately flawed demo page locally, run the full
 * normalize -> extract -> match -> diff pipeline against the recorded design
 * fixture, and assert every planted flaw is caught.
 *
 * Needs Playwright's Chromium (npx playwright install chromium) but no
 * network or FIGMA_TOKEN.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { readFile, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { FigmaNodesResponse } from "../src/figma/client.js";
import { normalizeFigmaTree } from "../src/figma/normalize.js";
import { extractFromUrl } from "../src/web/extract.js";
import { runComparison, type VerifyOutput } from "../src/verify.js";

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = join(here, "../demo");

let server: Server;
let output: VerifyOutput;

beforeAll(async () => {
  server = createServer((req, res) => {
    const file = req.url === "/" || !req.url ? "index.html" : req.url.slice(1);
    readFile(join(demoDir, file), (err, data) => {
      if (err) {
        res.writeHead(404).end("not found");
      } else {
        res.writeHead(200, { "content-type": "text/html" }).end(data);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  const liveUrl = `http://localhost:${port}/`;

  const fixture = JSON.parse(
    readFileSync(join(demoDir, "design-fixture.json"), "utf-8")
  ) as FigmaNodesResponse;
  const root = fixture.nodes["1:2"]!.document;
  const design = normalizeFigmaTree(root);
  const width = Math.round(design[0]!.bounds.w);

  const dom = await extractFromUrl(liveUrl, width);
  output = runComparison(root.name, design, dom, { viewportWidth: width, liveUrl });
}, 60_000);

afterAll(() => {
  server?.close();
});

describe("e2e: flawed demo vs design fixture", () => {
  it("catches the wrong brand color on the button (high)", () => {
    const button = output.report.elements.find((e) => e.designName === "Primary Button")!;
    expect(button.matched).toBe(true);
    expect(button.diffs).toContainEqual(
      expect.objectContaining({
        property: "backgroundColor",
        expected: "#4f46e5",
        actual: "#7c3aed",
        severity: "high",
      })
    );
  });

  it("catches the wrong title font size (high)", () => {
    const title = output.report.elements.find((e) => e.designName === "Title")!;
    expect(title.diffs).toContainEqual(
      expect.objectContaining({ property: "fontSize", expected: 24, actual: 20, severity: "high" })
    );
  });

  it("reports the missing guarantee badge (critical)", () => {
    const missingNames = output.report.missing.map((m) => m.designName);
    expect(missingNames).toContain("Guarantee Badge");
    expect(output.report.totals.critical).toBeGreaterThanOrEqual(1);
  });

  it("catches the wrong card padding (medium)", () => {
    const card = output.report.elements.find((e) => e.designName === "Card")!;
    expect(card.matched).toBe(true);
    expect(card.diffs).toContainEqual(
      expect.objectContaining({ property: "paddingTop", expected: 32, actual: 24, severity: "medium" })
    );
  });

  it("catches the wrong card border radius (medium)", () => {
    const card = output.report.elements.find((e) => e.designName === "Card")!;
    expect(card.diffs).toContainEqual(
      expect.objectContaining({ property: "borderRadius", expected: 16, actual: 8, severity: "medium" })
    );
  });

  it("matches all text elements by text anchor with selector hints", () => {
    const title = output.report.elements.find((e) => e.designName === "Title")!;
    expect(title.matchMethod).toBe("text");
    expect(title.selector).toBeTruthy();
  });

  it("does not flag the elements that are actually correct", () => {
    const signin = output.report.elements.find((e) => e.designName === "Sign In Link")!;
    const highOrWorse = signin.diffs.filter((d) => d.severity === "critical" || d.severity === "high");
    expect(highOrWorse).toHaveLength(0);
  });

  it("scores well below 100 for the flawed page", () => {
    expect(output.report.fidelityScore).toBeLessThan(80);
  });

  it("renders a markdown report with selector hints and severity labels", () => {
    expect(output.markdown).toContain("Fidelity score");
    expect(output.markdown).toContain("Missing elements");
    expect(output.markdown).toContain("HIGH");
    expect(output.markdown).toContain("div.button");
  });
});
