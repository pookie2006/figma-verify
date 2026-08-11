#!/usr/bin/env node
/**
 * CLI runner for demos and debugging.
 *
 * Usage:
 *   figma-verify <figma_url> <live_url> [options]
 *   figma-verify --fixture <design-fixture.json> <live_url> [options]
 *
 * Options:
 *   --viewport <px>       viewport width (default: Figma frame width)
 *   --scoring <profile>   balanced | strict | perElement | rootCause
 *   --html <path>         also write a self-contained visual HTML report
 *   --json                print the JSON report instead of markdown
 *   --instructions        print only the agent fix instructions
 *
 * The --fixture mode reads a recorded Figma nodes-API response from disk so
 * the demo works offline without a FIGMA_TOKEN.
 */
import { readFile, writeFile } from "node:fs/promises";
import type { FigmaNodesResponse } from "./figma/client.js";
import { normalizeFigmaTree } from "./figma/normalize.js";
import { extractFromUrl } from "./web/extract.js";
import { renderHtmlReport } from "./report/render-html.js";
import { renderInstructionsMarkdown } from "./report/instructions.js";
import { runComparison, verifyImplementation, type VerifyOutput } from "./verify.js";
import type { ScoringProfile } from "./types.js";

const SCORING_PROFILES: ScoringProfile[] = ["balanced", "strict", "perElement", "rootCause"];

function usage(): never {
  console.error(
    [
      "Usage:",
      "  figma-verify <figma_url> <live_url> [options]",
      "  figma-verify --fixture <design-fixture.json> <live_url> [options]",
      "",
      "Options:",
      "  --viewport <px>       viewport width (default: Figma frame width)",
      `  --scoring <profile>   ${SCORING_PROFILES.join(" | ")}`,
      "  --html <path>         also write a self-contained visual HTML report",
      "  --json                print the JSON report instead of markdown",
      "  --instructions        print only the agent fix instructions",
      "",
      "Env: FIGMA_TOKEN required unless --fixture is used.",
    ].join("\n")
  );
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length < 2) usage();

const VALUE_FLAGS = new Set(["--viewport", "--fixture", "--scoring", "--html"]);

function flagValue(name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const json = args.includes("--json");
const viewportRaw = flagValue("--viewport");
const viewportWidth = viewportRaw !== undefined ? parseInt(viewportRaw, 10) : undefined;
const htmlPath = flagValue("--html");
const scoringRaw = flagValue("--scoring");
if (scoringRaw !== undefined && !SCORING_PROFILES.includes(scoringRaw as ScoringProfile)) {
  console.error(`Unknown scoring profile "${scoringRaw}". Valid: ${SCORING_PROFILES.join(", ")}`);
  process.exit(2);
}
const scoringProfile = scoringRaw as ScoringProfile | undefined;

const positional = args.filter(
  (a, i) => !a.startsWith("--") && !(i > 0 && VALUE_FLAGS.has(args[i - 1]!))
);

try {
  let output: VerifyOutput;

  if (args.includes("--fixture")) {
    const fixturePath = flagValue("--fixture");
    const liveUrl = positional[0];
    if (!fixturePath || !liveUrl) usage();

    const raw = JSON.parse(await readFile(fixturePath, "utf-8")) as FigmaNodesResponse;
    const firstEntry = Object.values(raw.nodes)[0];
    if (!firstEntry) throw new Error("Fixture has no nodes.");
    const rootNode = firstEntry.document;

    const design = normalizeFigmaTree(rootNode);
    const frame = design[0];
    if (!frame) throw new Error("Design fixture normalized to zero elements.");

    const width = viewportWidth ?? Math.round(frame.bounds.w);
    const { elements: dom, screenshotBase64 } = await extractFromUrl(liveUrl, width, frame.bounds.h);
    output = runComparison(rootNode.name, design, dom, {
      viewportWidth: width,
      liveUrl,
      scoringProfile,
      screenshotBase64,
    });
  } else {
    const [figmaUrl, liveUrl] = positional;
    if (!figmaUrl || !liveUrl) usage();
    output = await verifyImplementation({ figmaUrl, liveUrl, viewportWidth, scoringProfile });
  }

  if (htmlPath) {
    const html = renderHtmlReport({
      report: output.report,
      design: output.designElements,
      screenshotBase64: output.screenshotBase64,
    });
    await writeFile(htmlPath, html, "utf-8");
    console.error(`HTML report written to ${htmlPath}`);
  }

  if (json) {
    console.log(JSON.stringify(output.report, null, 2));
  } else if (args.includes("--instructions")) {
    console.log(renderInstructionsMarkdown(output.report.fixInstructions));
  } else {
    console.log(output.markdown);
  }

  process.exit(output.report.fidelityScore === 100 ? 0 : 1);
} catch (err) {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(2);
}
