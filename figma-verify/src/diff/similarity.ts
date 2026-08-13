import { rgbDistance } from "./diff.js";
import type { NormalizedElement } from "../types.js";

/**
 * A page-level resemblance signal, independent of per-element structural
 * matching. Without it, a design that structurally matches nothing (wrong
 * layout entirely) scores identically to a design that shares nothing at
 * all (wrong colors, wrong fonts, wrong copy) — both land at 0. That
 * understates real, if superficial, similarity: a page built from the same
 * brand palette and largely the same copy is not "as wrong as possible"
 * just because its layout doesn't line up with the design tree.
 *
 * Each signal is null when the design itself has no data on that axis
 * (e.g. no text at all), so it can be excluded from the blend rather than
 * counted as a mismatch.
 */
export interface SimilaritySignals {
  /**
   * Fraction of design elements that found ANY DOM counterpart, via any
   * matching method, regardless of how much that counterpart's styling
   * drifted. This is the strongest evidence that "the same page exists,
   * just imperfectly built" rather than "an unrelated page": a design with
   * dozens of elements where most of them lined up with *something* in the
   * DOM is clearly related, even if every one of those matches also has
   * color/spacing/typography diffs piling up elsewhere in the score.
   */
  structuralCoverage: number | null;
  /** Fraction of distinct design colors that appear (within a loose distance) somewhere in the implementation. */
  colorOverlap: number | null;
  /** Fraction of distinct design font families that appear anywhere in the implementation. */
  fontOverlap: number | null;
  /** Average best-match word-overlap between each piece of design copy and the closest implementation copy. */
  textOverlap: number | null;
}

/**
 * Looser than the strict per-property color tolerance used in diffPair —
 * this is a "same general color family" check for a global similarity
 * signal, not an exact-match check for scoring a specific element.
 */
const SIMILARITY_COLOR_DISTANCE = 60;

/**
 * Upper bound on how much this signal alone can lift a score. Deliberately
 * well short of a passing grade — a page that clearly shares real DOM
 * structure, colors, fonts, and copy with the design still isn't a
 * faithful implementation just because it's recognizably related, but it
 * also isn't "literally nothing in common," which a flat 0 implies.
 */
export const SIMILARITY_FLOOR_CAP = 55;

/**
 * Relative weight of each signal in the blend. Structural coverage is
 * weighted highest: an element actually being found (however imperfectly
 * styled) is stronger, more specific evidence of relatedness than a shared
 * color or font, which can occur between totally unrelated pages just from
 * common frameworks/system fonts. Shared copy is the next-strongest signal
 * since it's unlikely by chance; palette and font alone are the weakest.
 */
const SIGNAL_WEIGHTS: Record<keyof SimilaritySignals, number> = {
  structuralCoverage: 0.4,
  textOverlap: 0.35,
  colorOverlap: 0.15,
  fontOverlap: 0.1,
};

function collectColors(elements: NormalizedElement[]): string[] {
  const colors: string[] = [];
  for (const el of elements) {
    const { backgroundColor, textColor, borderColor } = el.styles;
    if (backgroundColor) colors.push(backgroundColor.toLowerCase());
    if (textColor) colors.push(textColor.toLowerCase());
    if (borderColor) colors.push(borderColor.toLowerCase());
  }
  return colors;
}

function primaryFontFamily(fontFamily: string): string {
  return (fontFamily.split(",")[0] ?? fontFamily).replace(/["']/g, "").trim().toLowerCase();
}

function collectFonts(elements: NormalizedElement[]): string[] {
  const fonts: string[] = [];
  for (const el of elements) {
    if (el.styles.fontFamily) fonts.push(primaryFontFamily(el.styles.fontFamily));
  }
  return fonts;
}

function collectTexts(elements: NormalizedElement[]): string[] {
  return elements
    .filter((el): el is NormalizedElement & { text: string } => el.role === "text" && !!el.text?.trim())
    .map((el) => el.text.trim());
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const tok of a) if (b.has(tok)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function colorOverlapRatio(design: NormalizedElement[], dom: NormalizedElement[]): number | null {
  const designColors = Array.from(new Set(collectColors(design)));
  if (!designColors.length) return null;
  const domColors = Array.from(new Set(collectColors(dom)));
  if (!domColors.length) return 0;
  const matched = designColors.filter((dc) =>
    domColors.some((wc) => rgbDistance(dc, wc) <= SIMILARITY_COLOR_DISTANCE)
  ).length;
  return matched / designColors.length;
}

function fontOverlapRatio(design: NormalizedElement[], dom: NormalizedElement[]): number | null {
  const designFonts = new Set(collectFonts(design));
  if (!designFonts.size) return null;
  const domFonts = new Set(collectFonts(dom));
  if (!domFonts.size) return 0;
  const matched = Array.from(designFonts).filter((f) => domFonts.has(f)).length;
  return matched / designFonts.size;
}

function textOverlapRatio(design: NormalizedElement[], dom: NormalizedElement[]): number | null {
  const designTexts = collectTexts(design);
  if (!designTexts.length) return null;
  const domTexts = collectTexts(dom);
  if (!domTexts.length) return 0;
  const domTokenSets = domTexts.map(tokenize);
  const total = designTexts.reduce((sum, text) => {
    const dTokens = tokenize(text);
    const best = domTokenSets.reduce((max, wTokens) => Math.max(max, jaccard(dTokens, wTokens)), 0);
    return sum + best;
  }, 0);
  return total / designTexts.length;
}

/**
 * Compute the resemblance signals between a full design tree and a full
 * DOM tree. `structuralCoverage` comes from the matcher/diff stage (the
 * fraction of scored design elements that found any DOM counterpart) since
 * this module has no visibility into matching on its own; pass `null` when
 * there are no scored elements at all.
 */
export function computeSimilaritySignals(
  design: NormalizedElement[],
  dom: NormalizedElement[],
  structuralCoverage: number | null
): SimilaritySignals {
  return {
    structuralCoverage,
    colorOverlap: colorOverlapRatio(design, dom),
    fontOverlap: fontOverlapRatio(design, dom),
    textOverlap: textOverlapRatio(design, dom),
  };
}

/**
 * Blend the signals into a single 0..SIMILARITY_FLOOR_CAP score, used as a
 * floor under every scoring profile (`Math.max(profileScore, floor)`).
 * Signals with no underlying design data (null) are excluded from the
 * weighted average rather than counted as 0.
 */
export function similarityFloor(signals: SimilaritySignals): number {
  const present = (Object.keys(SIGNAL_WEIGHTS) as (keyof SimilaritySignals)[]).filter(
    (key) => signals[key] !== null
  );
  if (!present.length) return 0;
  const totalWeight = present.reduce((sum, key) => sum + SIGNAL_WEIGHTS[key], 0);
  const blended =
    present.reduce((sum, key) => sum + (signals[key] as number) * SIGNAL_WEIGHTS[key], 0) / totalWeight;
  return Math.round(blended * SIMILARITY_FLOOR_CAP * 10) / 10;
}
