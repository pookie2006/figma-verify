#!/usr/bin/env node
/**
 * Local studio companion: serves the interactive report and runs real
 * upload-driven compares (code folder + Figma fixture JSON → Playwright).
 *
 *   npm run studio
 *   open http://localhost:4174
 *
 * GitHub Pages cannot run Playwright; use this server for live compares.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { dirname, extname, join, normalize, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { fetchFigmaNodesResponse, type FigmaNodesResponse } from "../figma/client.js";
import { parseFigmaUrl } from "../figma/url.js";
import { renderHtmlReport } from "../report/render-html.js";
import { verifyFromFixture, verifyImplementation } from "../verify.js";
import {
  coerceScoringProfile,
  exceedsUploadLimits,
  isExcludedUploadPath,
  MAX_UPLOAD_BYTES,
  pickEntry,
  resolveDesignSource,
  safeRelPath,
  stripSharedRoot,
  validateLiveUrl,
  writeUploadTree,
  type DesignSource,
} from "./upload.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const demoDir = join(root, "demo");
const PORT = Number(process.env.PORT ?? 4174);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function serveDirOnEphemeralPort(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    try {
      const rawUrl = req.url ?? "/";
      const pathname = decodeURIComponent(new URL(rawUrl, "http://127.0.0.1").pathname);
      let rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      rel = normalize(rel).replace(/^(\.\.($|[\\/]))+/, "");
      const abs = join(dir, rel);
      if (!abs.startsWith(dir + sep) && abs !== dir) {
        res.writeHead(403).end("forbidden");
        return;
      }
      const stream = createReadStream(abs);
      stream.on("error", () => res.writeHead(404).end("not found"));
      const type = MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type });
      stream.pipe(res);
    } catch {
      res.writeHead(500).end("error");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/**
 * Read the request body with a hard cap so a huge upload (e.g. a whole
 * project including node_modules) can't OOM-crash the studio server before
 * multipart parsing even starts.
 */
async function readRequestBuffer(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      const mb = (maxBytes / (1024 * 1024)).toFixed(0);
      throw new Error(
        `Upload exceeds the ${mb}MB limit. Upload your built/static output (e.g. \`npm run build\`), not raw source with node_modules.`
      );
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

type CodeSource =
  | { kind: "liveUrl"; liveUrl: string }
  | { kind: "upload"; files: Array<{ relPath: string; data: Buffer }>; entry?: string };

async function parseVerifyForm(req: IncomingMessage): Promise<{
  design: DesignSource;
  code: CodeSource;
  scoring?: string;
}> {
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    const mb = (contentLength / (1024 * 1024)).toFixed(1);
    const limitMb = (MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0);
    throw new Error(
      `Upload too large (${mb}MB, limit ${limitMb}MB). Upload your built/static output (e.g. \`npm run build\` → \`build/\` or \`dist/\`), not the whole project.`
    );
  }
  const buf = await readRequestBuffer(req, MAX_UPLOAD_BYTES);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  const request = new Request("http://127.0.0.1/api/verify", {
    method: "POST",
    headers,
    body: new Uint8Array(buf),
  });
  const form = await request.formData();

  const figmaUrlField = form.get("figmaUrl");
  const fixtureField = form.get("fixture");
  const design = await resolveDesignSource({
    figmaUrl: typeof figmaUrlField === "string" ? figmaUrlField : undefined,
    fixtureName: fixtureField instanceof File ? fixtureField.name : undefined,
    fixtureType: fixtureField instanceof File ? fixtureField.type : undefined,
    fixtureText: fixtureField instanceof File ? () => fixtureField.text() : undefined,
  });

  const scoringField = form.get("scoring");
  const scoring = typeof scoringField === "string" ? scoringField : scoringField?.toString();

  const liveUrlField = form.get("liveUrl");
  if (typeof liveUrlField === "string" && liveUrlField.trim()) {
    const liveUrl = validateLiveUrl(liveUrlField);
    return { design, code: { kind: "liveUrl", liveUrl }, scoring };
  }

  const uploaded = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!uploaded.length) {
    throw new Error("Missing implementation — choose a code folder, or paste a live URL.");
  }

  const originalPaths = uploaded.map((f) => f.name || "unnamed");
  const pathMap = stripSharedRoot(originalPaths);
  const files: Array<{ relPath: string; data: Buffer }> = [];
  let totalBytes = 0;
  for (const file of uploaded) {
    const key = file.name || "unnamed";
    const rel = safeRelPath(pathMap.get(key) ?? key);
    if (!rel || isExcludedUploadPath(rel)) continue;
    totalBytes += file.size;
    files.push({ relPath: rel, data: Buffer.from(await file.arrayBuffer()) });
  }
  if (!files.length) throw new Error("No usable files in the uploaded folder.");
  const limitError = exceedsUploadLimits(totalBytes, files.length);
  if (limitError) throw new Error(limitError);

  const entryField = form.get("entry");
  return {
    design,
    code: { kind: "upload", files, entry: typeof entryField === "string" ? entryField : entryField?.toString() },
    scoring,
  };
}

async function handleVerify(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let workDir: string | undefined;
  let servedUpload: { url: string; close: () => Promise<void> } | undefined;
  try {
    const { design, code, scoring } = await parseVerifyForm(req);

    let liveUrl: string;
    let entryRel: string | undefined;
    if (code.kind === "liveUrl") {
      // Points directly at an already-running app (e.g. a dev server on
      // localhost) — no upload, no temp files, no ephemeral static server.
      liveUrl = code.liveUrl;
    } else {
      workDir = await mkdtemp(join(tmpdir(), "figma-verify-upload-"));
      const relPaths = await writeUploadTree(workDir, code.files);
      entryRel = pickEntry(relPaths, code.entry);
      if (entryRel !== "index.html") {
        const entryAbs = join(workDir, entryRel);
        const indexAbs = join(workDir, "index.html");
        if (!existsSync(indexAbs)) {
          await writeFile(indexAbs, await readFile(entryAbs));
        }
      }
      servedUpload = await serveDirOnEphemeralPort(workDir);
      liveUrl = servedUpload.url;
    }

    const profile = coerceScoringProfile(scoring);
    const output =
      design.kind === "figmaUrl"
        ? await verifyImplementation({
            figmaUrl: design.figmaUrl,
            liveUrl,
            scoringProfile: profile,
          })
        : await verifyFromFixture({
            fixture: design.fixture,
            liveUrl,
            scoringProfile: profile,
          });
    const html = renderHtmlReport({
      report: output.report,
      design: output.designElements,
      screenshotBase64: output.screenshotBase64,
    });
    sendJson(res, 200, {
      ok: true,
      html,
      report: output.report,
      design: output.designElements,
      screenshot: output.screenshotBase64 ?? null,
      liveUrl,
      entry: entryRel,
    });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: (err as Error).message });
  } finally {
    try {
      await servedUpload?.close();
    } catch {
      /* ignore */
    }
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Fetch a Figma URL's node tree shaped as a saveable nodes-API fixture
 * (`design-fixture.json`), so a rate-limit-constrained account can spend
 * one fetch and then compare against the saved file indefinitely instead
 * of re-hitting the Figma API on every Compare. Shares fetchFigmaNode's
 * cache, so calling this right after a compare with the same URL is free.
 */
async function handleFigmaFixture(res: ServerResponse, url: URL): Promise<void> {
  const figmaUrl = url.searchParams.get("url");
  if (!figmaUrl) {
    sendJson(res, 400, { ok: false, error: "Missing ?url=<figma link> query parameter." });
    return;
  }
  try {
    const ref = parseFigmaUrl(figmaUrl);
    const fixture = await fetchFigmaNodesResponse(ref);
    sendJson(res, 200, { ok: true, fixture, suggestedFilename: `design-fixture-${ref.fileKey}.json` });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: (err as Error).message });
  }
}

async function ensureReportHtml(): Promise<void> {
  const reportPath = join(demoDir, "report.html");
  if (existsSync(reportPath)) return;
  const fixture = JSON.parse(
    await readFile(join(demoDir, "design-fixture.json"), "utf-8")
  ) as FigmaNodesResponse;
  const live = await serveDirOnEphemeralPort(demoDir);
  try {
    const output = await verifyFromFixture({ fixture, liveUrl: live.url });
    const html = renderHtmlReport({
      report: output.report,
      design: output.designElements,
      screenshotBase64: output.screenshotBase64,
    });
    await writeFile(reportPath, html, "utf-8");
  } finally {
    await live.close();
  }
}

function serveStatic(res: ServerResponse, abs: string): void {
  const type = MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
  const stream = createReadStream(abs);
  stream.on("error", () => {
    res.writeHead(404).end("not found");
  });
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  stream.pipe(res);
}

async function main(): Promise<void> {
  await ensureReportHtml();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    try {
      if (req.method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true, studio: true });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/verify") {
        await handleVerify(req, res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/figma-fixture") {
        await handleFigmaFixture(res, url);
        return;
      }
      if (req.method === "GET") {
        let rel = url.pathname === "/" ? "report.html" : url.pathname.replace(/^\/+/, "");
        if (rel === "index.html") rel = "report.html";
        const abs = join(demoDir, rel);
        const resolved = normalize(abs);
        if (!resolved.startsWith(normalize(demoDir) + sep) && resolved !== normalize(demoDir)) {
          res.writeHead(403).end("forbidden");
          return;
        }
        if (!existsSync(resolved)) {
          res.writeHead(404).end("not found");
          return;
        }
        serveStatic(res, resolved);
        return;
      }
      res.writeHead(405).end("method not allowed");
    } catch (err) {
      sendJson(res, 500, { ok: false, error: (err as Error).message });
    }
  });

  // Generous timeouts: Playwright extraction + a real compare can take a while,
  // and we don't want Node silently resetting the connection mid-upload.
  server.requestTimeout = 5 * 60_000;
  server.headersTimeout = 60_000;

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Figma Verify studio → http://127.0.0.1:${PORT}`);
    console.log("Upload a code folder + design-fixture JSON, then click Compare.");
  });
}

void main();
