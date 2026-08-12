import { describe, expect, it } from "vitest";
import {
  computeSimilaritySignals,
  similarityFloor,
  SIMILARITY_FLOOR_CAP,
} from "../src/diff/similarity.js";
import type { NormalizedElement } from "../src/types.js";

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

describe("computeSimilaritySignals", () => {
  it("is all-null against an empty design (nothing to check)", () => {
    const signals = computeSimilaritySignals([], []);
    expect(signals).toEqual({ colorOverlap: null, fontOverlap: null, textOverlap: null });
  });

  it("is 0 (not null) when the design has data but the implementation has none", () => {
    const design = [el({ id: "d1", styles: { backgroundColor: "#4f46e5" } })];
    const signals = computeSimilaritySignals(design, []);
    expect(signals.colorOverlap).toBe(0);
  });

  it("finds color overlap within a loose distance, ignoring exact-hex differences", () => {
    const design = [
      el({ id: "d1", styles: { backgroundColor: "#4f46e5" } }),
      el({ id: "d2", styles: { backgroundColor: "#111111" } }),
    ];
    const dom = [el({ id: "w1", styles: { backgroundColor: "#5147e0" } })]; // close to #4f46e5, nowhere near #111111
    const signals = computeSimilaritySignals(design, dom);
    expect(signals.colorOverlap).toBeCloseTo(0.5, 5);
  });

  it("finds font-family overlap regardless of quoting/fallback stacks", () => {
    const design = [el({ id: "d1", styles: { fontFamily: "Inter" } })];
    const dom = [el({ id: "w1", styles: { fontFamily: '"Inter", sans-serif' } })];
    const signals = computeSimilaritySignals(design, dom);
    expect(signals.fontOverlap).toBe(1);
  });

  it("is null for fonts when the design specifies none", () => {
    const design = [el({ id: "d1" })];
    const dom = [el({ id: "w1", styles: { fontFamily: "Inter" } })];
    expect(computeSimilaritySignals(design, dom).fontOverlap).toBeNull();
  });

  it("scores partial word overlap between design and implementation copy", () => {
    const design = [el({ id: "d1", role: "text", text: "Create your free account today" })];
    const dom = [el({ id: "w1", role: "text", text: "Sign up for your free account" })];
    const signals = computeSimilaritySignals(design, dom);
    expect(signals.textOverlap).toBeGreaterThan(0.3);
    expect(signals.textOverlap).toBeLessThan(1);
  });

  it("gives full text credit for exact copy matches", () => {
    const design = [el({ id: "d1", role: "text", text: "Get started" })];
    const dom = [el({ id: "w1", role: "text", text: "Get started" })];
    expect(computeSimilaritySignals(design, dom).textOverlap).toBe(1);
  });

  it("is 0 when design and implementation text share no words", () => {
    const design = [el({ id: "d1", role: "text", text: "Guarantee Badge" })];
    const dom = [el({ id: "w1", role: "text", text: "Submit Form Now" })];
    expect(computeSimilaritySignals(design, dom).textOverlap).toBe(0);
  });
});

describe("similarityFloor", () => {
  it("is 0 when every signal is null (nothing to compare)", () => {
    expect(similarityFloor({ colorOverlap: null, fontOverlap: null, textOverlap: null })).toBe(0);
  });

  it("is 0 when every present signal is 0", () => {
    expect(similarityFloor({ colorOverlap: 0, fontOverlap: 0, textOverlap: 0 })).toBe(0);
  });

  it("caps at SIMILARITY_FLOOR_CAP for perfect overlap on every axis", () => {
    expect(similarityFloor({ colorOverlap: 1, fontOverlap: 1, textOverlap: 1 })).toBe(SIMILARITY_FLOOR_CAP);
  });

  it("weighs text overlap most heavily", () => {
    const textHeavy = similarityFloor({ colorOverlap: 0, fontOverlap: 0, textOverlap: 1 });
    const colorHeavy = similarityFloor({ colorOverlap: 1, fontOverlap: 0, textOverlap: 0 });
    expect(textHeavy).toBeGreaterThan(colorHeavy);
  });

  it("excludes null signals from the average instead of treating them as 0", () => {
    // Only text data exists and it's a perfect match -> full cap, not diluted by
    // color/font signals the design never provided data for.
    const floor = similarityFloor({ colorOverlap: null, fontOverlap: null, textOverlap: 1 });
    expect(floor).toBe(SIMILARITY_FLOOR_CAP);
  });

  it("stays well below a passing score even with total overlap", () => {
    const floor = similarityFloor({ colorOverlap: 1, fontOverlap: 1, textOverlap: 1 });
    expect(floor).toBeLessThan(40);
  });
});
