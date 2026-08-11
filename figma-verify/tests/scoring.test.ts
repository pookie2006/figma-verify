import { describe, expect, it } from "vitest";
import { computeScores, CASCADE_DISCOUNT, SEVERITY_DEDUCTIONS } from "../src/diff/scoring.js";
import type { ElementReport, PropertyDiff, Severity } from "../src/types.js";

function el(
  overrides: Partial<ElementReport> & { designId: string; diffs?: PropertyDiff[] }
): ElementReport {
  return {
    designName: overrides.designId,
    role: "container",
    matched: true,
    matchMethod: "text",
    designBounds: { x: 0, y: 0, w: 100, h: 100 },
    diffs: [],
    ...overrides,
  };
}

function diff(severity: Severity, cascade = false): PropertyDiff {
  return { property: "x", expected: 0, actual: 5, severity, cascade: cascade || undefined };
}

describe("computeScores: balanced", () => {
  it("is 100 with no diffs", () => {
    expect(computeScores([el({ designId: "a" })]).balanced).toBe(100);
  });

  it("applies flat weighted deductions", () => {
    const elements = [
      el({ designId: "a", diffs: [diff("critical"), diff("high")] }),
      el({ designId: "b", diffs: [diff("medium"), diff("low")] }),
    ];
    // 100 - 15 - 5 - 2 - 0.5 = 77.5
    expect(computeScores(elements).balanced).toBe(77.5);
  });

  it("floors at 0", () => {
    const elements = [el({ designId: "a", diffs: Array(10).fill(diff("critical")) })];
    expect(computeScores(elements).balanced).toBe(0);
  });
});

describe("computeScores: strict", () => {
  it("caps at 40 when any critical exists", () => {
    const elements = [el({ designId: "a", diffs: [diff("critical")] })];
    // balanced would be 85; strict caps to 40
    expect(computeScores(elements).strict).toBe(40);
  });

  it("caps at 75 when any high exists (no critical)", () => {
    const elements = [el({ designId: "a", diffs: [diff("high")] })];
    expect(computeScores(elements).strict).toBe(75);
  });

  it("equals balanced when already below the cap", () => {
    const diffs = Array(5).fill(diff("critical")); // balanced = 25
    const scores = computeScores([el({ designId: "a", diffs })]);
    expect(scores.balanced).toBe(25);
    expect(scores.strict).toBe(25);
  });

  it("does not cap for medium/low issues", () => {
    const elements = [el({ designId: "a", diffs: [diff("medium"), diff("low")] })];
    expect(computeScores(elements).strict).toBe(97.5);
  });
});

describe("computeScores: perElement", () => {
  it("averages per-element scores", () => {
    const elements = [
      el({ designId: "a", diffs: [diff("high"), diff("high")] }), // 90
      el({ designId: "b" }), // 100
    ];
    expect(computeScores(elements).perElement).toBe(95);
  });

  it("scores missing elements as 0", () => {
    const elements = [
      el({ designId: "a", matched: false, matchMethod: "unmatched", diffs: [diff("critical")] }),
      el({ designId: "b" }),
    ];
    // (0 + 100) / 2
    expect(computeScores(elements).perElement).toBe(50);
  });

  it("is robust to page size in a way balanced is not", () => {
    const oneBad = el({ designId: "bad", diffs: Array(8).fill(diff("medium")) }); // element score 84
    const many = [oneBad, ...Array.from({ length: 9 }, (_, i) => el({ designId: `ok${i}` }))];
    const scores = computeScores(many);
    expect(scores.balanced).toBe(84);
    expect(scores.perElement).toBe(98.4); // (84 + 9*100) / 10
  });

  it("is 100 for an empty element list", () => {
    expect(computeScores([]).perElement).toBe(100);
  });
});

describe("computeScores: rootCause", () => {
  it("discounts cascade diffs to 25% weight", () => {
    const elements = [
      el({ designId: "parent", diffs: [diff("medium")] }), // -2
      el({ designId: "child", diffs: [diff("medium", true), diff("medium", true)] }), // -0.5 each
    ];
    const scores = computeScores(elements);
    expect(scores.balanced).toBe(94); // 100 - 6
    expect(scores.rootCause).toBe(97); // 100 - 2 - 2*(2*0.25)
  });

  it("equals balanced when nothing cascades", () => {
    const elements = [el({ designId: "a", diffs: [diff("high"), diff("medium")] })];
    const scores = computeScores(elements);
    expect(scores.rootCause).toBe(scores.balanced);
  });
});

describe("scoring constants", () => {
  it("keeps the documented weights", () => {
    expect(SEVERITY_DEDUCTIONS).toEqual({ critical: 15, high: 5, medium: 2, low: 0.5 });
    expect(CASCADE_DISCOUNT).toBe(0.25);
  });
});
