import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ScoringProfile } from "../types.js";

export type DesignSource =
  | { kind: "fixture"; fixture: import("../figma/client.js").FigmaNodesResponse }
  | { kind: "figmaUrl"; figmaUrl: string };

const VALID_SCORING: ScoringProfile[] = ["balanced", "strict", "perElement", "rootCause"];

export function coerceScoringProfile(value?: string | null): ScoringProfile | undefined {
  return VALID_SCORING.includes(value as ScoringProfile) ? (value as ScoringProfile) : undefined;
}

/**
 * Fetch a nodes-API fixture JSON from an http(s) URL. Used when the Figma
 * inserter is in Link mode but the pasted URL is a public fixture (the
 * recruiter demo on GitHub Pages) rather than a figma.com file.
 */
export async function fetchFixtureFromUrl(raw: string): Promise<import("../figma/client.js").FigmaNodesResponse> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme "${parsed.protocol}". Use http:// or https://.`);
  }
  let res: Response;
  try {
    res = await fetch(parsed.href, { headers: { accept: "application/json, text/plain, */*" } });
  } catch {
    throw new Error(`Could not fetch fixture JSON from ${parsed.href}`);
  }
  if (!res.ok) {
    throw new Error(`Fixture URL returned ${res.status}: ${parsed.href}`);
  }
  const text = await res.text();
  let fixture: import("../figma/client.js").FigmaNodesResponse;
  try {
    fixture = JSON.parse(text);
  } catch {
    throw new Error(`URL is not a Figma fixture JSON: ${parsed.href}`);
  }
  if (!fixture?.nodes || typeof fixture.nodes !== "object") {
    throw new Error(`URL is not a nodes-API fixture ({ "nodes": { ... } }): ${parsed.href}`);
  }
  return fixture;
}

/**
 * Decide the design source from the studio verify form: a pasted Figma URL
 * takes precedence (real API, needs FIGMA_TOKEN server-side); otherwise a
 * design-fixture JSON upload. Images are rejected — preview-only, no
 * structural data.
 */
export async function resolveDesignSource(form: {
  figmaUrl?: string | null;
  fixtureName?: string;
  fixtureType?: string;
  fixtureText?: () => Promise<string>;
}): Promise<DesignSource> {
  const trimmedUrl = form.figmaUrl?.trim();
  if (trimmedUrl) {
    if (/^https?:\/\/([a-z0-9-]+\.)*figma\.com\//i.test(trimmedUrl)) {
      return { kind: "figmaUrl", figmaUrl: trimmedUrl };
    }
    // Public fixture JSON URL (e.g. the GitHub Pages copy of
    // demo/design-fixture.json) — lets a recruiter paste two links
    // with no FIGMA_TOKEN and no file upload.
    if (/^https?:\/\//i.test(trimmedUrl)) {
      return { kind: "fixture", fixture: await fetchFixtureFromUrl(trimmedUrl) };
    }
    throw new Error(`Not a figma.com URL or a fixture JSON URL: ${trimmedUrl}`);
  }

  if (!form.fixtureName) {
    throw new Error(
      'Provide a design source: paste a Figma link, or upload a nodes-API fixture JSON.'
    );
  }
  const name = form.fixtureName.toLowerCase();
  if (name.endsWith(".fig")) {
    throw new Error(
      "Raw .fig files aren't supported. Paste a Figma link instead, or export a nodes-API fixture JSON (see demo/design-fixture.json)."
    );
  }
  if (form.fixtureType?.startsWith("image/") || /\.(png|jpe?g|webp|svg)$/i.test(name)) {
    throw new Error(
      "Images are preview-only. Paste a Figma link or upload a design fixture JSON for a real structural compare."
    );
  }
  if (!form.fixtureText) {
    throw new Error("Missing fixture contents.");
  }
  const text = await form.fixtureText();
  let fixture: import("../figma/client.js").FigmaNodesResponse;
  try {
    fixture = JSON.parse(text);
  } catch {
    throw new Error("Fixture is not valid JSON.");
  }
  if (!fixture?.nodes || typeof fixture.nodes !== "object") {
    throw new Error('Fixture must look like a Figma nodes-API response ({ "nodes": { ... } }).');
  }
  return { kind: "fixture", fixture };
}

/** Drop a shared top-level folder from webkitdirectory paths (demo/index.html → index.html). */
export function stripSharedRoot(paths: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!paths.length) return map;
  const split = paths.map((p) => p.replace(/\\/g, "/").split("/").filter(Boolean));
  const first = split[0]!;
  let shared = 0;
  if (first.length > 1 && split.every((p) => p[0] === first[0])) shared = 1;
  for (let i = 0; i < paths.length; i++) {
    const parts = split[i]!.slice(shared);
    if (!parts.length) continue;
    map.set(paths[i]!, parts.join("/"));
  }
  return map;
}

/**
 * Directories/files that should never be uploaded to the studio: they're
 * either huge (node_modules can be hundreds of MB–GBs and would crash the
 * server buffering the request into memory), VCS internals, or noise.
 */
const EXCLUDED_SEGMENT_RE =
  /^(node_modules|\.git|\.hg|\.svn|\.next\/cache|\.turbo|\.cache|\.parcel-cache|coverage|\.nyc_output)$/i;

export function isExcludedUploadPath(relPath: string): boolean {
  const segments = relPath.replace(/\\/g, "/").split("/");
  if (segments.some((seg) => EXCLUDED_SEGMENT_RE.test(seg))) return true;
  const base = segments[segments.length - 1] ?? "";
  if (base === ".DS_Store" || base === "Thumbs.db") return true;
  return false;
}

/** Hard cap on total upload size — well below what would risk OOM-crashing the studio server. */
export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024; // 80 MB
/** Hard cap on file count — a real static build rarely needs more than this. */
export const MAX_UPLOAD_FILES = 4000;

/**
 * Validate a pasted live URL (e.g. a running dev server) as an alternative
 * to uploading a code folder. Loopback hosts (localhost/127.0.0.1) are
 * allowed since the studio and the dev server typically run on the same
 * machine; file:// is allowed for a single local HTML file.
 */
export function validateLiveUrl(raw: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Not a valid URL: ${trimmed}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "file:") {
    throw new Error(`Unsupported URL scheme "${parsed.protocol}". Use http://, https://, or file://.`);
  }
  return trimmed;
}

export function exceedsUploadLimits(totalBytes: number, fileCount: number): string | null {
  if (fileCount > MAX_UPLOAD_FILES) {
    return `Too many files (${fileCount}, limit ${MAX_UPLOAD_FILES}). Upload your built/static output (e.g. \`npm run build\` → \`build/\` or \`dist/\`), not raw source with node_modules.`;
  }
  if (totalBytes > MAX_UPLOAD_BYTES) {
    const mb = (totalBytes / (1024 * 1024)).toFixed(1);
    const limitMb = (MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0);
    return `Upload too large (${mb}MB, limit ${limitMb}MB). Upload your built/static output, not the whole project (node_modules/.git are excluded automatically, but the rest may still be too big).`;
  }
  return null;
}

export function safeRelPath(raw: string): string | null {
  const cleaned = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) return null;
  const parts: string[] = [];
  for (const part of cleaned.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (!parts.length) return null;
  return parts.join("/");
}

export function pickEntry(relPaths: string[], preferred?: string | null): string {
  const norm = preferred?.replace(/\\/g, "/").replace(/^\/+/, "") || "";
  if (norm && relPaths.includes(norm)) return norm;
  const index = relPaths.find((p) => /(^|\/)index\.html$/i.test(p));
  if (index) return index;
  const html = relPaths.find((p) => p.toLowerCase().endsWith(".html"));
  if (html) return html;
  throw new Error("Code folder needs an HTML entry (index.html or another .html file).");
}

export async function writeUploadTree(
  workDir: string,
  files: Array<{ relPath: string; data: Buffer }>
): Promise<string[]> {
  const relPaths: string[] = [];
  for (const file of files) {
    const abs = join(workDir, file.relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.data);
    relPaths.push(file.relPath);
  }
  return relPaths;
}
