/**
 * Integration: POST multipart uploads to a short-lived studio verify path
 * using the same helpers + verifyFromFixture the server uses.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { existsSync, createReadStream } from "node:fs";
import type { AddressInfo } from "node:net";
import type { FigmaNodesResponse } from "../src/figma/client.js";
import { renderHtmlReport } from "../src/report/render-html.js";
import { verifyFromFixture } from "../src/verify.js";
import {
  isExcludedUploadPath,
  pickEntry,
  safeRelPath,
  stripSharedRoot,
  validateLiveUrl,
  writeUploadTree,
} from "../src/studio/upload.js";

const here = dirname(fileURLToPath(import.meta.url));
const demoDir = join(here, "../demo");

let server: Server;
let baseUrl: string;
let workDirs: string[] = [];
let demoServer: Server;
let demoUrl: string;

beforeAll(async () => {
  demoServer = createServer((req, res) => {
    const file = req.url === "/" || !req.url ? "index.html" : req.url.slice(1);
    createReadStream(join(demoDir, file))
      .on("error", () => res.writeHead(404).end())
      .pipe(res);
  });
  await new Promise<void>((r) => demoServer.listen(0, "127.0.0.1", r));
  demoUrl = `http://127.0.0.1:${(demoServer.address() as AddressInfo).port}/`;

  server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, studio: true }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/verify") {
      try {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "string") headers.set(k, v);
          else if (Array.isArray(v)) headers.set(k, v.join(", "));
        }
        const request = new Request("http://127.0.0.1/api/verify", {
          method: "POST",
          headers,
          body: Buffer.concat(chunks),
        });
        const form = await request.formData();
        const figmaUrlField = form.get("figmaUrl");
        if (typeof figmaUrlField === "string" && figmaUrlField) {
          if (!/^https?:\/\/([a-z0-9-]+\.)*figma\.com\//i.test(figmaUrlField)) {
            throw new Error(`Not a figma.com URL: ${figmaUrlField}`);
          }
          // Real Figma API calls need FIGMA_TOKEN + network; not exercised here.
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, acceptedFigmaUrl: figmaUrlField }));
          return;
        }
        const fixtureFile = form.get("fixture");
        if (!(fixtureFile instanceof File)) throw new Error("missing fixture");
        const fixture = JSON.parse(await fixtureFile.text()) as FigmaNodesResponse;

        const liveUrlField = form.get("liveUrl");
        if (typeof liveUrlField === "string" && liveUrlField.trim()) {
          const liveUrl = validateLiveUrl(liveUrlField);
          const output = await verifyFromFixture({ fixture, liveUrl });
          const html = renderHtmlReport({
            report: output.report,
            design: output.designElements,
            screenshotBase64: output.screenshotBase64,
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, html, report: output.report, liveUrl }));
          return;
        }

        const uploaded = form.getAll("files").filter((f): f is File => f instanceof File);
        const originals = uploaded.map((f) => f.name);
        const pathMap = stripSharedRoot(originals);
        const files = [];
        for (const file of uploaded) {
          const rel = safeRelPath(pathMap.get(file.name) ?? file.name);
          if (!rel || isExcludedUploadPath(rel)) continue;
          files.push({ relPath: rel, data: Buffer.from(await file.arrayBuffer()) });
        }
        const workDir = await mkdtemp(join(tmpdir(), "fv-api-"));
        workDirs.push(workDir);
        const relPaths = await writeUploadTree(workDir, files);
        const entryRel = pickEntry(relPaths);
        if (entryRel !== "index.html" && !existsSync(join(workDir, "index.html"))) {
          await writeFile(join(workDir, "index.html"), await readFile(join(workDir, entryRel)));
        }
        const staticServer = createServer((sreq, sres) => {
          const file = sreq.url === "/" || !sreq.url ? "index.html" : sreq.url.slice(1);
          createReadStream(join(workDir, file))
            .on("error", () => sres.writeHead(404).end())
            .pipe(sres);
        });
        await new Promise<void>((r) => staticServer.listen(0, "127.0.0.1", r));
        const port = (staticServer.address() as AddressInfo).port;
        const liveUrl = `http://127.0.0.1:${port}/`;
        try {
          const output = await verifyFromFixture({ fixture, liveUrl });
          const html = renderHtmlReport({
            report: output.report,
            design: output.designElements,
            screenshotBase64: output.screenshotBase64,
          });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, html, report: output.report }));
        } finally {
          await new Promise<void>((r) => staticServer.close(() => r()));
        }
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
      }
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => demoServer.close(() => r()));
  await Promise.all(workDirs.map((d) => rm(d, { recursive: true, force: true })));
});

describe("studio /api/verify", () => {
  it("reports studio health", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ ok: true, studio: true });
  });

  it("compares an uploaded folder against the design fixture", async () => {
    const fixtureBuf = await readFile(join(demoDir, "design-fixture.json"));
    const htmlBuf = await readFile(join(demoDir, "index.html"));
    const fd = new FormData();
    fd.append("fixture", new File([fixtureBuf], "design-fixture.json", { type: "application/json" }));
    fd.append("files", new File([htmlBuf], "demo/index.html", { type: "text/html" }), "demo/index.html");

    const res = await fetch(`${baseUrl}/api/verify`, { method: "POST", body: fd });
    const body = (await res.json()) as {
      ok: boolean;
      html?: string;
      report?: { fidelityScore: number; missing: Array<{ designName: string }> };
      error?: string;
    };
    expect(res.ok, body.error).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.html).toContain("Figma Verify");
    expect(body.html).toContain('id="fv-compare"');
    expect(body.report!.fidelityScore).toBeLessThan(100);
    expect(body.report!.missing.map((m) => m.designName)).toContain("Guarantee Badge");
  }, 60_000);

  it("accepts a pasted Figma proto link as the design source", async () => {
    const fd = new FormData();
    fd.append(
      "figmaUrl",
      "https://www.figma.com/proto/Ptm7BvMduyqaGEcYBKzSZG/Trainee-Project?node-id=1601-3&t=qr8kiAshiRHi0sP0-1"
    );
    fd.append("files", new File([Buffer.from("<html></html>")], "index.html", { type: "text/html" }));
    const res = await fetch(`${baseUrl}/api/verify`, { method: "POST", body: fd });
    const body = (await res.json()) as { ok: boolean; acceptedFigmaUrl?: string };
    expect(res.ok).toBe(true);
    expect(body.acceptedFigmaUrl).toContain("node-id=1601-3");
  });

  it("excludes node_modules from an uploaded folder and still compares successfully", async () => {
    const fixtureBuf = await readFile(join(demoDir, "design-fixture.json"));
    const htmlBuf = await readFile(join(demoDir, "index.html"));
    const fd = new FormData();
    fd.append("fixture", new File([fixtureBuf], "design-fixture.json", { type: "application/json" }));
    fd.append("files", new File([htmlBuf], "app/index.html", { type: "text/html" }), "app/index.html");
    fd.append(
      "files",
      new File([Buffer.from("module.exports = {};")], "app/node_modules/dep/index.js", {
        type: "text/javascript",
      }),
      "app/node_modules/dep/index.js"
    );

    const res = await fetch(`${baseUrl}/api/verify`, { method: "POST", body: fd });
    const body = (await res.json()) as { ok: boolean; report?: { fidelityScore: number }; error?: string };
    expect(res.ok, body.error).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.report!.fidelityScore).toBeLessThan(100);
  }, 60_000);

  it("compares against a pasted live URL directly, without any file upload", async () => {
    const fixtureBuf = await readFile(join(demoDir, "design-fixture.json"));
    const fd = new FormData();
    fd.append("fixture", new File([fixtureBuf], "design-fixture.json", { type: "application/json" }));
    fd.append("liveUrl", demoUrl);
    // Deliberately no "files" entries — the live URL should be used as-is.

    const res = await fetch(`${baseUrl}/api/verify`, { method: "POST", body: fd });
    const body = (await res.json()) as {
      ok: boolean;
      liveUrl?: string;
      report?: { fidelityScore: number; missing: Array<{ designName: string }> };
      error?: string;
    };
    expect(res.ok, body.error).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.liveUrl).toBe(demoUrl);
    expect(body.report!.fidelityScore).toBeLessThan(100);
    expect(body.report!.missing.map((m) => m.designName)).toContain("Guarantee Badge");
  }, 60_000);

  it("rejects a non-figma.com URL as the design source", async () => {
    const fd = new FormData();
    fd.append("figmaUrl", "https://evil.example.com/design/x?node-id=1-2");
    fd.append("files", new File([Buffer.from("<html></html>")], "index.html", { type: "text/html" }));
    const res = await fetch(`${baseUrl}/api/verify`, { method: "POST", body: fd });
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(res.ok).toBe(false);
    expect(body.error).toMatch(/figma\.com/);
  });
});
