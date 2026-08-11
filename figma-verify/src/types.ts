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

export interface PropertyDiff {
  property: string;
  expected: string | number;
  actual: string | number | null;
  severity: Severity;
  /** Human-readable delta, e.g. "+6px" or "ΔE 41". */
  delta?: string;
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
}

export interface DriftReport {
  figmaUrl?: string;
  liveUrl?: string;
  frameName: string;
  viewportWidth: number;
  /** 0-100, weighted deductions per issue. */
  fidelityScore: number;
  totals: Record<Severity, number>;
  /** Design elements with no acceptable DOM counterpart. */
  missing: { designId: string; designName: string; role: Role }[];
  elements: ElementReport[];
  generatedAt: string;
}
