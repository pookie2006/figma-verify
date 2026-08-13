import { describe, expect, it } from "vitest";
import { diffPair, diffMatches, rgbDistance } from "../src/diff/diff.js";
import { SIMILARITY_FLOOR_CAP } from "../src/diff/similarity.js";
import { DEFAULT_TOLERANCES } from "../src/config.js";
import type { MatchResult, NormalizedElement } from "../src/types.js";

function el(partial: Partial<NormalizedElement> & { id: string }): NormalizedElement {
  return {
    role: "container",
    name: partial.id,
    bounds: { x: 0, y: 0, w: 100, h: 100 },
    styles: {},
    childIds: [],
    ...partial,
  };
}

const tol = DEFAULT_TOLERANCES;

describe("diffPair", () => {
  it("returns no diffs for identical elements", () => {
    const a = el({ id: "a", styles: { backgroundColor: "#4f46e5", borderRadius: 8 } });
    const b = el({ id: "b", styles: { backgroundColor: "#4f46e5", borderRadius: 8 } });
    expect(diffPair(a, b, tol)).toHaveLength(0);
  });

  it("flags wrong text as critical", () => {
    const a = el({ id: "a", role: "text", text: "get started" });
    const b = el({ id: "b", role: "text", text: "get startd" });
    const diffs = diffPair(a, b, tol);
    expect(diffs).toContainEqual(
      expect.objectContaining({ property: "text", severity: "critical", actual: "get startd" })
    );
  });

  it("flags color drift beyond the RGB threshold as high", () => {
    const a = el({ id: "a", styles: { backgroundColor: "#4f46e5" } });
    const b = el({ id: "b", styles: { backgroundColor: "#7c3aed" } });
    const diffs = diffPair(a, b, tol);
    expect(diffs[0]).toMatchObject({ property: "backgroundColor", severity: "high" });
  });

  it("accepts near-identical colors within the threshold", () => {
    const a = el({ id: "a", styles: { backgroundColor: "#4f46e5" } });
    const b = el({ id: "b", styles: { backgroundColor: "#4f47e6" } });
    expect(diffPair(a, b, tol)).toHaveLength(0);
  });

  it("flags fontSize drift beyond 2x tolerance as high", () => {
    const a = el({ id: "a", role: "text", text: "t", styles: { fontSize: 24 } });
    const b = el({ id: "b", role: "text", text: "t", styles: { fontSize: 20 } });
    const diffs = diffPair(a, b, tol);
    expect(diffs[0]).toMatchObject({ property: "fontSize", severity: "high", delta: "-4px" });
  });

  it("downgrades small overshoots (within 2x tolerance) to low", () => {
    // position tolerance 2, delta 3 -> within 2x -> low
    const a = el({ id: "a", bounds: { x: 0, y: 0, w: 100, h: 100 } });
    const b = el({ id: "b", bounds: { x: 3, y: 0, w: 100, h: 100 } });
    const diffs = diffPair(a, b, tol);
    expect(diffs).toEqual([expect.objectContaining({ property: "x", severity: "low" })]);
  });

  it("ignores deltas within tolerance", () => {
    const a = el({ id: "a", bounds: { x: 0, y: 0, w: 100, h: 100 } });
    const b = el({ id: "b", bounds: { x: 2, y: 1, w: 99, h: 101 } });
    expect(diffPair(a, b, tol)).toHaveLength(0);
  });

  it("flags padding drift beyond 2x tolerance as medium", () => {
    const a = el({ id: "a", styles: { paddingTop: 32 } });
    const b = el({ id: "b", styles: { paddingTop: 24 } });
    const diffs = diffPair(a, b, tol);
    expect(diffs[0]).toMatchObject({ property: "paddingTop", severity: "medium", delta: "-8px" });
  });

  it("flags fontWeight mismatch exactly (no tolerance)", () => {
    const a = el({ id: "a", role: "text", text: "t", styles: { fontWeight: 700 } });
    const b = el({ id: "b", role: "text", text: "t", styles: { fontWeight: 600 } });
    const diffs = diffPair(a, b, tol);
    expect(diffs[0]).toMatchObject({ property: "fontWeight", severity: "high" });
  });
});

describe("diffMatches", () => {
  it("scores missing elements as critical and deducts 15 points", () => {
    const design = [el({ id: "d1", name: "Badge" })];
    const matches: MatchResult[] = [{ designId: "d1", method: "unmatched" }];
    const report = diffMatches(design, [], matches, tol, { frameName: "F", viewportWidth: 800 });
    expect(report.missing).toHaveLength(1);
    expect(report.totals.critical).toBe(1);
    expect(report.fidelityScore).toBe(85);
  });

  it("returns 100 for a clean match", () => {
    const design = [el({ id: "d1", role: "text", text: "hi", styles: { fontSize: 16 } })];
    const dom = [el({ id: "w1", role: "text", text: "hi", styles: { fontSize: 16 } })];
    const matches: MatchResult[] = [{ designId: "d1", domId: "w1", method: "text" }];
    const report = diffMatches(design, dom, matches, tol, { frameName: "F", viewportWidth: 800 });
    expect(report.fidelityScore).toBe(100);
    expect(report.elements[0]!.diffs).toHaveLength(0);
  });

  it("floors the score at 0", () => {
    const design = Array.from({ length: 10 }, (_, i) => el({ id: `d${i}`, name: `El ${i}` }));
    const matches: MatchResult[] = design.map((d) => ({ designId: d.id, method: "unmatched" as const }));
    const report = diffMatches(design, [], matches, tol, { frameName: "F", viewportWidth: 800 });
    expect(report.fidelityScore).toBe(0);
  });

  it("computes all four scoring profiles and honors the selected one", () => {
    const design = [el({ id: "d1", name: "Badge" })];
    const matches: MatchResult[] = [{ designId: "d1", method: "unmatched" }];
    const report = diffMatches(design, [], matches, tol, {
      frameName: "F",
      viewportWidth: 800,
      scoringProfile: "strict",
    });
    expect(report.scores.balanced).toBe(85);
    expect(report.scores.strict).toBe(40);
    expect(report.scoringProfile).toBe("strict");
    expect(report.fidelityScore).toBe(40);
  });

  it("tags child position diffs as cascades when the parent has a layout diff", () => {
    const parentDesign = el({
      id: "card",
      styles: { paddingTop: 32 },
      childIds: ["label"],
      bounds: { x: 0, y: 0, w: 200, h: 100 },
    });
    const childDesign = el({
      id: "label",
      role: "text",
      text: "hi",
      parentId: "card",
      bounds: { x: 32, y: 32, w: 100, h: 20 },
    });
    const parentDom = el({ id: "w-card", styles: { paddingTop: 24 }, bounds: { x: 0, y: 0, w: 200, h: 100 } });
    const childDom = el({ id: "w-label", role: "text", text: "hi", bounds: { x: 24, y: 24, w: 100, h: 20 } });

    const matches: MatchResult[] = [
      { designId: "card", domId: "w-card", method: "container" },
      { designId: "label", domId: "w-label", method: "text" },
    ];
    const report = diffMatches([parentDesign, childDesign], [parentDom, childDom], matches, tol, {
      frameName: "F",
      viewportWidth: 800,
    });

    const label = report.elements.find((e) => e.designId === "label")!;
    const xDiff = label.diffs.find((d) => d.property === "x")!;
    expect(xDiff.cascade).toBe(true);

    const card = report.elements.find((e) => e.designId === "card")!;
    expect(card.diffs.find((d) => d.property === "paddingTop")!.cascade).toBeUndefined();

    // Root-cause discounts the cascades, so it scores higher than balanced.
    expect(report.scores.rootCause).toBeGreaterThan(report.scores.balanced);
  });

  it("exposes design and dom bounds on element reports", () => {
    const design = [el({ id: "d1", bounds: { x: 1, y: 2, w: 30, h: 40 } })];
    const dom = [el({ id: "w1", bounds: { x: 1, y: 2, w: 30, h: 40 } })];
    const matches: MatchResult[] = [{ designId: "d1", domId: "w1", method: "geometry" }];
    const report = diffMatches(design, dom, matches, tol, { frameName: "F", viewportWidth: 800 });
    expect(report.elements[0]!.designBounds).toEqual({ x: 1, y: 2, w: 30, h: 40 });
    expect(report.elements[0]!.domBounds).toEqual({ x: 1, y: 2, w: 30, h: 40 });
  });
});

describe("diffMatches: similarity floor", () => {
  it("keeps the score at 0 when nothing structurally matches and nothing resembles the design", () => {
    const design = Array.from({ length: 10 }, (_, i) => el({ id: `d${i}`, name: `El ${i}` }));
    const matches: MatchResult[] = design.map((d) => ({ designId: d.id, method: "unmatched" as const }));
    const report = diffMatches(design, [], matches, tol, { frameName: "F", viewportWidth: 800 });
    expect(report.fidelityScore).toBe(0);
    expect(report.similarity.floor).toBe(0);
  });

  it("lifts a totally-mismatched score off the floor when the implementation shares real visual/copy DNA with the design", () => {
    // 8 unmatched elements saturates every deduction-based profile to 0
    // (8 x -15 = -120) — a "totally different layout" case.
    const design = [
      el({
        id: "d0",
        role: "text",
        text: "Create your free account",
        styles: { backgroundColor: "#4f46e5", fontFamily: "Inter" },
      }),
      ...Array.from({ length: 7 }, (_, i) => el({ id: `d${i + 1}`, name: `El ${i + 1}` })),
    ];
    // A DOM tree with a completely different layout (so nothing matches
    // structurally) but the same brand color, font, and near-identical copy.
    const dom = [
      el({
        id: "w0",
        role: "text",
        text: "Sign up for a free account",
        bounds: { x: 900, y: 900, w: 40, h: 10 },
        styles: { backgroundColor: "#4f46e5", fontFamily: "Inter, sans-serif" },
      }),
    ];
    const matches: MatchResult[] = design.map((d) => ({ designId: d.id, method: "unmatched" as const }));
    const report = diffMatches(design, dom, matches, tol, { frameName: "F", viewportWidth: 800 });

    // Every element is still "missing" from a structural standpoint...
    expect(report.missing).toHaveLength(8);
    // ...but the score is no longer a flat 0, because of the shared palette/font/copy.
    expect(report.similarity.floor).toBeGreaterThan(0);
    expect(report.similarity.floor).toBeLessThan(SIMILARITY_FLOOR_CAP);
    expect(report.fidelityScore).toBe(report.similarity.floor);
    expect(report.scores.perElement).toBe(report.similarity.floor);
    // Strict is deliberately exempt from the resemblance floor (it's meant
    // to be an uncompromising CI gate), so it stays at the raw, capped 0.
    expect(report.scores.strict).toBe(0);
  });

  it("gives a mostly-matched-but-heavily-drifted page a meaningful floor instead of 0", () => {
    // Simulates the real-world case that motivated this: a large page where
    // MOST elements found a DOM counterpart (so this is clearly "the same
    // page, badly styled"), but each matched pair also differs on several
    // properties and a few elements are outright missing — enough that the
    // flat deduction sum alone blows well past 100.
    const design = Array.from({ length: 10 }, (_, i) =>
      el({
        id: `d${i}`,
        name: `El ${i}`,
        role: i < 7 ? "text" : "container",
        text: i < 7 ? `Label ${i}` : undefined,
        styles: i < 7 ? { backgroundColor: "#4f46e5", fontFamily: "Inter" } : {},
      })
    );
    const dom = design.slice(0, 7).map((d, i) =>
      el({
        id: `w${i}`,
        name: d.name,
        role: "text",
        text: `Something else ${i}`,
        styles: { backgroundColor: "#000000", fontFamily: "Georgia" },
      })
    );
    const matches: MatchResult[] = design.map((d, i) =>
      i < 7
        ? { designId: d.id, domId: `w${i}`, method: "geometry" as const }
        : { designId: d.id, method: "unmatched" as const }
    );
    const report = diffMatches(design, dom, matches, tol, { frameName: "F", viewportWidth: 800 });

    expect(report.missing).toHaveLength(3);
    expect(report.similarity.structuralCoverage).toBeCloseTo(0.7, 5);
    // Structural coverage (mostly matched) is enough to lift the floor well
    // above 0 even though the palette/fonts/copy barely overlap.
    expect(report.similarity.floor).toBeGreaterThan(10);
    expect(report.fidelityScore).toBe(report.similarity.floor);
  });

  it("never lets the similarity floor override a genuinely good structural score", () => {
    const design = [el({ id: "d1", role: "text", text: "hi", styles: { fontFamily: "Inter" } })];
    const dom = [el({ id: "w1", role: "text", text: "hi", styles: { fontFamily: "Inter" } })];
    const matches: MatchResult[] = [{ designId: "d1", domId: "w1", method: "text" }];
    const report = diffMatches(design, dom, matches, tol, { frameName: "F", viewportWidth: 800 });
    expect(report.fidelityScore).toBe(100);
  });
});

describe("rgbDistance", () => {
  it("is 0 for identical colors", () => {
    expect(rgbDistance("#4f46e5", "#4f46e5")).toBe(0);
  });
  it("is ~441 for black vs white", () => {
    expect(rgbDistance("#000000", "#ffffff")).toBeCloseTo(441.67, 1);
  });
});
