/**
 * Parse a Figma share URL into a file key and node id.
 *
 * Supported shapes:
 *   https://www.figma.com/design/<key>/<name>?node-id=1-23
 *   https://www.figma.com/file/<key>/<name>?node-id=1%3A23
 *   https://www.figma.com/proto/<key>/<name>?node-id=1:23
 */

export interface FigmaRef {
  fileKey: string;
  /** Canonical Figma node id, colon-separated: "1:23". */
  nodeId: string;
}

export function parseFigmaUrl(url: string): FigmaRef {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }

  if (!/(^|\.)figma\.com$/.test(parsed.hostname)) {
    throw new Error(`Not a figma.com URL: ${url}`);
  }

  const match = parsed.pathname.match(/^\/(?:design|file|proto|board)\/([a-zA-Z0-9]+)(?:\/|$)/);
  if (!match || !match[1]) {
    throw new Error(
      `Could not find a file key in the URL path "${parsed.pathname}". Expected /design/<key>/... or /file/<key>/...`
    );
  }
  const fileKey = match[1];

  const rawNodeId = parsed.searchParams.get("node-id");
  if (!rawNodeId) {
    throw new Error(
      `URL has no node-id query parameter. In Figma, select the frame and use "Copy link to selection" so the URL includes ?node-id=...`
    );
  }

  // Figma URLs encode "1:23" as "1-23" (or percent-encoded "1%3A23").
  const nodeId = decodeURIComponent(rawNodeId).replace(/-/g, ":");
  if (!/^\d+:\d+$/.test(nodeId)) {
    throw new Error(`Unrecognized node-id format: "${rawNodeId}"`);
  }

  return { fileKey, nodeId };
}
