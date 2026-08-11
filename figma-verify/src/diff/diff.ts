import type { Tolerances } from "../config.js";
import { SEVERITY_DEDUCTIONS } from "../config.js";
import type {
  DriftReport,
  ElementReport,
  MatchResult,
  NormalizedElement,
  PropertyDiff,
  Severity,
} from "../types.js";

/**
 * Compare matched design/DOM pairs property by property and assemble the
 * drift report with severity-scored diffs and a 0-100 fidelity score.
 *
 * Severity policy (spec):
 *   critical = missing element or wrong text content
 *   high     = color, fontFamily, fontWeight, fontSize drift
 *   medium   = spacing / size / radius beyond tolerance
 *   low      = beyond tolerance but within 2x tolerance (noted, not failed)
 */
export function diffMatches(
  design: NormalizedElement[],
  dom: NormalizedElement[],
  matches: MatchResult[],
  tolerances: Tolerances,
  meta: { frameName: string; viewportWidth: number; figmaUrl?: string; liveUrl?: string }
): DriftReport {
  const domById = new Map(dom.map((e) => [e.id, e]));
  const designById = new Map(design.map((e) => [e.id, e]));

  const elements: ElementReport[] = [];
  const missing: DriftReport["missing"] = [];
  const totals: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };

  for (const match of matches) {
    const d = designById.get(match.designId);
    if (!d) continue;

    if (!match.domId) {
      missing.push({ designId: d.id, designName: d.name, role: d.role });
      totals.critical++;
      elements.push({
        designId: d.id,
        designName: d.name,
        role: d.role,
        matched: false,
        matchMethod: "unmatched",
        diffs: [
          {
            property: "existence",
            expected: `present (${d.role}${d.text ? `: "${d.text}"` : ""})`,
            actual: null,
            severity: "critical",
          },
        ],
      });
      continue;
    }

    const w = domById.get(match.domId)!;
    const diffs = diffPair(d, w, tolerances);
    for (const diff of diffs) totals[diff.severity]++;

    elements.push({
      designId: d.id,
      designName: d.name,
      role: d.role,
      matched: true,
      selector: match.selector ?? w.selector,
      matchMethod: match.method,
      diffs,
    });
  }

  let score = 100;
  for (const severity of Object.keys(totals) as Severity[]) {
    score -= totals[severity] * SEVERITY_DEDUCTIONS[severity];
  }

  return {
    figmaUrl: meta.figmaUrl,
    liveUrl: meta.liveUrl,
    frameName: meta.frameName,
    viewportWidth: meta.viewportWidth,
    fidelityScore: Math.max(0, Math.round(score * 10) / 10),
    totals,
    missing,
    elements,
    generatedAt: new Date().toISOString(),
  };
}

export function diffPair(
  design: NormalizedElement,
  dom: NormalizedElement,
  tol: Tolerances
): PropertyDiff[] {
  const diffs: PropertyDiff[] = [];
  const ds = design.styles;
  const ws = dom.styles;

  // Text content: critical when it differs.
  if (design.role === "text" && design.text) {
    if (!dom.text || dom.text !== design.text) {
      diffs.push({
        property: "text",
        expected: design.text,
        actual: dom.text ?? null,
        severity: "critical",
      });
    }
  }

  // High-severity typography/color properties.
  compareColor(diffs, "textColor", ds.textColor, ws.textColor, tol, "high");
  compareColor(diffs, "backgroundColor", ds.backgroundColor, ws.backgroundColor, tol, "high");
  compareColor(diffs, "borderColor", ds.borderColor, ws.borderColor, tol, "high");

  if (ds.fontFamily && ws.fontFamily && !sameFontFamily(ds.fontFamily, ws.fontFamily)) {
    diffs.push({ property: "fontFamily", expected: ds.fontFamily, actual: ws.fontFamily, severity: "high" });
  }
  if (ds.fontWeight !== undefined && ws.fontWeight !== undefined && ds.fontWeight !== ws.fontWeight) {
    diffs.push({ property: "fontWeight", expected: ds.fontWeight, actual: ws.fontWeight, severity: "high" });
  }
  compareNumeric(diffs, "fontSize", ds.fontSize, ws.fontSize, tol.fontSize, "high");

  // Medium-severity box metrics.
  compareNumeric(diffs, "width", design.bounds.w, dom.bounds.w, tol.position, "medium");
  compareNumeric(diffs, "height", design.bounds.h, dom.bounds.h, tol.position, "medium");
  compareNumeric(diffs, "x", design.bounds.x, dom.bounds.x, tol.position, "medium");
  compareNumeric(diffs, "y", design.bounds.y, dom.bounds.y, tol.position, "medium");
  compareNumeric(diffs, "borderRadius", ds.borderRadius, ws.borderRadius, tol.spacing, "medium");
  compareNumeric(diffs, "borderWidth", ds.borderWidth, ws.borderWidth, tol.spacing, "medium");
  compareNumeric(diffs, "paddingTop", ds.paddingTop, ws.paddingTop, tol.spacing, "medium");
  compareNumeric(diffs, "paddingRight", ds.paddingRight, ws.paddingRight, tol.spacing, "medium");
  compareNumeric(diffs, "paddingBottom", ds.paddingBottom, ws.paddingBottom, tol.spacing, "medium");
  compareNumeric(diffs, "paddingLeft", ds.paddingLeft, ws.paddingLeft, tol.spacing, "medium");
  compareNumeric(diffs, "gap", ds.gap, ws.gap, tol.spacing, "medium");

  return diffs;
}

/**
 * Numeric comparison with the "low = within 2x tolerance" downgrade rule.
 * A diff is emitted only when |delta| > tolerance; if it is within 2x the
 * tolerance it is reported as low (noted, not failed at base severity).
 */
function compareNumeric(
  diffs: PropertyDiff[],
  property: string,
  expected: number | undefined,
  actual: number | undefined,
  tolerance: number,
  baseSeverity: Severity
): void {
  if (expected === undefined) return;
  if (actual === undefined) {
    // Only meaningful when the design explicitly sets a non-zero value.
    if (expected !== 0) {
      diffs.push({ property, expected, actual: null, severity: baseSeverity });
    }
    return;
  }
  const delta = actual - expected;
  if (Math.abs(delta) <= tolerance) return;
  const severity: Severity = Math.abs(delta) <= tolerance * 2 ? "low" : baseSeverity;
  diffs.push({
    property,
    expected,
    actual,
    severity,
    delta: `${delta > 0 ? "+" : ""}${Math.round(delta * 10) / 10}px`,
  });
}

function compareColor(
  diffs: PropertyDiff[],
  property: string,
  expected: string | undefined,
  actual: string | undefined,
  tol: Tolerances,
  baseSeverity: Severity
): void {
  if (!expected) return;
  if (!actual) {
    diffs.push({ property, expected, actual: null, severity: baseSeverity });
    return;
  }
  const distance = rgbDistance(expected, actual);
  if (distance <= tol.colorDistance) return;
  diffs.push({
    property,
    expected,
    actual,
    severity: baseSeverity,
    delta: `ΔRGB ${Math.round(distance)}`,
  });
}

export function rgbDistance(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function sameFontFamily(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/["']/g, "").trim();
  return norm(a) === norm(b);
}
