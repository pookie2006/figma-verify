import type { Severity } from "./types.js";

export interface Tolerances {
  /** Position and size tolerance in px. */
  position: number;
  /** Spacing, padding, and gap tolerance in px. */
  spacing: number;
  /** Font size tolerance in px. */
  fontSize: number;
  /** Max Euclidean distance in RGB space (0-441) treated as equal. */
  colorDistance: number;
  /** Minimum IoU for a geometry-only match. */
  iouFloor: number;
}

export const DEFAULT_TOLERANCES: Tolerances = {
  position: 2,
  spacing: 1,
  fontSize: 0.5,
  colorDistance: 8,
  iouFloor: 0.4,
};

/** Weighted deduction per issue when computing the fidelity score. */
export const SEVERITY_DEDUCTIONS: Record<Severity, number> = {
  critical: 15,
  high: 5,
  medium: 2,
  low: 0.5,
};

export function getFigmaToken(): string {
  const token = process.env.FIGMA_TOKEN;
  if (!token) {
    throw new Error(
      "FIGMA_TOKEN environment variable is not set. Create a personal access token at figma.com/settings and export it as FIGMA_TOKEN."
    );
  }
  return token;
}

export function mergeTolerances(overrides?: Partial<Tolerances>): Tolerances {
  return { ...DEFAULT_TOLERANCES, ...(overrides ?? {}) };
}
