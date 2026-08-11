import { getFigmaToken } from "../config.js";
import type { FigmaRef } from "./url.js";

/**
 * Minimal typing of the Figma REST node tree — only the properties the
 * normalizer reads. See https://www.figma.com/developers/api#node-types
 */
export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaPaint {
  type: string; // SOLID | IMAGE | GRADIENT_LINEAR | ...
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
}

export interface FigmaTypeStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  children?: FigmaNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  characters?: string;
  style?: FigmaTypeStyle;
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
}

export interface FigmaNodesResponse {
  name: string;
  nodes: Record<string, { document: FigmaNode } | null>;
}

const FIGMA_API_BASE = "https://api.figma.com";

/**
 * Fetch a single node (frame) subtree from the Figma REST API.
 */
export async function fetchFigmaNode(ref: FigmaRef, token?: string): Promise<FigmaNode> {
  const authToken = token ?? getFigmaToken();
  const url = `${FIGMA_API_BASE}/v1/files/${ref.fileKey}/nodes?ids=${encodeURIComponent(ref.nodeId)}&geometry=paths`;

  const res = await fetch(url, {
    headers: { "X-Figma-Token": authToken },
  });

  if (res.status === 403) {
    throw new Error("Figma API returned 403. Check that FIGMA_TOKEN is valid and has access to this file.");
  }
  if (res.status === 404) {
    throw new Error(`Figma file or node not found (404) for file ${ref.fileKey}, node ${ref.nodeId}.`);
  }
  if (!res.ok) {
    throw new Error(`Figma API error ${res.status}: ${await res.text()}`);
  }

  const body = (await res.json()) as FigmaNodesResponse;
  const entry = body.nodes[ref.nodeId];
  if (!entry) {
    throw new Error(
      `Node ${ref.nodeId} was not present in the API response. Make sure the URL's node-id points at a frame in this file.`
    );
  }
  return entry.document;
}
