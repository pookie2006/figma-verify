import type { FigmaColor, FigmaNode, FigmaPaint } from "./client.js";
import type { Bounds, NormalizedElement, Role, Styles } from "../types.js";

/**
 * Flatten a Figma node subtree into NormalizedElement[] with coordinates
 * relative to the root frame's top-left corner.
 */
export function normalizeFigmaTree(root: FigmaNode): NormalizedElement[] {
  const rootBox = root.absoluteBoundingBox;
  if (!rootBox) {
    throw new Error(`Root node "${root.name}" has no bounding box; is it a frame?`);
  }

  const out: NormalizedElement[] = [];
  walk(root, undefined, { x: rootBox.x, y: rootBox.y }, out);
  return out;
}

function walk(
  node: FigmaNode,
  parentId: string | undefined,
  origin: { x: number; y: number },
  out: NormalizedElement[]
): void {
  if (!isVisible(node)) return;

  const box = node.absoluteBoundingBox;
  if (!box || box.width <= 0 || box.height <= 0) return;

  const bounds: Bounds = {
    x: round(box.x - origin.x),
    y: round(box.y - origin.y),
    w: round(box.width),
    h: round(box.height),
  };

  const element: NormalizedElement = {
    id: node.id,
    role: roleOf(node),
    name: node.name,
    bounds,
    styles: stylesOf(node),
    childIds: [],
    parentId,
  };

  if (node.type === "TEXT" && node.characters) {
    element.text = normalizeText(node.characters);
  }

  out.push(element);

  for (const child of node.children ?? []) {
    if (!isVisible(child)) continue;
    const childBox = child.absoluteBoundingBox;
    if (!childBox || childBox.width <= 0 || childBox.height <= 0) continue;
    element.childIds.push(child.id);
    walk(child, node.id, origin, out);
  }
}

function isVisible(node: FigmaNode): boolean {
  if (node.visible === false) return false;
  if (node.opacity !== undefined && node.opacity === 0) return false;
  return true;
}

function roleOf(node: FigmaNode): Role {
  if (node.type === "TEXT") return "text";
  const fills = node.fills ?? [];
  if (fills.some((f) => f.type === "IMAGE" && f.visible !== false)) return "image";
  return "container";
}

function stylesOf(node: FigmaNode): Styles {
  const styles: Styles = {};

  const solidFill = firstVisibleSolid(node.fills);
  if (solidFill?.color) {
    const hex = paintToHex(solidFill);
    if (node.type === "TEXT") {
      styles.textColor = hex;
    } else {
      styles.backgroundColor = hex;
    }
  }

  const solidStroke = firstVisibleSolid(node.strokes);
  if (solidStroke?.color && node.strokeWeight && node.strokeWeight > 0) {
    styles.borderColor = paintToHex(solidStroke);
    styles.borderWidth = round(node.strokeWeight);
  }

  if (node.cornerRadius !== undefined && node.cornerRadius > 0) {
    styles.borderRadius = round(node.cornerRadius);
  } else if (node.rectangleCornerRadii) {
    // v1: report the max radius when corners differ.
    const max = Math.max(...node.rectangleCornerRadii);
    if (max > 0) styles.borderRadius = round(max);
  }

  if (node.type === "TEXT" && node.style) {
    if (node.style.fontFamily) styles.fontFamily = node.style.fontFamily;
    if (node.style.fontSize !== undefined) styles.fontSize = round(node.style.fontSize, 2);
    if (node.style.fontWeight !== undefined) styles.fontWeight = node.style.fontWeight;
    if (node.style.lineHeightPx !== undefined) styles.lineHeight = round(node.style.lineHeightPx, 2);
  }

  if (node.layoutMode && node.layoutMode !== "NONE") {
    if (node.itemSpacing !== undefined) styles.gap = round(node.itemSpacing);
    styles.paddingTop = round(node.paddingTop ?? 0);
    styles.paddingRight = round(node.paddingRight ?? 0);
    styles.paddingBottom = round(node.paddingBottom ?? 0);
    styles.paddingLeft = round(node.paddingLeft ?? 0);
  }

  if (node.opacity !== undefined && node.opacity < 1) {
    styles.opacity = round(node.opacity, 3);
  }

  return styles;
}

function firstVisibleSolid(paints?: FigmaPaint[]): FigmaPaint | undefined {
  return (paints ?? []).find(
    (p) => p.type === "SOLID" && p.visible !== false && (p.opacity === undefined || p.opacity > 0)
  );
}

function paintToHex(paint: FigmaPaint): string {
  return colorToHex(paint.color as FigmaColor);
}

export function colorToHex(color: FigmaColor): string {
  const to255 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  const hex = (v: number) => to255(v).toString(16).padStart(2, "0");
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function round(value: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
