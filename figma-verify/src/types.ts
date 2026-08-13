/**
 * Shared types for the design-vs-implementation pipeline.
 *
 * Both extractors (Figma normalize, Playwright DOM extract) reduce their
 * source trees to NormalizedElement[], so matching and diffing are
 * source-agnostic.
 */

export type Role = "text" | "container" | "image";

export interface Bounds {
  /** X relative to the root frame, in CSS px. */
  x: number;
  /** Y relative to the root frame, in CSS px. */
  y: number;
  w: number;
  h: number;
}

export interface Styles {
  /** Hex color like "#1a2b3c" or undefined when transparent/unset. */
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  /** Line height in px. */
  lineHeight?: number;
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  /** Auto-layout item spacing / CSS flex-gap in px. */
  gap?: number;
  opacity?: number;
}

export interface NormalizedElement {
  /** Figma node id, or a CSS-selector-ish path for DOM elements. */
  id: string;
  role: Role;
  /** Figma layer name, or tagName#id.class for DOM elements. */
  name: string;
  /** Normalized text content (text roles only). */
  text?: string;
  bounds: Bounds;
  styles: Styles;
  /** Ids of direct children, preserving document/layer order. */
  childIds: string[];
  /** Id of the parent element, undefined for the root. */
  parentId?: string;
  /** CSS selector hint (DOM elements only) so agents can locate the node. */
  selector?: string;
}

export type Severity = "critical" | "high" | "medium" | "low";

/**
 * Scoring profiles:
 *  - balanced:   flat weighted deductions (default, comparable run-to-run)
 *  - strict:     same deductions, but criticals cap the score at 40 and highs at 75
 *  - perElement: each element scored 0-100 independently, final = mean
 *  - rootCause:  cascade diffs (caused by a parent's drift) weigh only 25%
 */
export type ScoringProfile = "balanced" | "strict" | "perElement" | "rootCause";

export interface PropertyDiff {
  property: string;
  expected: string | number;
  actual: string | number | null;
  severity: Severity;
  /** Human-readable delta, e.g. "+6px" or "ΔE 41". */
  delta?: string;
  /** True when this diff is a side effect of a parent element's drift. */
  cascade?: boolean;
}

export interface MatchResult {
  designId: string;
  domId?: string;
  /** CSS selector for the matched DOM element, when available. */
  selector?: string;
  /** How the pair was found. */
  method: "text" | "container" | "geometry" | "unmatched";
  /** Bounding-box IoU of the pair (0..1), when computed. */
  iou?: number;
}

export interface ElementReport {
  designId: string;
  designName: string;
  role: Role;
  matched: boolean;
  selector?: string;
  matchMethod: MatchResult["method"];
  diffs: PropertyDiff[];
  /** Frame-relative bounds of the design element (for report visualization). */
  designBounds: Bounds;
  /** Bounds of the matched DOM element, when matched. */
  domBounds?: Bounds;
}

/**
 * One imperative, agent-executable remediation step derived from the drift
 * report. Steps are ordered so that root causes come first and cascade
 * side effects are never turned into instructions.
 */
export interface FixInstruction {
  step: number;
  kind: "create" | "text" | "style" | "layout" | "geometry";
  /** CSS selector of the element to change (or of the parent for "create"). */
  selector?: string;
  designName: string;
  /** One-line imperative summary. */
  summary: string;
  /** CSS-like detail lines, e.g. "padding: 32px  (currently 24px)". */
  details: string[];
  /** Extra context, e.g. how many cascade diffs this fix also resolves. */
  note?: string;
}

export interface DriftReport {
  figmaUrl?: string;
  liveUrl?: string;
  frameName: string;
  viewportWidth: number;
  /** 0-100 under the selected scoring profile. */
  fidelityScore: number;
  /** Which profile produced fidelityScore. */
  scoringProfile: ScoringProfile;
  /** Score under every profile, for comparison. */
  scores: Record<ScoringProfile, number>;
  totals: Record<Severity, number>;
  /**
   * Page-level resemblance signals (shared colors/fonts/text) used as a
   * floor under every profile's score, so a totally different layout that
   * still shares real visual/copy DNA with the design doesn't score
   * identically to one that shares nothing at all. See diff/similarity.ts.
   */
  similarity: {
    /** Fraction of scored elements that found any DOM counterpart, however imperfectly styled. */
    structuralCoverage: number | null;
    colorOverlap: number | null;
    fontOverlap: number | null;
    textOverlap: number | null;
    /** The floor actually applied (0..SIMILARITY_FLOOR_CAP); not applied to the strict profile. */
    floor: number;
  };
  /** Design elements with no acceptable DOM counterpart. */
  missing: { designId: string; designName: string; role: Role }[];
  elements: ElementReport[];
  /** Ordered, agent-executable remediation steps (empty when clean). */
  fixInstructions: FixInstruction[];
  generatedAt: string;
}
