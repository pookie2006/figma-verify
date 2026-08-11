import { describe, expect, it } from "vitest";
import { diffPair, diffMatches, rgbDistance } from "../src/diff/diff.js";
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
});

describe("rgbDistance", () => {
  it("is 0 for identical colors", () => {
    expect(rgbDistance("#4f46e5", "#4f46e5")).toBe(0);
  });
  it("is ~441 for black vs white", () => {
    expect(rgbDistance("#000000", "#ffffff")).toBeCloseTo(441.67, 1);
  });
});
