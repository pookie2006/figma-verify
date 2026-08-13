import type { ElementReport, PropertyDiff, ScoringProfile, Severity } from "../types.js";

/** Deduction per issue for the deduction-based profiles. */
export const SEVERITY_DEDUCTIONS: Record<Severity, number> = {
  critical: 15,
  high: 5,
  medium: 2,
  low: 0.5,
};

/** Weight applied to cascade diffs in the rootCause profile. */
export const CASCADE_DISCOUNT = 0.25;

/** Score ceilings applied by the strict profile when issues of a severity exist. */
export const STRICT_CAPS: Partial<Record<Severity, number>> = {
  critical: 40,
  high: 75,
};

export const DEFAULT_SCORING_PROFILE: ScoringProfile = "balanced";

export const SCORING_PROFILES: Record<ScoringProfile, { label: string; description: string }> = {
  balanced: {
    label: "Balanced",
    description:
      "100 minus flat weighted deductions (critical -15, high -5, medium -2, low -0.5). Default; comparable run-to-run.",
  },
  strict: {
    label: "Strict",
    description:
      "Balanced deductions, but any critical caps the score at 40 and any high at 75. Missing elements can never average out, and it's exempt from the resemblance floor other profiles get; good as a CI release gate.",
  },
  perElement: {
    label: "Per-element",
    description:
      "Each design element is scored 0-100 on its own diffs (missing = 0); the final score is the mean. Robust to page size.",
  },
  rootCause: {
    label: "Root cause",
    description:
      "Balanced deductions, but diffs caused by a parent's drift (cascades) count at 25% weight, so one bad padding value reads as one problem, not twenty.",
  },
};

function diffDeduction(diff: PropertyDiff, discountCascades: boolean): number {
  const base = SEVERITY_DEDUCTIONS[diff.severity];
  return discountCascades && diff.cascade ? base * CASCADE_DISCOUNT : base;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function deductionScore(elements: ElementReport[], discountCascades: boolean): number {
  let total = 0;
  for (const el of elements) {
    for (const diff of el.diffs) total += diffDeduction(diff, discountCascades);
  }
  return round1(Math.max(0, 100 - total));
}

/**
 * Compute the fidelity score under every profile.
 *
 * Missing design elements are represented in `elements` as unmatched reports
 * carrying a critical "existence" diff, so the deduction-based profiles pick
 * them up naturally; perElement scores them 0 outright.
 */
export function computeScores(elements: ElementReport[]): Record<ScoringProfile, number> {
  const balanced = deductionScore(elements, false);
  const rootCause = deductionScore(elements, true);

  let strict = balanced;
  const severities = new Set(elements.flatMap((e) => e.diffs.map((d) => d.severity)));
  for (const [severity, cap] of Object.entries(STRICT_CAPS) as [Severity, number][]) {
    if (severities.has(severity)) strict = Math.min(strict, cap);
  }

  let perElement = 100;
  if (elements.length > 0) {
    const sum = elements.reduce((acc, el) => {
      if (!el.matched) return acc; // missing element scores 0
      const deductions = el.diffs.reduce((s, d) => s + diffDeduction(d, false), 0);
      return acc + Math.max(0, 100 - deductions);
    }, 0);
    perElement = round1(sum / elements.length);
  }

  return { balanced, strict: round1(strict), perElement, rootCause };
}
