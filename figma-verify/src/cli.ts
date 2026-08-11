#!/usr/bin/env node
/**
 * CLI runner for demos and debugging.
 *
 * Usage:
 *   figma-verify <figma_url> <live_url> [--viewport <px>] [--json]
 *   figma-verify --fixture <design-fixture.json> <live_url> [--json]
 *
 * The --fixture mode reads a recorded Figma nodes-API response from disk so
 * the demo works offline without a FIGMA_TOKEN.
 */
import { readFile } from "node:fs/promises";
import type { FigmaNodesResponse } from "./figma/client.js";
import { normalizeFigmaTree } from "./figma/normalize.js";
import { extractFromUrl } from "./web/extract.js";
import { runComparison, verifyImplementation } from "./verify.js";

function usage(): never {
  console.error(
    [
      "Usage:",
      "  figma-verify <figma_url> <live_url> [--viewport <px>] [--json]",
      "  figma-verify --fixture <design-fixture.json> <live_url> [--viewport <px>] [--json]",
      "",
      "Env: FIGMA_TOKEN required unless --fixture is used.",
    ].join("\n")
  );
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length < 2) usage();

const json = args.includes("--json");
const viewportIdx = args.indexOf("--viewport");
const viewportWidth = viewportIdx >= 0 ? parseInt(args[viewportIdx + 1] ?? "", 10) : undefined;
const positional = args.filter(
  (a, i) => !a.startsWith("--") && (viewportIdx < 0 || i !== viewportIdx + 1)
);

try {
  let output;

  if (args.includes("--fixture")) {
    const fixtureIdx = args.indexOf("--fixture");
    const fixturePath = args[fixtureIdx + 1];
    const liveUrl = positional.find((p) => p !== fixturePath);
    if (!fixturePath || !liveUrl) usage();

    const raw = JSON.parse(await readFile(fixturePath, "utf-8")) as FigmaNodesResponse;
    const firstEntry = Object.values(raw.nodes)[0];
    if (!firstEntry) throw new Error("Fixture has no nodes.");
    const rootNode = firstEntry.document;

    const design = normalizeFigmaTree(rootNode);
    const frame = design[0];
    if (!frame) throw new Error("Design fixture normalized to zero elements.");

    const width = viewportWidth ?? Math.round(frame.bounds.w);
    const dom = await extractFromUrl(liveUrl, width);
    output = runComparison(rootNode.name, design, dom, { viewportWidth: width, liveUrl });
  } else {
    const [figmaUrl, liveUrl] = positional;
    if (!figmaUrl || !liveUrl) usage();
    output = await verifyImplementation({ figmaUrl, liveUrl, viewportWidth });
  }

  if (json) {
    console.log(JSON.stringify(output.report, null, 2));
  } else {
    console.log(output.markdown);
  }

  process.exit(output.report.fidelityScore === 100 ? 0 : 1);
} catch (err) {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(2);
}
