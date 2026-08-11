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

  const { elements: dom, screenshotBase64 } = await extractFromUrl(liveUrl, width, design[0]!.bounds.h);
  output = runComparison(root.name, design, dom, { viewportWidth: width, liveUrl, screenshotBase64 });
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

  it("computes all four scoring profiles", () => {
    const { scores } = output.report;
    expect(scores.balanced).toBe(output.report.fidelityScore); // default profile
    expect(scores.strict).toBeLessThanOrEqual(40); // criticals present -> capped
    expect(scores.perElement).toBeGreaterThan(0);
    // Cascade discount: most mediums are fallout from the padding flaw.
    expect(scores.rootCause).toBeGreaterThan(scores.balanced);
  });

  it("tags position drift caused by the card's padding flaw as cascades", () => {
    const title = output.report.elements.find((e) => e.designName === "Title")!;
    const xDiff = title.diffs.find((d) => d.property === "x")!;
    expect(xDiff.cascade).toBe(true);
    // The title's fontSize drift is a real flaw, not a cascade.
    expect(title.diffs.find((d) => d.property === "fontSize")!.cascade).toBeUndefined();
  });

  it("generates agent fix instructions covering every planted flaw", () => {
    const ins = output.report.fixInstructions;
    const all = JSON.stringify(ins);

    // Flaw 3: missing badge -> one create step with the full spec (child folded in).
    const create = ins.find((i) => i.kind === "create")!;
    expect(create.step).toBe(1);
    expect(create.summary).toContain('"Guarantee Badge"');
    expect(create.details.join("\n")).toContain("background-color: #ecfdf5");
    expect(create.details.join("\n")).toContain('"14-day money-back guarantee"');

    // Flaw 1 + 2: brand color and title font size as style steps.
    expect(all).toContain("background-color: #4f46e5");
    expect(all).toContain("font-size: 24px");

    // Flaw 4 + 5: padding shorthand and radius in the card's layout step.
    const layout = ins.find((i) => i.kind === "layout" && i.selector === "body > div.card")!;
    expect(layout.details).toContainEqual(expect.stringContaining("padding: 32px"));
    expect(layout.details).toContainEqual(expect.stringContaining("border-radius: 16px"));
    expect(layout.note).toMatch(/resolves 15 cascade/);

    // Cascade fallout on children must not become instructions; only the
    // card's own height drift (root-level, unattributable) may appear as a
    // final geometry step with the re-verify caveat.
    const geometry = ins.filter((i) => i.kind === "geometry");
    expect(geometry.every((g) => g.selector === "body > div.card")).toBe(true);
    for (const g of geometry) expect(g.note).toContain("Re-verify");
    expect(geometry.length).toBeLessThanOrEqual(1);
    expect(ins[ins.length - 1]!.kind === "geometry" || geometry.length === 0).toBe(true);

    // And the markdown report carries the section.
    expect(output.markdown).toContain("## Fix instructions (for the implementing agent)");
  });

  it("captures a screenshot and produces a self-contained HTML report", async () => {
    expect(output.screenshotBase64).toBeTruthy();
    const { renderHtmlReport } = await import("../src/report/render-html.js");
    const html = renderHtmlReport({
      report: output.report,
      design: output.designElements,
      screenshotBase64: output.screenshotBase64,
    });
    expect(html).toContain('id="fv-data"');
    expect(html).toContain("data:image/png;base64,");
    expect(/(src|href)=["']https?:/i.test(html)).toBe(false);
  });

  it("renders a markdown report with selector hints and severity labels", () => {
    expect(output.markdown).toContain("Fidelity score");
    expect(output.markdown).toContain("Missing elements");
    expect(output.markdown).toContain("HIGH");
    expect(output.markdown).toContain("div.button");
  });
});
