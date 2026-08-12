import { mergeTolerances, type Tolerances } from "./config.js";
import { fetchFigmaNode, type FigmaNode, type FigmaNodesResponse } from "./figma/client.js";
import { normalizeFigmaTree } from "./figma/normalize.js";
import { parseFigmaUrl } from "./figma/url.js";
import { extractFromUrl } from "./web/extract.js";
import { matchElements } from "./match/matcher.js";
import { diffMatches } from "./diff/diff.js";
import { renderMarkdown } from "./report/render.js";
import type { DriftReport, NormalizedElement, ScoringProfile } from "./types.js";

export interface VerifyOptions {
  figmaUrl: string;
  liveUrl: string;
  viewportWidth?: number;
  tolerances?: Partial<Tolerances>;
  scoringProfile?: ScoringProfile;
}

export interface VerifyOutput {
  markdown: string;
  report: DriftReport;
  /** Full normalized design (including the root frame), for visual reports. */
  designElements: NormalizedElement[];
  /** PNG screenshot of the implementation, base64 (absent in fixture-only runs without a browser). */
  screenshotBase64?: string;
}

/**
 * Full pipeline: Figma spec + live DOM -> match -> diff -> report.
 */
export async function verifyImplementation(options: VerifyOptions): Promise<VerifyOutput> {
  const ref = parseFigmaUrl(options.figmaUrl);
  const rootNode = await fetchFigmaNode(ref);
  const design = normalizeFigmaTree(rootNode);

  const frame = design[0];
  if (!frame) throw new Error("Design frame normalized to zero elements.");

  const viewportWidth = options.viewportWidth ?? Math.round(frame.bounds.w);
  const { elements: dom, screenshotBase64 } = await extractFromUrl(
    options.liveUrl,
    viewportWidth,
    frame.bounds.h
  );

  return runComparison(rootNode.name, design, dom, {
    viewportWidth,
    figmaUrl: options.figmaUrl,
    liveUrl: options.liveUrl,
    tolerances: options.tolerances,
    scoringProfile: options.scoringProfile,
    screenshotBase64,
  });
}

/**
 * Offline / upload path: recorded Figma nodes-API JSON + a live URL
 * (http(s) or file://) that Playwright can open.
 */
export async function verifyFromFixture(options: {
  fixture: FigmaNodesResponse;
  liveUrl: string;
  viewportWidth?: number;
  tolerances?: Partial<Tolerances>;
  scoringProfile?: ScoringProfile;
}): Promise<VerifyOutput> {
  const firstEntry = Object.values(options.fixture.nodes)[0];
  if (!firstEntry?.document) throw new Error("Fixture has no nodes.");
  const rootNode = firstEntry.document;
  const design = normalizeFigmaTree(rootNode);
  const frame = design[0];
  if (!frame) throw new Error("Design fixture normalized to zero elements.");

  const viewportWidth = options.viewportWidth ?? Math.round(frame.bounds.w);
  const { elements: dom, screenshotBase64 } = await extractFromUrl(
    options.liveUrl,
    viewportWidth,
    frame.bounds.h
  );

  return runComparison(rootNode.name, design, dom, {
    viewportWidth,
    liveUrl: options.liveUrl,
    tolerances: options.tolerances,
    scoringProfile: options.scoringProfile,
    screenshotBase64,
  });
}

/**
 * Pure comparison stage, separated so tests and the CLI can run it against
 * fixtures without network or a browser.
 */
export function runComparison(
  frameName: string,
  design: NormalizedElement[],
  dom: NormalizedElement[],
  opts: {
    viewportWidth: number;
    figmaUrl?: string;
    liveUrl?: string;
    tolerances?: Partial<Tolerances>;
    scoringProfile?: ScoringProfile;
    screenshotBase64?: string;
  }
): VerifyOutput {
  const tolerances = mergeTolerances(opts.tolerances);
  // Skip the root frame itself (index 0) for matching noise; compare children.
  const matches = matchElements(design.slice(1), dom, tolerances.iouFloor);
  const report = diffMatches(design.slice(1), dom, matches, tolerances, {
    frameName,
    viewportWidth: opts.viewportWidth,
    figmaUrl: opts.figmaUrl,
    liveUrl: opts.liveUrl,
    scoringProfile: opts.scoringProfile,
  });
  return {
    markdown: renderMarkdown(report),
    report,
    designElements: design,
    screenshotBase64: opts.screenshotBase64,
  };
}

/**
 * Fetch and normalize just the design spec (no browser).
 */
export async function getDesignSpec(figmaUrl: string): Promise<{
  frameName: string;
  frameWidth: number;
  elements: NormalizedElement[];
}> {
  const ref = parseFigmaUrl(figmaUrl);
  const rootNode: FigmaNode = await fetchFigmaNode(ref);
  const elements = normalizeFigmaTree(rootNode);
  const frame = elements[0];
  if (!frame) throw new Error("Design frame normalized to zero elements.");
  return { frameName: rootNode.name, frameWidth: frame.bounds.w, elements };
}
