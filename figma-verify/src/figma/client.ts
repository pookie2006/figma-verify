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
 * How many times to retry a 429 before giving up. Figma's REST API rate
 * limit is a short sliding window (docs: figma.com/developers/api#rate-limits),
 * so a couple of short waits usually clear it — this is not meant to paper
 * over sustained abuse, just the "clicked Compare twice in a row" case.
 */
const MAX_RATE_LIMIT_RETRIES = 3;

/** Ceiling on any single backoff wait, so a bogus/huge Retry-After header can't hang the studio server. */
const MAX_BACKOFF_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The same design (fileKey + nodeId) is often fetched repeatedly in one
 * studio-server process — every "Compare" click re-fetches it even when
 * only the implementation changed. Caching for a short TTL turns an
 * iterate-on-code-then-Compare loop into a single Figma API call instead of
 * one per click, which is the single biggest lever against hitting the
 * rate limit in normal use. Keyed process-wide (module-level), so it
 * naturally covers the studio server's lifetime and is a no-op for the
 * one-shot CLI.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const nodeCache = new Map<string, { node: FigmaNode; fetchedAt: number }>();

/** Exposed for tests; also useful if a caller wants to force a fresh fetch after editing the Figma file. */
export function clearFigmaNodeCache(): void {
  nodeCache.clear();
}

/**
 * Build an actionable 429 message from Figma's own diagnostic headers
 * (docs: developers.figma.com/docs/rest-api/rate-limits) instead of just
 * echoing the status code. Two points worth calling out explicitly because
 * they're easy to get wrong:
 *  - Personal-access-token limits are tracked per *user* (whoever generated
 *    the token), not per token string — minting a second token from the
 *    same account draws from the same budget and won't help.
 *  - The limit also depends on the plan of the FILE being fetched, not just
 *    your own seat: a file living in a free "Starter" plan is capped as low
 *    as 6 requests/month for this endpoint, even from an Enterprise seat.
 */
function formatRateLimitError(res: Response): string {
  const retryAfter = res.headers.get("retry-after");
  const planTier = res.headers.get("x-figma-plan-tier");
  const limitType = res.headers.get("x-figma-rate-limit-type");
  const upgradeLink = res.headers.get("x-figma-upgrade-link");

  const lines = [
    `Figma API rate limit exceeded (429) after retrying ${MAX_RATE_LIMIT_RETRIES} times.`,
    planTier || limitType
      ? `Figma reports: plan tier "${planTier ?? "unknown"}", limit type "${limitType ?? "unknown"}".`
      : undefined,
    "A new personal access token won't help — Figma tracks personal-access-token limits per Figma *account* " +
      "(whoever generated the token), not per token string, so a second token draws from the same budget.",
    "This is also governed by the plan of the Figma FILE you're fetching, not just your own seat: files on a " +
      "free/Starter plan are capped as low as 6 requests/month for this endpoint regardless of your seat elsewhere.",
    `Wait ${retryAfter ? `about ${retryAfter}s` : "a minute or two (longer if the file is on a Starter plan)"} and try again — the design ` +
      `is now cached for ${Math.round(CACHE_TTL_MS / 60_000)} minutes per run, so re-comparing the same Figma link ` +
      "while you fix the implementation won't re-hit the API.",
    upgradeLink ? `Figma suggests: ${upgradeLink}` : undefined,
  ];
  return lines.filter(Boolean).join(" ");
}

async function fetchWithRateLimitRetry(url: string, authToken: string): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    const res = await fetch(url, { headers: { "X-Figma-Token": authToken } });
    if (res.status !== 429) return res;

    if (attempt === MAX_RATE_LIMIT_RETRIES) return res; // let the caller turn this into the final error

    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
    const backoffMs = Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? retryAfterMs : 2 ** attempt * 1000;
    await sleep(Math.min(backoffMs, MAX_BACKOFF_MS));
  }
  throw new Error("unreachable"); // loop always returns or throws above
}

/**
 * Fetch a single node (frame) subtree from the Figma REST API.
 */
export async function fetchFigmaNode(
  ref: FigmaRef,
  token?: string,
  opts?: { skipCache?: boolean }
): Promise<FigmaNode> {
  const cacheKey = `${ref.fileKey}:${ref.nodeId}`;
  if (!opts?.skipCache) {
    const cached = nodeCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.node;
  }

  const authToken = token ?? getFigmaToken();
  const url = `${FIGMA_API_BASE}/v1/files/${ref.fileKey}/nodes?ids=${encodeURIComponent(ref.nodeId)}&geometry=paths`;

  const res = await fetchWithRateLimitRetry(url, authToken);

  if (res.status === 429) {
    throw new Error(formatRateLimitError(res));
  }
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
  nodeCache.set(cacheKey, { node: entry.document, fetchedAt: Date.now() });
  return entry.document;
}

/**
 * Fetch the same node as `fetchFigmaNode`, but shaped as a full nodes-API
 * response (`{ name, nodes: { [nodeId]: { document } } }`) — i.e. exactly
 * the fixture format `verifyFromFixture` / `--fixture` expects. Lets a
 * caller save one successful fetch to disk and keep comparing against it
 * offline afterwards, which matters most for accounts on a rate-limit-
 * constrained plan (see formatRateLimitError above): each save spends at
 * most one of that budget, however many times it's reused locally.
 * Shares fetchFigmaNode's cache, so calling this right after a compare
 * that already fetched the same ref costs nothing extra.
 */
export async function fetchFigmaNodesResponse(
  ref: FigmaRef,
  token?: string,
  opts?: { skipCache?: boolean }
): Promise<FigmaNodesResponse> {
  const document = await fetchFigmaNode(ref, token, opts);
  return { name: document.name, nodes: { [ref.nodeId]: { document } } };
}
