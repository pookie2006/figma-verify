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
    const signals = computeSimilaritySignals([], [], null);
    expect(signals).toEqual({
      structuralCoverage: null,
      colorOverlap: null,
      fontOverlap: null,
      textOverlap: null,
    });
  });

  it("passes structuralCoverage through unchanged (computed by the caller from match results)", () => {
    expect(computeSimilaritySignals([], [], 0.75).structuralCoverage).toBe(0.75);
    expect(computeSimilaritySignals([], [], 0).structuralCoverage).toBe(0);
  });

  it("is 0 (not null) when the design has data but the implementation has none", () => {
    const design = [el({ id: "d1", styles: { backgroundColor: "#4f46e5" } })];
    const signals = computeSimilaritySignals(design, [], null);
    expect(signals.colorOverlap).toBe(0);
  });

  it("finds color overlap within a loose distance, ignoring exact-hex differences", () => {
    const design = [
      el({ id: "d1", styles: { backgroundColor: "#4f46e5" } }),
      el({ id: "d2", styles: { backgroundColor: "#111111" } }),
    ];
    const dom = [el({ id: "w1", styles: { backgroundColor: "#5147e0" } })]; // close to #4f46e5, nowhere near #111111
    const signals = computeSimilaritySignals(design, dom, null);
    expect(signals.colorOverlap).toBeCloseTo(0.5, 5);
  });

  it("finds font-family overlap regardless of quoting/fallback stacks", () => {
    const design = [el({ id: "d1", styles: { fontFamily: "Inter" } })];
    const dom = [el({ id: "w1", styles: { fontFamily: '"Inter", sans-serif' } })];
    const signals = computeSimilaritySignals(design, dom, null);
    expect(signals.fontOverlap).toBe(1);
  });

  it("is null for fonts when the design specifies none", () => {
    const design = [el({ id: "d1" })];
    const dom = [el({ id: "w1", styles: { fontFamily: "Inter" } })];
    expect(computeSimilaritySignals(design, dom, null).fontOverlap).toBeNull();
  });

  it("scores partial word overlap between design and implementation copy", () => {
    const design = [el({ id: "d1", role: "text", text: "Create your free account today" })];
    const dom = [el({ id: "w1", role: "text", text: "Sign up for your free account" })];
    const signals = computeSimilaritySignals(design, dom, null);
    expect(signals.textOverlap).toBeGreaterThan(0.3);
    expect(signals.textOverlap).toBeLessThan(1);
  });

  it("gives full text credit for exact copy matches", () => {
    const design = [el({ id: "d1", role: "text", text: "Get started" })];
    const dom = [el({ id: "w1", role: "text", text: "Get started" })];
    expect(computeSimilaritySignals(design, dom, null).textOverlap).toBe(1);
  });

  it("is 0 when design and implementation text share no words", () => {
    const design = [el({ id: "d1", role: "text", text: "Guarantee Badge" })];
    const dom = [el({ id: "w1", role: "text", text: "Submit Form Now" })];
    expect(computeSimilaritySignals(design, dom, null).textOverlap).toBe(0);
  });
});

describe("similarityFloor", () => {
  it("is 0 when every signal is null (nothing to compare)", () => {
    expect(
      similarityFloor({ structuralCoverage: null, colorOverlap: null, fontOverlap: null, textOverlap: null })
    ).toBe(0);
  });

  it("is 0 when every present signal is 0", () => {
    expect(
      similarityFloor({ structuralCoverage: 0, colorOverlap: 0, fontOverlap: 0, textOverlap: 0 })
    ).toBe(0);
  });

  it("caps at SIMILARITY_FLOOR_CAP for perfect overlap on every axis", () => {
    expect(
      similarityFloor({ structuralCoverage: 1, colorOverlap: 1, fontOverlap: 1, textOverlap: 1 })
    ).toBe(SIMILARITY_FLOOR_CAP);
  });

  it("weighs structural coverage most heavily, then text overlap", () => {
    const coverageHeavy = similarityFloor({
      structuralCoverage: 1,
      colorOverlap: 0,
      fontOverlap: 0,
      textOverlap: 0,
    });
    const textHeavy = similarityFloor({
      structuralCoverage: 0,
      colorOverlap: 0,
      fontOverlap: 0,
      textOverlap: 1,
    });
    const colorHeavy = similarityFloor({
      structuralCoverage: 0,
      colorOverlap: 1,
      fontOverlap: 0,
      textOverlap: 0,
    });
    expect(coverageHeavy).toBeGreaterThan(textHeavy);
    expect(textHeavy).toBeGreaterThan(colorHeavy);
  });

  it("gives a meaningful floor when most elements structurally matched, even with weak color/font/text signal", () => {
    // This is the "mostly the same page, drawn differently" case: 70% of
    // elements found *some* DOM counterpart, but the palette/copy/fonts
    // barely overlap. That's still real, specific evidence of relatedness.
    const floor = similarityFloor({
      structuralCoverage: 0.7,
      colorOverlap: 0,
      fontOverlap: 0,
      textOverlap: 0,
    });
    expect(floor).toBeGreaterThan(10);
  });

  it("excludes null signals from the average instead of treating them as 0", () => {
    // Only text data exists and it's a perfect match -> full cap, not diluted by
    // coverage/color/font signals the run never provided data for.
    const floor = similarityFloor({
      structuralCoverage: null,
      colorOverlap: null,
      fontOverlap: null,
      textOverlap: 1,
    });
    expect(floor).toBe(SIMILARITY_FLOOR_CAP);
  });

  it("stays well below a passing score even with total overlap on every axis", () => {
    const floor = similarityFloor({
      structuralCoverage: 1,
      colorOverlap: 1,
      fontOverlap: 1,
      textOverlap: 1,
    });
    expect(floor).toBeLessThan(60);
  });
});
